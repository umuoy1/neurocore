import type { CandidateAction, ModuleContext } from "@neurocore/protocol";
import type { WorldStateGraph } from "../graph/world-state-graph.js";
import type { ForwardSimulator, SimulationResult } from "./forward-simulator.js";

let simCounter = 0;

export class RuleBasedSimulator implements ForwardSimulator {
  async simulate(
    current_state: WorldStateGraph,
    action: CandidateAction,
    _context: ModuleContext
  ): Promise<SimulationResult> {
    const simId = `sim-${++simCounter}`;

    const preconditionsMet = this.checkPreconditions(current_state, action);

    if (!preconditionsMet) {
      return {
        simulation_id: simId,
        action_id: action.action_id,
        predicted_diff: {
          added_entities: [],
          updated_entities: [],
          removed_entity_ids: [],
          added_relations: [],
          removed_relation_ids: []
        },
        success_probability: 0,
        risk_score: 0.5,
        side_effects: [],
        estimated_duration_ms: 0,
        confidence: 0.8,
        reasoning: `Preconditions not met: ${(action.preconditions ?? []).join(", ")}`
      };
    }

    const riskScore = this.inferRiskScore(action);
    const successProbability = this.inferSuccessProbability(action);
    const sideEffects = this.inferSideEffects(action);
    const estimatedDuration = this.inferDuration(action);

    return {
      simulation_id: simId,
      action_id: action.action_id,
      predicted_diff: {
        added_entities: [],
        updated_entities: [],
        removed_entity_ids: [],
        added_relations: [],
        removed_relation_ids: []
      },
      success_probability: successProbability,
      risk_score: riskScore,
      side_effects: sideEffects,
      estimated_duration_ms: estimatedDuration,
      confidence: 0.6,
      reasoning: `Rule-based simulation for ${action.action_type} action`
    };
  }

  private checkPreconditions(state: WorldStateGraph, action: CandidateAction): boolean {
    if (!action.preconditions || action.preconditions.length === 0) return true;

    for (const precondition of action.preconditions) {
      const match = precondition.match(/^entity:([^:]+):(\w+)=(.+)$/);
      if (match) {
        const [, entityId, prop, expectedValue] = match;
        const entity = state.getEntity(entityId);
        if (!entity) return false;
        if (String(entity.properties[prop]) !== expectedValue) return false;
      }
    }
    return true;
  }

  private inferRiskScore(action: CandidateAction): number {
    const riskMap: Record<string, number> = {
      none: 0.0,
      low: 0.2,
      medium: 0.5,
      high: 0.8
    };
    return riskMap[action.side_effect_level ?? "none"] ?? 0.3;
  }

  private inferSuccessProbability(action: CandidateAction): number {
    const probMap: Record<string, number> = {
      respond: 0.95,
      ask_user: 0.9,
      call_tool: 0.8,
      update_goal: 0.9,
      write_memory: 0.95,
      delegate: 0.7,
      wait: 0.95,
      complete: 0.9,
      abort: 1.0
    };
    return probMap[action.action_type] ?? 0.7;
  }

  private inferSideEffects(action: CandidateAction): string[] {
    if (action.side_effect_level === "none") return [];
    if (action.action_type === "call_tool") return ["tool_execution"];
    if (action.action_type === "respond") return ["user_communication"];
    return [];
  }

  private inferDuration(action: CandidateAction): number {
    const durationMap: Record<string, number> = {
      respond: 100,
      ask_user: 200,
      call_tool: 5000,
      update_goal: 50,
      write_memory: 100,
      delegate: 10000,
      wait: 0,
      complete: 50,
      abort: 50
    };
    return durationMap[action.action_type] ?? 1000;
  }
}
