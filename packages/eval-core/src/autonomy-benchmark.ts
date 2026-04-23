import type { CycleTraceRecord, NeuroCoreEvent } from "@neurocore/protocol";

export interface AutonomyBenchmarkSession {
  session_id: string;
  events: NeuroCoreEvent[];
  traces: CycleTraceRecord[];
}

export interface AutonomyBenchmarkSummary {
  session_count: number;
  plan_generation_rate: number;
  self_goal_generation_rate: number;
  drift_detection_rate: number;
  recovery_trigger_rate: number;
  transfer_validation_rate: number;
  consolidation_rate: number;
  autonomy_trace_coverage: number;
  autonomy_decision_coverage: number;
  autonomy_score: number;
}

export function summarizeAutonomyBenchmark(
  sessions: AutonomyBenchmarkSession[]
): AutonomyBenchmarkSummary {
  if (sessions.length === 0) {
    return {
      session_count: 0,
      plan_generation_rate: 0,
      self_goal_generation_rate: 0,
      drift_detection_rate: 0,
      recovery_trigger_rate: 0,
      transfer_validation_rate: 0,
      consolidation_rate: 0,
      autonomy_trace_coverage: 0,
      autonomy_decision_coverage: 0,
      autonomy_score: 0
    };
  }

  const perSession = sessions.map((session) => {
    const eventTypes = new Set(session.events.map((event) => event.event_type));
    const traceCount = session.traces.length;
    const tracesWithAutonomyState = session.traces.filter((trace) => trace.autonomy_state).length;
    const tracesWithAutonomyDecision = session.traces.filter((trace) => trace.autonomy_decision).length;
    return {
      planGenerated: eventTypes.has("plan.generated") ? 1 : 0,
      selfGoalGenerated: eventTypes.has("goal.self_generated") ? 1 : 0,
      driftDetected: eventTypes.has("drift.detected") ? 1 : 0,
      recoveryTriggered: eventTypes.has("recovery.triggered") ? 1 : 0,
      transferValidated: eventTypes.has("transfer.validated") ? 1 : 0,
      consolidationCompleted: eventTypes.has("consolidation.completed") ? 1 : 0,
      autonomyTraceCoverage: traceCount > 0 ? tracesWithAutonomyState / traceCount : 0,
      autonomyDecisionCoverage: traceCount > 0 ? tracesWithAutonomyDecision / traceCount : 0
    };
  });

  const summary: AutonomyBenchmarkSummary = {
    session_count: sessions.length,
    plan_generation_rate: average(perSession.map((item) => item.planGenerated)),
    self_goal_generation_rate: average(perSession.map((item) => item.selfGoalGenerated)),
    drift_detection_rate: average(perSession.map((item) => item.driftDetected)),
    recovery_trigger_rate: average(perSession.map((item) => item.recoveryTriggered)),
    transfer_validation_rate: average(perSession.map((item) => item.transferValidated)),
    consolidation_rate: average(perSession.map((item) => item.consolidationCompleted)),
    autonomy_trace_coverage: average(perSession.map((item) => item.autonomyTraceCoverage)),
    autonomy_decision_coverage: average(perSession.map((item) => item.autonomyDecisionCoverage)),
    autonomy_score: 0
  };

  summary.autonomy_score = clamp01(
    summary.plan_generation_rate * 0.15 +
      summary.self_goal_generation_rate * 0.15 +
      summary.drift_detection_rate * 0.15 +
      summary.recovery_trigger_rate * 0.15 +
      summary.transfer_validation_rate * 0.1 +
      summary.consolidation_rate * 0.1 +
      summary.autonomy_trace_coverage * 0.1 +
      summary.autonomy_decision_coverage * 0.1
  );

  return summary;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
