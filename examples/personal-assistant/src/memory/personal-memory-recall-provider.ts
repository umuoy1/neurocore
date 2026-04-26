import type { Episode, MemoryDigest, MemoryProvider, ModuleContext, Proposal } from "@neurocore/protocol";
import type { PersonalMemoryRecord, PersonalMemoryStore } from "./personal-memory-store.js";

export interface PersonalMemoryRecallProviderOptions {
  limit?: number;
}

export class PersonalMemoryRecallProvider implements MemoryProvider {
  public readonly name = "personal-memory-recall-provider";
  public readonly layer = "semantic";

  public constructor(
    private readonly store: PersonalMemoryStore,
    private readonly options: PersonalMemoryRecallProviderOptions = {}
  ) {}

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const userId = resolveUserId(ctx);
    if (!userId) {
      return [];
    }

    const memories = this.getMemories(userId, ctx);
    if (memories.length === 0) {
      return [];
    }

    return [
      {
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: 0.92,
        confidence: 0.95,
        risk: 0,
        payload: {
          user_id: userId,
          personal_memories: memories.map(toBundleMemory),
          entries: memories.map((memory) => ({
            memory_id: memory.memory_id,
            summary: memory.content,
            updated_at: memory.updated_at,
            correction_of: memory.correction_of
          }))
        },
        explanation: `Retrieved ${memories.length} active personal memories for ${userId}.`
      }
    ];
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    const userId = resolveUserId(ctx);
    if (!userId) {
      return [];
    }

    return this.getMemories(userId, ctx).map((memory, index) => ({
      memory_id: memory.memory_id,
      memory_type: "semantic",
      summary: memory.content,
      relevance: Math.max(0.1, 0.95 - index * 0.03)
    }));
  }

  public async writeEpisode(_ctx: ModuleContext, _episode: Episode): Promise<void> {
    return;
  }

  private getMemories(userId: string, ctx: ModuleContext): PersonalMemoryRecord[] {
    return this.store.listActive(userId, this.options.limit ?? ctx.memory_config?.retrieval_top_k ?? 8);
  }
}

function resolveUserId(ctx: ModuleContext): string | undefined {
  const metadata = isRecord(ctx.runtime_state.current_input_metadata)
    ? ctx.runtime_state.current_input_metadata
    : {};
  const personalMemory = isRecord(metadata.personal_memory) ? metadata.personal_memory : {};
  const identity = isRecord(metadata.identity) ? metadata.identity : {};

  return asString(metadata.canonical_user_id)
    ?? asString(identity.canonical_user_id)
    ?? asString(personalMemory.user_id);
}

function toBundleMemory(memory: PersonalMemoryRecord): Record<string, unknown> {
  return {
    memory_id: memory.memory_id,
    user_id: memory.user_id,
    content: memory.content,
    status: memory.status,
    correction_of: memory.correction_of,
    source: memory.source,
    created_at: memory.created_at,
    updated_at: memory.updated_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
