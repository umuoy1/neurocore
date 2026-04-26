import type { Episode, MemoryDigest, MemoryProvider, ModuleContext, Proposal } from "@neurocore/protocol";
import type { SessionSearchResult, SessionSearchStore } from "./session-search-store.js";

export interface SessionSearchRecallProviderOptions {
  limit?: number;
}

export class SessionSearchRecallProvider implements MemoryProvider {
  public readonly name = "session-search-recall-provider";
  public readonly layer = "episodic";

  public constructor(
    private readonly store: SessionSearchStore,
    private readonly options: SessionSearchRecallProviderOptions = {}
  ) {}

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const query = resolveCurrentInput(ctx);
    const userId = resolveUserId(ctx);
    const results = this.search(ctx, query, userId);
    if (results.length === 0) {
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
        salience_score: 0.9,
        confidence: 0.9,
        risk: 0,
        payload: {
          user_id: userId,
          query,
          session_search_results: results.map(toBundleResult),
          entries: results.map((result) => ({
            memory_id: result.entry_id,
            summary: result.content,
            role: result.role,
            score: result.score,
            match_reasons: result.match_reasons,
            provenance: result.provenance
          }))
        },
        explanation: `Retrieved ${results.length} matching session history entries.`
      }
    ];
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    const query = resolveCurrentInput(ctx);
    const userId = resolveUserId(ctx);
    return this.search(ctx, query, userId).map((result, index) => ({
      memory_id: result.entry_id,
      memory_type: "episodic",
      summary: result.content,
      relevance: Math.max(0.1, Math.min(1, result.score || 0.9 - index * 0.05))
    }));
  }

  public async writeEpisode(_ctx: ModuleContext, _episode: Episode): Promise<void> {
    return;
  }

  private search(ctx: ModuleContext, query: string, userId: string | undefined): SessionSearchResult[] {
    return this.store.search({
      tenant_id: ctx.tenant_id,
      user_id: userId,
      query,
      semantic_text: query,
      limit: this.options.limit ?? ctx.memory_config?.retrieval_top_k ?? 8
    });
  }
}

function toBundleResult(result: SessionSearchResult): Record<string, unknown> {
  return {
    entry_id: result.entry_id,
    tenant_id: result.tenant_id,
    user_id: result.user_id,
    session_id: result.session_id,
    cycle_id: result.cycle_id,
    trace_id: result.trace_id,
    role: result.role,
    content: result.content,
    created_at: result.created_at,
    score: result.score,
    keyword_score: result.keyword_score,
    semantic_score: result.semantic_score,
    recency_score: result.recency_score,
    match_reasons: result.match_reasons,
    provenance: result.provenance,
    metadata: result.metadata
  };
}

function resolveCurrentInput(ctx: ModuleContext): string {
  return typeof ctx.runtime_state.current_input_content === "string"
    ? ctx.runtime_state.current_input_content
    : "";
}

function resolveUserId(ctx: ModuleContext): string | undefined {
  const metadata = isRecord(ctx.runtime_state.current_input_metadata)
    ? ctx.runtime_state.current_input_metadata
    : {};
  const personalMemory = isRecord(metadata.personal_memory) ? metadata.personal_memory : {};
  const identity = isRecord(metadata.identity) ? metadata.identity : {};

  return asString(metadata.canonical_user_id)
    ?? asString(identity.canonical_user_id)
    ?? asString(personalMemory.user_id)
    ?? ctx.session.user_id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
