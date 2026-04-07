import type {
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Proposal,
  SemanticMemoryContribution,
  SemanticMemorySnapshot
} from "@neurocore/protocol";

interface SemanticMemoryRecord {
  memory_id: string;
  tenant_id: string;
  summary: string;
  relevance: number;
  occurrence_count: number;
  source_episode_ids: string[];
  session_ids: string[];
  pattern_key: string;
  last_updated_at: string;
}

class SemanticMemoryStore {
  private readonly contributionsBySession = new Map<string, SemanticMemoryContribution[]>();
  private readonly tenantBySession = new Map<string, string>();

  public appendEpisode(sessionId: string, tenantId: string, episode: Episode): void {
    if (episode.outcome !== "success") {
      return;
    }

    const next = this.mergeEpisodeIntoContributions(
      this.contributionsBySession.get(sessionId) ?? [],
      tenantId,
      sessionId,
      episode
    );
    this.contributionsBySession.set(sessionId, next);
    this.tenantBySession.set(sessionId, tenantId);
  }

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.contributionsBySession.set(
      sessionId,
      buildContributionsFromEpisodes(
        tenantId,
        sessionId,
        episodes.filter((episode) => episode.outcome === "success")
      )
    );
    this.tenantBySession.set(sessionId, tenantId);
  }

  public restoreSnapshot(sessionId: string, tenantId: string, snapshot?: SemanticMemorySnapshot): void {
    this.contributionsBySession.set(
      sessionId,
      structuredClone(snapshot?.contributions ?? [])
    );
    this.tenantBySession.set(sessionId, tenantId);
  }

  public buildSnapshot(sessionId: string): SemanticMemorySnapshot {
    return {
      contributions: structuredClone(this.contributionsBySession.get(sessionId) ?? [])
    };
  }

  public deleteSession(sessionId: string): void {
    this.contributionsBySession.delete(sessionId);
    this.tenantBySession.delete(sessionId);
  }

  public list(tenantId: string, excludeSessionId?: string): SemanticMemoryRecord[] {
    const groups = new Map<string, SemanticMemoryRecord>();

    for (const [sessionId, currentTenantId] of this.tenantBySession.entries()) {
      if (currentTenantId !== tenantId || sessionId === excludeSessionId) {
        continue;
      }

      const contributions = this.contributionsBySession.get(sessionId) ?? [];
      for (const contribution of contributions) {
        const existing = groups.get(contribution.pattern_key);

        if (!existing) {
          groups.set(contribution.pattern_key, {
            memory_id: `sem_${contribution.pattern_key}`,
            tenant_id: tenantId,
            summary: contribution.summary,
            relevance: 0.72,
            occurrence_count: contribution.source_episode_ids.length,
            source_episode_ids: [...contribution.source_episode_ids],
            session_ids: [sessionId],
            pattern_key: contribution.pattern_key,
            last_updated_at: contribution.last_updated_at
          });
          continue;
        }

        for (const episodeId of contribution.source_episode_ids) {
          if (!existing.source_episode_ids.includes(episodeId)) {
            existing.source_episode_ids.push(episodeId);
          }
        }
        existing.occurrence_count = existing.source_episode_ids.length;
        if (!existing.session_ids.includes(sessionId)) {
          existing.session_ids.push(sessionId);
        }
        if (Date.parse(contribution.last_updated_at) > Date.parse(existing.last_updated_at)) {
          existing.summary = contribution.summary;
          existing.last_updated_at = contribution.last_updated_at;
        }
        existing.relevance = Math.min(0.98, 0.68 + existing.occurrence_count * 0.08);
        groups.set(contribution.pattern_key, existing);
      }
    }

    return [...groups.values()]
      .filter((record) => record.occurrence_count >= 2)
      .sort((left, right) => {
        if (right.occurrence_count !== left.occurrence_count) {
          return right.occurrence_count - left.occurrence_count;
        }
        return Date.parse(right.last_updated_at) - Date.parse(left.last_updated_at);
      });
  }

  private mergeEpisodeIntoContributions(
    current: SemanticMemoryContribution[],
    tenantId: string,
    sessionId: string,
    episode: Episode
  ): SemanticMemoryContribution[] {
    const patternKey = deriveSemanticPatternKey(episode);
    const next = current.map((contribution) => structuredClone(contribution));
    const existing = next.find((contribution) => contribution.pattern_key === patternKey);

    if (!existing) {
      next.push({
        tenant_id: tenantId,
        session_id: sessionId,
        pattern_key: patternKey,
        summary: episode.outcome_summary,
        source_episode_ids: [episode.episode_id],
        last_updated_at: episode.created_at
      });
      return next;
    }

    if (!existing.source_episode_ids.includes(episode.episode_id)) {
      existing.source_episode_ids.push(episode.episode_id);
    }
    if (Date.parse(episode.created_at) > Date.parse(existing.last_updated_at)) {
      existing.summary = episode.outcome_summary;
      existing.last_updated_at = episode.created_at;
    }
    return next;
  }
}

export class SemanticMemoryProvider implements MemoryProvider {
  public readonly name = "semantic-memory-provider";

  public constructor(private readonly store = new SemanticMemoryStore()) {}

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.store.replaceSession(sessionId, tenantId, episodes);
  }

  public restoreSnapshot(sessionId: string, tenantId: string, snapshot?: SemanticMemorySnapshot): void {
    this.store.restoreSnapshot(sessionId, tenantId, snapshot);
  }

  public buildSnapshot(sessionId: string): SemanticMemorySnapshot {
    return this.store.buildSnapshot(sessionId);
  }

  public deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    if (ctx.profile.memory_config.semantic_memory_enabled === false) {
      return [];
    }

    return this.store
      .list(ctx.tenant_id, ctx.session.session_id)
      .sort((left, right) => compareSemanticRecordByRelevance(left, right, ctx))
      .slice(0, ctx.memory_config?.retrieval_top_k ?? 3)
      .map((record) => ({
        memory_id: record.memory_id,
        memory_type: "semantic",
        summary: record.summary,
        relevance: record.relevance
      }));
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    if (ctx.profile.memory_config.semantic_memory_enabled === false) {
      return [];
    }

    const records = this.store
      .list(ctx.tenant_id, ctx.session.session_id)
      .sort((left, right) => compareSemanticRecordByRelevance(left, right, ctx))
      .slice(0, ctx.memory_config?.retrieval_top_k ?? 3);
    if (records.length === 0) {
      return [];
    }

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    return [
      {
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: Math.min(0.94, 0.58 + records.length * 0.08),
        confidence: 0.9,
        risk: 0,
        payload: {
          memory_type: "semantic",
          scope: "tenant",
          records: records.map((record) => ({
            memory_id: record.memory_id,
            summary: record.summary,
            occurrence_count: record.occurrence_count,
            source_episode_ids: record.source_episode_ids,
            session_ids: record.session_ids
          }))
        },
        explanation: `Recalled ${records.length} consolidated semantic memories from repeated successful episodes.`
      }
    ];
  }

  public async writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void> {
    if (ctx.profile.memory_config.semantic_memory_enabled === false) {
      return;
    }

    this.store.appendEpisode(episode.session_id, ctx.tenant_id, episode);
  }
}

function buildContributionsFromEpisodes(
  tenantId: string,
  sessionId: string,
  episodes: Episode[]
): SemanticMemoryContribution[] {
  const contributions = new Map<string, SemanticMemoryContribution>();
  const orderedEpisodes = episodes.slice().sort(compareEpisodeByCreatedAtDesc);

  for (const episode of orderedEpisodes) {
    const patternKey = deriveSemanticPatternKey(episode);
    const existing = contributions.get(patternKey);

    if (!existing) {
      contributions.set(patternKey, {
        tenant_id: tenantId,
        session_id: sessionId,
        pattern_key: patternKey,
        summary: episode.outcome_summary,
        source_episode_ids: [episode.episode_id],
        last_updated_at: episode.created_at
      });
      continue;
    }

    if (!existing.source_episode_ids.includes(episode.episode_id)) {
      existing.source_episode_ids.push(episode.episode_id);
    }
    if (Date.parse(episode.created_at) > Date.parse(existing.last_updated_at)) {
      existing.summary = episode.outcome_summary;
      existing.last_updated_at = episode.created_at;
    }
    contributions.set(patternKey, existing);
  }

  return [...contributions.values()];
}

function deriveSemanticPatternKey(episode: Episode): string {
  const toolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : "runtime";
  const normalizedStrategy = episode.selected_strategy.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48);
  return `${toolName}:${normalizedStrategy}`;
}

function compareEpisodeByCreatedAtDesc(left: Episode, right: Episode): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

function compareSemanticRecordByRelevance(
  left: SemanticMemoryRecord,
  right: SemanticMemoryRecord,
  ctx: ModuleContext
): number {
  const scoreDiff = scoreSemanticRecord(right, ctx) - scoreSemanticRecord(left, ctx);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return Date.parse(right.last_updated_at) - Date.parse(left.last_updated_at);
}

function scoreSemanticRecord(record: SemanticMemoryRecord, ctx: ModuleContext): number {
  const inputContent =
    typeof ctx.runtime_state.current_input_content === "string"
      ? ctx.runtime_state.current_input_content
      : "";
  const inputMetadata =
    ctx.runtime_state.current_input_metadata &&
    typeof ctx.runtime_state.current_input_metadata === "object"
      ? (ctx.runtime_state.current_input_metadata as Record<string, unknown>)
      : undefined;

  let score = record.relevance;
  score += computeSparseCosineSimilarity(
    inputContent.toLowerCase(),
    `${record.summary} ${record.pattern_key}`.toLowerCase()
  ) * 0.4;

  const [toolName] = record.pattern_key.split(":");
  const inputToolName =
    typeof inputMetadata?.sourceToolName === "string"
      ? inputMetadata.sourceToolName
      : typeof inputMetadata?.tool_name === "string"
        ? inputMetadata.tool_name
        : undefined;

  if (toolName && inputToolName && toolName === inputToolName) {
    score += 0.25;
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
