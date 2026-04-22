import type {
  CandidateAction,
  ModuleContext,
  Prediction,
  PredictionError,
  Predictor
} from "@neurocore/protocol";
import type { WorldStateGraph } from "../graph/world-state-graph.js";
import type { ActiveInferenceEvaluator } from "../active-inference/active-inference-evaluator.js";
import type { ForwardSimulator } from "./forward-simulator.js";

let predictionCounter = 0;

export class SimulationBasedPredictor implements Predictor {
  public readonly name = "simulation-based";
  private readonly simulator: ForwardSimulator;
  private readonly worldStateGraph: WorldStateGraph;
  private readonly activeInferenceEvaluator?: ActiveInferenceEvaluator;

  constructor(
    simulator: ForwardSimulator,
    worldStateGraph: WorldStateGraph,
    activeInferenceEvaluator?: ActiveInferenceEvaluator
  ) {
    this.simulator = simulator;
    this.worldStateGraph = worldStateGraph;
    this.activeInferenceEvaluator = activeInferenceEvaluator;
  }

  async predict(ctx: ModuleContext, action: CandidateAction): Promise<Prediction | null> {
    try {
      const result = await this.simulator.simulate(this.worldStateGraph, action, ctx);
      const efe = this.activeInferenceEvaluator?.computeEFE({
        simulation: result,
        action,
        current_state: this.worldStateGraph
      });

      return {
        prediction_id: `pred-sim-${++predictionCounter}`,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? "",
        action_id: action.action_id,
        predictor_name: this.name,
        expected_outcome: result.reasoning ?? `Simulated ${action.action_type} action`,
        success_probability: result.success_probability,
        side_effects: result.side_effects,
        estimated_duration_ms: result.estimated_duration_ms,
        expected_free_energy: efe?.expected_free_energy,
        uncertainty: result.risk_score,
        reasoning: efe
          ? `${result.reasoning ?? `Simulated ${action.action_type}`} | efe=${efe.expected_free_energy} risk=${efe.risk} ambiguity=${efe.ambiguity} novelty=${efe.novelty}`
          : result.reasoning,
        created_at: new Date().toISOString()
      };
    } catch {
      return null;
    }
  }

  async recordError(_error: PredictionError): Promise<void> {
  }
}
