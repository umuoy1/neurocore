import type {
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Proposal
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
  private readonly episodesBySession = new Map<string, Episode[]>();
  private readonly tenantBySession = new Map<string, string>();

  public appendEpisode(sessionId: string, tenantId: string, episode: Episode): void {
    if (episode.outcome !== "success") {
      return;
    }

    const current = this.episodesBySession.get(sessionId) ?? [];
    if (!current.some((candidate) => candidate.episode_id === episode.episode_id)) {
      current.push(episode);
      this.episodesBySession.set(sessionId, current);
    }
    this.tenantBySession.set(sessionId, tenantId);
  }

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.episodesBySession.set(
      sessionId,
      episodes.filter((episode) => episode.outcome === "success")
    );
    this.tenantBySession.set(sessionId, tenantId);
  }

  public deleteSession(sessionId: string): void {
    this.episodesBySession.delete(sessionId);
    this.tenantBySession.delete(sessionId);
  }

  public list(tenantId: string, excludeSessionId?: string): SemanticMemoryRecord[] {
    const groups = new Map<string, SemanticMemoryRecord>();

    for (const [sessionId, currentTenantId] of this.tenantBySession.entries()) {
      if (currentTenantId !== tenantId || sessionId === excludeSessionId) {
        continue;
      }

      const episodes = this.episodesBySession.get(sessionId) ?? [];
      for (const episode of episodes) {
        const patternKey = deriveSemanticPatternKey(episode);
        const existing = groups.get(patternKey);

        if (!existing) {
          groups.set(patternKey, {
            memory_id: `sem_${patternKey}`,
            tenant_id: tenantId,
            summary: episode.outcome_summary,
            relevance: 0.72,
            occurrence_count: 1,
            source_episode_ids: [episode.episode_id],
            session_ids: [sessionId],
            pattern_key: patternKey,
            last_updated_at: episode.created_at
          });
          continue;
        }

        if (!existing.source_episode_ids.includes(episode.episode_id)) {
          existing.source_episode_ids.push(episode.episode_id);
          existing.occurrence_count = existing.source_episode_ids.length;
        }
        if (!existing.session_ids.includes(sessionId)) {
          existing.session_ids.push(sessionId);
        }
        existing.summary = episode.outcome_summary;
        existing.last_updated_at = episode.created_at;
        existing.relevance = Math.min(0.98, 0.68 + existing.occurrence_count * 0.08);
        groups.set(patternKey, existing);
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
}

const sharedSemanticMemoryStore = new SemanticMemoryStore();

export class SemanticMemoryProvider implements MemoryProvider {
  public readonly name = "semantic-memory-provider";

  private readonly store = sharedSemanticMemoryStore;

  public replaceSession(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.store.replaceSession(sessionId, tenantId, episodes);
  }

  public deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    return this.store
      .list(ctx.tenant_id, ctx.session.session_id)
      .slice(0, 3)
      .map((record) => ({
        memory_id: record.memory_id,
        memory_type: "semantic",
        summary: record.summary,
        relevance: record.relevance
      }));
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const records = this.store.list(ctx.tenant_id, ctx.session.session_id).slice(0, 3);
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
    this.store.appendEpisode(episode.session_id, ctx.tenant_id, episode);
  }
}

function deriveSemanticPatternKey(episode: Episode): string {
  const toolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : "runtime";
  const normalizedStrategy = episode.selected_strategy.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48);
  return `${toolName}:${normalizedStrategy}`;
}
