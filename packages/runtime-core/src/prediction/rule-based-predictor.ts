import type {
  CandidateAction,
  ModuleContext,
  Prediction,
  PredictionError,
  Predictor
} from "@neurocore/protocol";

interface ActionHistory {
  totalExecutions: number;
  failureCount: number;
  avgDurationMs: number;
  errorCount: number;
}

export class RuleBasedPredictor implements Predictor {
  public readonly name = "rule-based-predictor";
  private readonly actionHistory = new Map<string, ActionHistory>();
  private baseUncertainty = 0.2;

  public async predict(ctx: ModuleContext, action: CandidateAction): Promise<Prediction | null> {
    const historyKey = this.historyKey(action);
    const history = this.actionHistory.get(historyKey);

    let successProbability: number;
    let estimatedDurationMs: number | undefined;
    let uncertainty: number;

    if (history && history.totalExecutions > 0) {
      const failureRate = history.failureCount / history.totalExecutions;
      successProbability = 1 - failureRate;
      estimatedDurationMs = Math.round(history.avgDurationMs);
      uncertainty = Math.min(0.9, this.baseUncertainty + (history.errorCount * 0.05));
    } else {
      successProbability = this.defaultSuccessProbability(action);
      uncertainty = this.baseUncertainty + 0.1;
    }

    const sideEffects = this.predictSideEffects(action);

    return {
      prediction_id: ctx.services.generateId("prd"),
      session_id: ctx.session.session_id,
      cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
      action_id: action.action_id,
      predictor_name: this.name,
      expected_outcome: `Action "${action.title}" expected to ${successProbability >= 0.5 ? "succeed" : "fail"}.`,
      success_probability: successProbability,
      side_effects: sideEffects,
      estimated_duration_ms: estimatedDurationMs,
      uncertainty,
      reasoning: history
        ? `Based on ${history.totalExecutions} historical executions (${history.failureCount} failures).`
        : "No historical data; using rule-based defaults.",
      created_at: ctx.services.now()
    };
  }

  public async recordError(error: PredictionError): Promise<void> {
    this.baseUncertainty = Math.min(0.9, this.baseUncertainty + 0.02);

    const key = error.action_id;
    const history = this.actionHistory.get(key);
    if (history) {
      history.errorCount += 1;
    }
  }

  public recordExecution(action: CandidateAction, succeeded: boolean, durationMs?: number): void {
    const key = this.historyKey(action);
    const history = this.actionHistory.get(key) ?? {
      totalExecutions: 0,
      failureCount: 0,
      avgDurationMs: 0,
      errorCount: 0
    };

    history.totalExecutions += 1;
    if (!succeeded) history.failureCount += 1;
    if (durationMs != null) {
      history.avgDurationMs =
        (history.avgDurationMs * (history.totalExecutions - 1) + durationMs) / history.totalExecutions;
    }

    this.actionHistory.set(key, history);
  }

  public getBaseUncertainty(): number {
    return this.baseUncertainty;
  }

  private historyKey(action: CandidateAction): string {
    if (action.action_type === "call_tool" && action.tool_name) {
      return `tool:${action.tool_name}`;
    }
    return `type:${action.action_type}`;
  }

  private defaultSuccessProbability(action: CandidateAction): number {
    switch (action.side_effect_level) {
      case "high": return 0.6;
      case "medium": return 0.75;
      case "low": return 0.85;
      default: return 0.9;
    }
  }

  private predictSideEffects(action: CandidateAction): string[] {
    if (action.side_effect_level === "high") {
      return ["state_mutation", "external_communication"];
    }
    if (action.side_effect_level === "medium") {
      return ["state_mutation"];
    }
    return [];
  }
}
