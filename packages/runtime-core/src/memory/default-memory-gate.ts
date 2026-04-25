import type { MemoryProvider, MemoryRetrievalPlan, ModuleContext } from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";
import { BaseMemoryGate } from "./memory-gate.js";

export class DefaultMemoryGate extends BaseMemoryGate {
  public readonly name = "default-memory-gate";

  public async plan(input: {
    ctx: ModuleContext;
    providers: MemoryProvider[];
  }): Promise<MemoryRetrievalPlan> {
    const retrievalTopK = input.ctx.memory_config?.retrieval_top_k ?? 5;
    const availableLayers = this.layersForProviders(input.providers);
    const requestedLayers = availableLayers.filter((layer) => {
      if (layer === "working") {
        return input.ctx.profile.memory_config.working_memory_enabled !== false;
      }
      if (layer === "episodic") {
        return input.ctx.profile.memory_config.episodic_memory_enabled !== false;
      }
      if (layer === "semantic") {
        return input.ctx.profile.memory_config.semantic_memory_enabled !== false;
      }
      return input.ctx.profile.memory_config.procedural_memory_enabled !== false;
    });
    const stageOrder: MemoryRetrievalPlan["stage_order"] = ["summary", "experience", "evidence"];

    return {
      plan_id: generateId("mrp"),
      session_id: input.ctx.session.session_id,
      cycle_id: input.ctx.session.current_cycle_id ?? generateId("cyc"),
      requested_layers: requestedLayers,
      stage_order: stageOrder,
      top_k_by_layer: {
        working: Math.min(3, retrievalTopK),
        episodic: retrievalTopK,
        semantic: Math.max(2, Math.ceil(retrievalTopK * 0.7)),
        procedural: Math.max(1, Math.ceil(retrievalTopK * 0.5))
      },
      evidence_budget: Math.max(1, Math.ceil(retrievalTopK * 0.6)),
      rationale: buildRationale(input.ctx, requestedLayers, retrievalTopK),
      created_at: nowIso()
    };
  }
}

function buildRationale(ctx: ModuleContext, layers: string[], retrievalTopK: number): string {
  const currentInput = typeof ctx.runtime_state.current_input_content === "string"
    ? ctx.runtime_state.current_input_content
    : "";
  return `Retrieve ${layers.join(", ")} with top_k=${retrievalTopK} for input="${currentInput.slice(0, 120)}".`;
}
