import type {
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Proposal
} from "@neurocore/protocol";

export class EpisodicMemoryStore {
  private readonly episodes = new Map<string, Episode[]>();

  public write(sessionId: string, episode: Episode): void {
    const current = this.episodes.get(sessionId) ?? [];
    current.push(episode);
    this.episodes.set(sessionId, current);
  }

  public list(sessionId: string): Episode[] {
    return this.episodes.get(sessionId) ?? [];
  }

  public replace(sessionId: string, episodes: Episode[]): void {
    this.episodes.set(sessionId, episodes);
  }
}

export class EpisodicMemoryProvider implements MemoryProvider {
  public readonly name = "episodic-memory-provider";

  private readonly store = new EpisodicMemoryStore();

  public list(sessionId: string): Episode[] {
    return this.store.list(sessionId);
  }

  public replace(sessionId: string, episodes: Episode[]): void {
    this.store.replace(sessionId, episodes);
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    return this.list(ctx.session.session_id)
      .slice(-5)
      .map((episode) => ({
        memory_id: episode.episode_id,
        memory_type: "episodic" as const,
        summary: episode.outcome_summary,
        relevance: episode.outcome === "success" ? 0.85 : episode.outcome === "partial" ? 0.75 : 0.65
      }));
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const episodes = this.list(ctx.session.session_id);
    if (episodes.length === 0) {
      return [];
    }

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    const recentEpisodes = episodes.slice(-5);

    return [
      {
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
          episodes: recentEpisodes.map((episode) => ({
            episode_id: episode.episode_id,
            selected_strategy: episode.selected_strategy,
            outcome: episode.outcome,
            outcome_summary: episode.outcome_summary,
            metadata: episode.metadata ?? {}
          }))
        },
        explanation: `Recalled ${recentEpisodes.length} recent episodic memories from the session.`
      }
    ];
  }

  public async writeEpisode(_ctx: ModuleContext, episode: Episode): Promise<void> {
    this.store.write(episode.session_id, episode);
  }
}
