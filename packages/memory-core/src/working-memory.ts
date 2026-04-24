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

export interface WorkingMemoryPersistenceStore {
  append(sessionId: string, entry: WorkingMemoryEntry, maxEntriesOverride?: number): void;
  list(sessionId: string): WorkingMemoryEntry[];
  replace(sessionId: string, entries: WorkingMemoryEntry[]): void;
  deleteSession(sessionId: string): void;
}

export class WorkingMemoryStore {
  private readonly entries = new Map<string, WorkingMemoryEntry[]>();

  public constructor(private readonly maxEntries?: number) {}

  public append(sessionId: string, entry: WorkingMemoryEntry, maxEntriesOverride?: number): void {
    const current = this.entries.get(sessionId) ?? [];
    current.push(normalizeWorkingMemoryEntry(entry));
    const limit = maxEntriesOverride ?? this.maxEntries;
    this.entries.set(sessionId, pruneWorkingMemoryEntries(current, limit));
  }

  public list(sessionId: string): WorkingMemoryEntry[] {
    const current = this.entries.get(sessionId) ?? [];
    const pruned = pruneWorkingMemoryEntries(current, this.maxEntries);
    if (pruned.length !== current.length) {
      this.entries.set(sessionId, pruned);
    }
    return pruned;
  }

  public replace(sessionId: string, entries: WorkingMemoryEntry[]): void {
    this.entries.set(
      sessionId,
      pruneWorkingMemoryEntries(entries.map((entry) => normalizeWorkingMemoryEntry(entry)), this.maxEntries)
    );
  }

  public deleteSession(sessionId: string): void {
    this.entries.delete(sessionId);
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
  public readonly layer = "working" as const;

  private readonly store: WorkingMemoryStore;
  private readonly persistenceStore?: WorkingMemoryPersistenceStore;

  public constructor(
    maxEntries?: number,
    persistenceStore?: WorkingMemoryPersistenceStore
  ) {
    this.store = new WorkingMemoryStore(maxEntries);
    this.persistenceStore = persistenceStore;
  }

  public append(sessionId: string, entry: WorkingMemoryEntry, maxEntriesOverride?: number): void {
    const normalized = normalizeWorkingMemoryEntry(entry);
    this.store.append(sessionId, normalized, maxEntriesOverride);
    this.persistenceStore?.append(sessionId, normalized, maxEntriesOverride);
  }

  public appendObservation(
    sessionId: string,
    observation: Observation,
    maxEntriesOverride?: number,
    ttlMs?: number
  ): void {
    this.append(sessionId, {
      memory_id: observation.observation_id,
      summary: observation.summary,
      relevance: 1,
      created_at: observation.created_at,
      expires_at: ttlMs && ttlMs > 0
        ? new Date(Date.parse(observation.created_at) + ttlMs).toISOString()
        : undefined
    }, maxEntriesOverride);
  }

  public list(sessionId: string): WorkingMemoryEntry[] {
    if (this.persistenceStore) {
      return this.persistenceStore.list(sessionId);
    }
    return this.store.list(sessionId);
  }

  public replace(sessionId: string, entries: WorkingMemoryEntry[]): void {
    const normalized = entries.map((entry) => normalizeWorkingMemoryEntry(entry));
    this.store.replace(sessionId, normalized);
    this.persistenceStore?.replace(sessionId, normalized);
  }

  public deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
    this.persistenceStore?.deleteSession(sessionId);
  }

  public evictSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
  }

  public digest(sessionId: string): MemoryDigest[] {
    return this.list(sessionId).map((entry) => ({
      memory_id: entry.memory_id,
      memory_type: "working",
      summary: entry.summary,
      relevance: entry.relevance
    }));
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    if (ctx.profile.memory_config.working_memory_enabled === false) {
      return [];
    }

    return this.digest(ctx.session.session_id);
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    if (ctx.profile.memory_config.working_memory_enabled === false) {
      return [];
    }

    const entries = this.list(ctx.session.session_id);
    if (entries.length === 0) {
      return [];
    }

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    const recalled = entries.slice(-(ctx.memory_config?.retrieval_top_k ?? 5));

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

function normalizeWorkingMemoryEntry(entry: WorkingMemoryEntry): WorkingMemoryEntry {
  return {
    ...entry,
    created_at: entry.created_at ?? new Date().toISOString()
  };
}

function pruneWorkingMemoryEntries(entries: WorkingMemoryEntry[], limit?: number): WorkingMemoryEntry[] {
  const now = Date.now();
  const active = entries.filter((entry) => {
    if (!entry.expires_at) {
      return true;
    }
    const expiresAt = Date.parse(entry.expires_at);
    return Number.isNaN(expiresAt) || expiresAt > now;
  });
  if (limit && active.length > limit) {
    return active.slice(active.length - limit);
  }
  return active;
}
