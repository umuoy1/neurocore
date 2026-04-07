import type {
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Proposal
} from "@neurocore/protocol";

export class EpisodicMemoryStore {
  private readonly episodes = new Map<string, Episode[]>();
  private readonly sessionTenants = new Map<string, string>();

  public write(sessionId: string, tenantId: string, episode: Episode): void {
    const current = this.episodes.get(sessionId) ?? [];
    current.push(episode);
    this.episodes.set(sessionId, current);
    this.sessionTenants.set(sessionId, tenantId);
  }

  public list(sessionId: string): Episode[] {
    return this.episodes.get(sessionId) ?? [];
  }

  public listByTenant(tenantId: string, excludeSessionId?: string): Episode[] {
    const relatedSessions = [...this.sessionTenants.entries()]
      .filter(([sessionId, currentTenantId]) => currentTenantId === tenantId && sessionId !== excludeSessionId)
      .map(([sessionId]) => sessionId);

    return relatedSessions
      .flatMap((sessionId) => this.list(sessionId))
      .sort(compareEpisodeByCreatedAtDesc);
  }

  public replace(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.episodes.set(sessionId, episodes);
    this.sessionTenants.set(sessionId, tenantId);
  }

  public deleteSession(sessionId: string): void {
    this.episodes.delete(sessionId);
    this.sessionTenants.delete(sessionId);
  }
}

export class EpisodicMemoryProvider implements MemoryProvider {
  public readonly name = "episodic-memory-provider";

  public constructor(private readonly store = new EpisodicMemoryStore()) {}

  public list(sessionId: string): Episode[] {
    return this.store.list(sessionId);
  }

  public replace(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.store.replace(sessionId, tenantId, episodes);
  }

  public deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    if (ctx.profile.memory_config.episodic_memory_enabled === false) {
      return [];
    }

    const digestK = ctx.memory_config?.retrieval_top_k ?? 3;
    const recentSessionEpisodes = this.list(ctx.session.session_id)
      .slice()
      .sort((left, right) => compareEpisodeByRelevance(left, right, ctx))
      .slice(0, digestK)
      .map((episode) => ({
        memory_id: episode.episode_id,
        memory_type: "episodic" as const,
        summary: episode.outcome_summary,
        relevance: episode.outcome === "success" ? 0.85 : episode.outcome === "partial" ? 0.75 : 0.65
      }));
    const crossDigestK = Math.max(1, Math.ceil(digestK * 0.66));
    const relatedEpisodes = this.store
      .listByTenant(ctx.tenant_id, ctx.session.session_id)
      .sort((left, right) => compareEpisodeByRelevance(left, right, ctx))
      .slice(0, crossDigestK)
      .map((episode) => ({
        memory_id: episode.episode_id,
        memory_type: "episodic" as const,
        summary: `[cross-session] ${episode.outcome_summary}`,
        relevance: episode.outcome === "success" ? 0.8 : episode.outcome === "partial" ? 0.7 : 0.6
      }));

    return [...recentSessionEpisodes, ...relatedEpisodes];
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    if (ctx.profile.memory_config.episodic_memory_enabled === false) {
      return [];
    }

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    const topK = ctx.memory_config?.retrieval_top_k ?? 5;
    const proposals: Proposal[] = [];
    const recentEpisodes = this.list(ctx.session.session_id)
      .slice()
      .sort((left, right) => compareEpisodeByRelevance(left, right, ctx))
      .slice(0, topK);
    const relatedEpisodes = this.store
      .listByTenant(ctx.tenant_id, ctx.session.session_id)
      .filter((episode) => episode.outcome === "success" || episode.outcome === "partial")
      .sort((left, right) => compareEpisodeByRelevance(left, right, ctx))
      .slice(0, Math.max(1, Math.ceil(topK * 0.6)));

    if (recentEpisodes.length > 0) {
      proposals.push({
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: Math.min(0.9, 0.45 + recentEpisodes.length * 0.08),
        confidence: 0.9,
        risk: 0,
        payload: {
          memory_type: "episodic",
          scope: "session",
          episodes: recentEpisodes.map((episode) => ({
            episode_id: episode.episode_id,
            selected_strategy: episode.selected_strategy,
            outcome: episode.outcome,
            outcome_summary: episode.outcome_summary,
            metadata: episode.metadata ?? {}
          }))
        },
        explanation: `Recalled ${recentEpisodes.length} recent episodic memories from the session.`
      });
    }

    if (relatedEpisodes.length > 0) {
      proposals.push({
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: Math.min(0.88, 0.5 + relatedEpisodes.length * 0.09),
        confidence: 0.88,
        risk: 0,
        payload: {
          memory_type: "episodic",
          scope: "tenant",
          episodes: relatedEpisodes.map((episode) => ({
            episode_id: episode.episode_id,
            session_id: episode.session_id,
            selected_strategy: episode.selected_strategy,
            outcome: episode.outcome,
            outcome_summary: episode.outcome_summary,
            metadata: episode.metadata ?? {}
          }))
        },
        explanation: `Recalled ${relatedEpisodes.length} successful episodic memories from other sessions in the same tenant.`
      });
    }

    return proposals;
  }

  public async writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void> {
    if (ctx.profile.memory_config.episodic_memory_enabled === false) {
      return;
    }

    this.store.write(episode.session_id, ctx.tenant_id, episode);
  }
}

function compareEpisodeByCreatedAtDesc(left: Episode, right: Episode): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

function compareEpisodeByRelevance(left: Episode, right: Episode, ctx: ModuleContext): number {
  const scoreDiff = scoreEpisode(right, ctx) - scoreEpisode(left, ctx);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return compareEpisodeByCreatedAtDesc(left, right);
}

function scoreEpisode(episode: Episode, ctx: ModuleContext): number {
  const inputContent =
    typeof ctx.runtime_state.current_input_content === "string"
      ? ctx.runtime_state.current_input_content
      : "";
  const inputMetadata =
    ctx.runtime_state.current_input_metadata &&
    typeof ctx.runtime_state.current_input_metadata === "object"
      ? (ctx.runtime_state.current_input_metadata as Record<string, unknown>)
      : undefined;

  const haystack = [
    episode.trigger_summary,
    episode.context_digest,
    episode.selected_strategy,
    episode.outcome_summary
  ].join(" ").toLowerCase();
  const similarity = computeSparseCosineSimilarity(inputContent.toLowerCase(), haystack);

  let score = similarity * 0.55;

  const episodeToolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : undefined;
  const episodeActionType =
    episode.metadata && typeof episode.metadata.action_type === "string"
      ? episode.metadata.action_type
      : undefined;
  const inputToolName =
    typeof inputMetadata?.sourceToolName === "string"
      ? inputMetadata.sourceToolName
      : typeof inputMetadata?.tool_name === "string"
        ? inputMetadata.tool_name
        : undefined;
  const inputActionType =
    typeof inputMetadata?.sourceActionType === "string"
      ? inputMetadata.sourceActionType
      : typeof inputMetadata?.action_type === "string"
        ? inputMetadata.action_type
        : undefined;

  if (episodeToolName && inputToolName && episodeToolName === inputToolName) {
    score += 0.3;
  }
  if (episodeActionType && inputActionType && episodeActionType === inputActionType) {
    score += 0.15;
  }
  if (episode.outcome === "success") {
    score += 0.05;
  } else if (episode.outcome === "partial") {
    score += 0.02;
  }

  return score;
}

function computeTokenOverlap(query: string, target: string): number {
  const queryVector = toTokenVector(query);
  const targetVector = toTokenVector(target);
  if (queryVector.size === 0 || targetVector.size === 0) {
    return 0;
  }

  return computeCosineSimilarity(queryVector, targetVector);
}

function computeSparseCosineSimilarity(query: string, target: string): number {
  return computeTokenOverlap(query, target);
}

function toTokenVector(value: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const token of tokenize(value)) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function computeCosineSimilarity(
  left: Map<string, number>,
  right: Map<string, number>
): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const weight of left.values()) {
    leftNorm += weight * weight;
  }
  for (const weight of right.values()) {
    rightNorm += weight * weight;
  }
  for (const [token, leftWeight] of left.entries()) {
    const rightWeight = right.get(token);
    if (rightWeight !== undefined) {
      dot += leftWeight * rightWeight;
    }
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}
