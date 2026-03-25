import type {
  Episode,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Observation,
  Proposal,
  WorkingMemoryRecord
} from "@neurocore/protocol";

export interface WorkingMemoryEntry extends WorkingMemoryRecord {}

export class WorkingMemoryStore {
  private readonly entries = new Map<string, WorkingMemoryEntry[]>();

  public append(sessionId: string, entry: WorkingMemoryEntry): void {
    const current = this.entries.get(sessionId) ?? [];
    current.push(entry);
    this.entries.set(sessionId, current);
  }

  public list(sessionId: string): WorkingMemoryEntry[] {
    return this.entries.get(sessionId) ?? [];
  }

  public replace(sessionId: string, entries: WorkingMemoryEntry[]): void {
    this.entries.set(sessionId, entries);
  }

  public digest(sessionId: string): MemoryDigest[] {
    return this.list(sessionId).map((entry) => ({
      memory_id: entry.memory_id,
      memory_type: "working",
      summary: entry.summary,
      relevance: entry.relevance
    }));
  }
}

export class WorkingMemoryProvider implements MemoryProvider {
  public readonly name = "working-memory-provider";

  private readonly store = new WorkingMemoryStore();

  public append(sessionId: string, entry: WorkingMemoryEntry): void {
    this.store.append(sessionId, entry);
  }

  public appendObservation(sessionId: string, observation: Observation): void {
    this.append(sessionId, {
      memory_id: observation.observation_id,
      summary: observation.summary,
      relevance: 1
    });
  }

  public list(sessionId: string): WorkingMemoryEntry[] {
    return this.store.list(sessionId);
  }

  public replace(sessionId: string, entries: WorkingMemoryEntry[]): void {
    this.store.replace(sessionId, entries);
  }

  public digest(sessionId: string): MemoryDigest[] {
    return this.store.digest(sessionId);
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    return this.digest(ctx.session.session_id);
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const entries = this.list(ctx.session.session_id);
    if (entries.length === 0) {
      return [];
    }

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    const recalled = entries.slice(-5);

    return [
      {
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: Math.min(0.85, 0.4 + recalled.length * 0.08),
        confidence: 0.95,
        risk: 0,
        payload: {
          memory_type: "working",
          entries: recalled.map((entry) => ({
            memory_id: entry.memory_id,
            summary: entry.summary,
            relevance: entry.relevance
          }))
        },
        explanation: `Recalled ${recalled.length} working memory entries from the current session.`
      }
    ];
  }

  public async writeEpisode(_ctx: ModuleContext, _episode: Episode): Promise<void> {
    // MVP: working memory is session-scoped and does not persist episode writes yet.
  }
}
