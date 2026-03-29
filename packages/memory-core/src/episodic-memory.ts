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

    return relatedSessions.flatMap((sessionId) => this.list(sessionId));
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

const sharedEpisodicMemoryStore = new EpisodicMemoryStore();

export class EpisodicMemoryProvider implements MemoryProvider {
  public readonly name = "episodic-memory-provider";

  private readonly store = sharedEpisodicMemoryStore;

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
    const digestK = ctx.memory_config?.retrieval_top_k ?? 3;
    const recentSessionEpisodes = this.list(ctx.session.session_id).slice(-(digestK)).map((episode) => ({
      memory_id: episode.episode_id,
      memory_type: "episodic" as const,
      summary: episode.outcome_summary,
      relevance: episode.outcome === "success" ? 0.85 : episode.outcome === "partial" ? 0.75 : 0.65
    }));
    const crossDigestK = Math.max(1, Math.ceil(digestK * 0.66));
    const relatedEpisodes = this.store
      .listByTenant(ctx.tenant_id, ctx.session.session_id)
      .slice(-(crossDigestK))
      .map((episode) => ({
        memory_id: episode.episode_id,
        memory_type: "episodic" as const,
        summary: `[cross-session] ${episode.outcome_summary}`,
        relevance: episode.outcome === "success" ? 0.8 : episode.outcome === "partial" ? 0.7 : 0.6
      }));

    return [...recentSessionEpisodes, ...relatedEpisodes];
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    const topK = ctx.memory_config?.retrieval_top_k ?? 5;
    const proposals: Proposal[] = [];
    const recentEpisodes = this.list(ctx.session.session_id).slice(-(topK));
    const relatedEpisodes = this.store
      .listByTenant(ctx.tenant_id, ctx.session.session_id)
      .filter((episode) => episode.outcome === "success" || episode.outcome === "partial")
      .slice(-(Math.max(1, Math.ceil(topK * 0.6))));

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
    this.store.write(episode.session_id, ctx.tenant_id, episode);
  }
}
