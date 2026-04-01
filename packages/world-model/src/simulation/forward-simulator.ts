import type { CandidateAction, ModuleContext } from "@neurocore/protocol";
import type { WorldStateDiff } from "../types.js";
import type { WorldStateGraph } from "../graph/world-state-graph.js";

export interface SimulationResult {
  simulation_id: string;
  action_id: string;
  predicted_diff: WorldStateDiff;
  success_probability: number;
  risk_score: number;
  side_effects: string[];
  estimated_duration_ms: number;
  confidence: number;
  reasoning?: string;
}

export interface ForwardSimulator {
  simulate(
    current_state: WorldStateGraph,
    action: CandidateAction,
    context: ModuleContext
  ): Promise<SimulationResult>;

  simulateMultiple?(
    current_state: WorldStateGraph,
    actions: CandidateAction[],
    context: ModuleContext
  ): Promise<SimulationResult[]>;
}
