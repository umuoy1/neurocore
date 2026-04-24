import type {
  Episode,
  MemoryLifecycleState,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Proposal,
  SemanticCard,
  SemanticMemoryContribution,
  SemanticMemorySnapshot
} from "@neurocore/protocol";

export interface SemanticMemoryRecord {
  memory_id: string;
  tenant_id: string;
  summary: string;
  relevance: number;
  occurrence_count: number;
  source_episode_ids: string[];
  session_ids: string[];
  pattern_key: string;
  valence: "positive" | "negative";
  last_updated_at: string;
  lifecycle_state?: MemoryLifecycleState;
}

export interface SemanticMemoryPersistenceStore {
  appendEpisode(sessionId: string, tenantId: string, episode: Episode, includeNegative?: boolean): void;
  replaceSession(sessionId: string, tenantId: string, episodes: Episode[], includeNegative?: boolean): void;
  restoreSnapshot(sessionId: string, tenantId: string, snapshot?: SemanticMemorySnapshot): void;
  buildSnapshot(sessionId: string): SemanticMemorySnapshot;
  deleteSession(sessionId: string): void;
  markCardsByEpisodeIds(tenantId: string, episodeIds: string[], lifecycleState: MemoryLifecycleState): SemanticCard[];
  list(tenantId: string, excludeSessionId?: string): SemanticMemoryRecord[];
}

class SemanticMemoryStore {
  private readonly contributionsBySession = new Map<string, SemanticMemoryContribution[]>();
  private readonly tenantBySession = new Map<string, string>();
  private readonly lifecycleByPattern = new Map<string, MemoryLifecycleState>();

  public appendEpisode(sessionId: string, tenantId: string, episode: Episode, includeNegative = false): void {
    if (!shouldStoreSemanticEpisode(episode, includeNegative)) {
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

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[], includeNegative = false): void {
    this.contributionsBySession.set(
      sessionId,
      buildContributionsFromEpisodes(
        tenantId,
        sessionId,
        episodes.filter((episode) => shouldStoreSemanticEpisode(episode, includeNegative))
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
    for (const card of snapshot?.cards ?? []) {
      if (card.lifecycle_state) {
        this.lifecycleByPattern.set(
          cardGovernanceKey(card.tenant_id, card.pattern_key),
          structuredClone(card.lifecycle_state)
        );
      }
    }
  }

  public buildSnapshot(sessionId: string): SemanticMemorySnapshot {
    return {
      contributions: structuredClone(this.contributionsBySession.get(sessionId) ?? []),
      cards: this.list(this.tenantBySession.get(sessionId) ?? "", sessionId).map(toSemanticCard)
    };
  }

  public deleteSession(sessionId: string): void {
    this.contributionsBySession.delete(sessionId);
    this.tenantBySession.delete(sessionId);
  }

  public markCardsByEpisodeIds(tenantId: string, episodeIds: string[], lifecycleState: MemoryLifecycleState): SemanticCard[] {
    const touched = this.list(tenantId)
      .filter((record) => record.source_episode_ids.some((episodeId) => episodeIds.includes(episodeId)));
    for (const record of touched) {
      this.lifecycleByPattern.set(cardGovernanceKey(tenantId, record.pattern_key), structuredClone(lifecycleState));
    }
    return touched.map((record) => ({
      ...toSemanticCard(record),
      lifecycle_state: structuredClone(lifecycleState)
    }));
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
            memory_id: semanticMemoryId(contribution.pattern_key),
            tenant_id: tenantId,
            summary: contribution.summary,
            relevance: 0.72,
            occurrence_count: contribution.source_episode_ids.length,
            source_episode_ids: [...contribution.source_episode_ids],
            session_ids: [sessionId],
            pattern_key: contribution.pattern_key,
            valence: deriveContributionValence(contribution.pattern_key),
            last_updated_at: contribution.last_updated_at,
            lifecycle_state: this.lifecycleByPattern.get(cardGovernanceKey(tenantId, contribution.pattern_key))
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
        if (existing.valence === "negative") {
          existing.relevance = Math.min(0.9, 0.56 + existing.occurrence_count * 0.06);
        }
        existing.lifecycle_state =
          this.lifecycleByPattern.get(cardGovernanceKey(tenantId, contribution.pattern_key)) ??
          existing.lifecycle_state;
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
        summary: deriveSemanticSummary(episode),
        source_episode_ids: [episode.episode_id],
        last_updated_at: episode.created_at
      });
      return next;
    }

    if (!existing.source_episode_ids.includes(episode.episode_id)) {
      existing.source_episode_ids.push(episode.episode_id);
    }
    if (Date.parse(episode.created_at) > Date.parse(existing.last_updated_at)) {
      existing.summary = deriveSemanticSummary(episode);
      existing.last_updated_at = episode.created_at;
    }
    return next;
  }
}

export class SemanticMemoryProvider implements MemoryProvider {
  public readonly name = "semantic-memory-provider";
  public readonly layer = "semantic" as const;

  public constructor(
    private readonly store: SemanticMemoryStore | SemanticMemoryPersistenceStore = new SemanticMemoryStore()
  ) {}

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.store.replaceSession(sessionId, tenantId, episodes, true);
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

  public list(tenantId: string, excludeSessionId?: string): SemanticMemoryRecord[] {
    return structuredClone(this.store.list(tenantId, excludeSessionId));
  }

  public listCards(tenantId: string, excludeSessionId?: string): SemanticCard[] {
    return this.list(tenantId, excludeSessionId).map(toSemanticCard);
  }

  public markCardsByEpisodeIds(tenantId: string, episodeIds: string[], lifecycleState: MemoryLifecycleState): SemanticCard[] {
    return this.store.markCardsByEpisodeIds(tenantId, episodeIds, lifecycleState);
  }

  public evictSession(sessionId: string): void {
    if (this.store instanceof SemanticMemoryStore) {
      this.store.deleteSession(sessionId);
    }
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
            valence: record.valence,
            occurrence_count: record.occurrence_count,
            source_episode_ids: record.source_episode_ids,
            session_ids: record.session_ids
          })),
          semantic_cards: records.map(toSemanticCard)
        },
        explanation: `Recalled ${records.length} consolidated semantic memories from repeated episodes.`
      }
    ];
  }

  public async writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void> {
    if (ctx.profile.memory_config.semantic_memory_enabled === false) {
      return;
    }

    this.store.appendEpisode(
      episode.session_id,
      ctx.tenant_id,
      episode,
      ctx.profile.memory_config.semantic_negative_learning_enabled === true
    );
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
        summary: deriveSemanticSummary(episode),
        source_episode_ids: [episode.episode_id],
        last_updated_at: episode.created_at
      });
      continue;
    }

    if (!existing.source_episode_ids.includes(episode.episode_id)) {
      existing.source_episode_ids.push(episode.episode_id);
    }
    if (Date.parse(episode.created_at) > Date.parse(existing.last_updated_at)) {
      existing.summary = deriveSemanticSummary(episode);
      existing.last_updated_at = episode.created_at;
    }
    contributions.set(patternKey, existing);
  }

  return [...contributions.values()];
}

function deriveSemanticPatternKey(episode: Episode): string {
  const polarity = episode.outcome === "failure" || episode.valence === "negative" ? "negative" : "positive";
  const toolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : "runtime";
  const normalizedStrategy = episode.selected_strategy.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48);
  return `${polarity}:${toolName}:${normalizedStrategy}`;
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

  const { toolName } = parseSemanticPatternKey(record.pattern_key);
  const inputToolName =
    typeof inputMetadata?.sourceToolName === "string"
      ? inputMetadata.sourceToolName
      : typeof inputMetadata?.tool_name === "string"
        ? inputMetadata.tool_name
        : undefined;

  if (toolName && inputToolName && toolName === inputToolName) {
    score += 0.25;
  }
  if (record.valence === "negative") {
    score -= 0.05;
  }

  return score;
}

function shouldStoreSemanticEpisode(episode: Episode, includeNegative: boolean): boolean {
  if (episode.outcome === "success") {
    return true;
  }
  return includeNegative && (episode.outcome === "failure" || episode.valence === "negative");
}

function deriveSemanticSummary(episode: Episode): string {
  if (episode.outcome === "failure" || episode.valence === "negative") {
    return `Avoid: ${episode.outcome_summary}`;
  }
  return episode.outcome_summary;
}

function deriveContributionValence(patternKey: string): "positive" | "negative" {
  return patternKey.startsWith("negative:") ? "negative" : "positive";
}

function parseSemanticPatternKey(patternKey: string): { valence: "positive" | "negative"; toolName?: string } {
  const parts = patternKey.split(":");
  if (parts[0] === "positive" || parts[0] === "negative") {
    return {
      valence: parts[0],
      toolName: parts[1]
    };
  }
  return {
    valence: "positive",
    toolName: parts[0]
  };
}

function semanticMemoryId(patternKey: string): string {
  return patternKey.startsWith("positive:")
    ? `sem_${patternKey.slice("positive:".length)}`
    : `sem_${patternKey}`;
}

function toSemanticCard(record: SemanticMemoryRecord): SemanticCard {
  return {
    card_id: record.memory_id,
    schema_version: "1.0.0",
    tenant_id: record.tenant_id,
    pattern_key: record.pattern_key,
    summary: record.summary,
    valence: record.valence,
    source_episode_ids: [...record.source_episode_ids],
    counter_example_episode_ids: record.valence === "negative" ? [...record.source_episode_ids] : [],
    freshness: Math.max(0, 1 - ageInDays(record.last_updated_at) / 30),
    decay_policy: {
      mode: "hybrid",
      max_idle_ms: 1000 * 60 * 60 * 24 * 30
    },
    lifecycle_state: record.lifecycle_state ?? {
      status: "active",
      marked_at: record.last_updated_at
    },
    metadata: {
      occurrence_count: record.occurrence_count,
      session_ids: record.session_ids
    },
    created_at: record.last_updated_at,
    updated_at: record.last_updated_at
  };
}

function ageInDays(value: string): number {
  const diff = Date.now() - Date.parse(value);
  return Number.isNaN(diff) ? 0 : Math.max(0, diff / (1000 * 60 * 60 * 24));
}

function cardGovernanceKey(tenantId: string, patternKey: string): string {
  return `${tenantId}:${patternKey}`;
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
