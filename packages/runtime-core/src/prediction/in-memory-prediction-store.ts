import type { Prediction, PredictionError, PredictionStore } from "@neurocore/protocol";

export class InMemoryPredictionStore implements PredictionStore {
  private readonly predictions = new Map<string, Prediction[]>();
  private readonly errors = new Map<string, PredictionError[]>();

  public recordPrediction(prediction: Prediction): void {
    const list = this.predictions.get(prediction.session_id) ?? [];
    list.push(prediction);
    this.predictions.set(prediction.session_id, list);
  }

  public recordError(error: PredictionError): void {
    const list = this.errors.get(error.session_id) ?? [];
    list.push(error);
    this.errors.set(error.session_id, list);
  }

  public listErrors(sessionId: string): PredictionError[] {
    return this.errors.get(sessionId) ?? [];
  }

  public getErrorsByAction(sessionId: string, actionId: string): PredictionError[] {
    return (this.errors.get(sessionId) ?? []).filter((e) => e.action_id === actionId);
  }

  public getRecentErrorRate(sessionId: string, windowSize: number): number {
    const errors = this.errors.get(sessionId) ?? [];
    if (errors.length === 0) return 0;

    const cycleIds = [...new Set(errors.map((e) => e.cycle_id))];
    const recentCycleIds = cycleIds.slice(-windowSize);
    if (recentCycleIds.length === 0) return 0;

    const recentCycleSet = new Set(recentCycleIds);
    const cyclesWithSignificantErrors = new Set<string>();

    for (const error of errors) {
      if (recentCycleSet.has(error.cycle_id) && (error.severity === "medium" || error.severity === "high")) {
        cyclesWithSignificantErrors.add(error.cycle_id);
      }
    }

    return cyclesWithSignificantErrors.size / recentCycleIds.length;
  }

  public deleteSession(sessionId: string): void {
    this.predictions.delete(sessionId);
    this.errors.delete(sessionId);
  }
}
