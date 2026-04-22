import type { CandidateAction } from "@neurocore/protocol";
import type { WorldStateGraph } from "../graph/world-state-graph.js";
import type { SimulationResult } from "../simulation/forward-simulator.js";

export interface FreeEnergyComponents {
  risk: number;
  ambiguity: number;
  novelty: number;
  expected_free_energy: number;
}

export interface ActiveInferenceEvaluator {
  computeEFE(input: {
    simulation: SimulationResult;
    action: CandidateAction;
    current_state?: WorldStateGraph;
    novelty_score?: number;
  }): FreeEnergyComponents;
}

export class DefaultActiveInferenceEvaluator implements ActiveInferenceEvaluator {
  public computeEFE(input: {
    simulation: SimulationResult;
    action: CandidateAction;
    current_state?: WorldStateGraph;
    novelty_score?: number;
  }): FreeEnergyComponents {
    const risk = clamp(input.simulation.risk_score, 0, 1);
    const ambiguity = clamp(1 - input.simulation.confidence, 0, 1);
    const novelty = clamp(
      typeof input.novelty_score === "number"
        ? input.novelty_score
        : inferNovelty(input.simulation, input.current_state, input.action),
      0,
      1
    );
    return {
      risk,
      ambiguity,
      novelty,
      expected_free_energy: round(risk + ambiguity - novelty)
    };
  }
}

function inferNovelty(
  simulation: SimulationResult,
  currentState: WorldStateGraph | undefined,
  action: CandidateAction
): number {
  const diffNovelty =
    simulation.predicted_diff.added_entities.length * 0.2 +
    simulation.predicted_diff.added_relations.length * 0.1 +
    simulation.predicted_diff.updated_entities.length * 0.05;
  const actionNovelty =
    action.action_type === "delegate"
      ? 0.25
      : action.action_type === "call_tool"
        ? 0.1
        : 0.05;
  const graphPressure = currentState
    ? Math.min(0.2, currentState.snapshot().entities.length / 100)
    : 0;
  return round(Math.min(1, diffNovelty + actionNovelty + graphPressure));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
