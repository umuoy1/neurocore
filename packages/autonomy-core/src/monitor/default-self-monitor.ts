import type {
  DriftSignal,
  HealthReport,
  ModuleContext,
  ModuleHealth,
  RecoveryAction,
  SelfMonitor
} from "@neurocore/protocol";
import { InMemoryAutonomyHealthStore } from "./in-memory-health-store.js";

function clampStatus(score: number): ModuleHealth["status"] {
  if (score >= 0.75) {
    return "healthy";
  }
  if (score >= 0.45) {
    return "degraded";
  }
  return "failed";
}

export class DefaultSelfMonitor implements SelfMonitor {
  public readonly name = "default-self-monitor";

  public constructor(
    private readonly healthStore: InMemoryAutonomyHealthStore = new InMemoryAutonomyHealthStore()
  ) {}

  public async inspect(
    ctx: ModuleContext,
    state: import("@neurocore/protocol").AutonomyState
  ): Promise<HealthReport> {
    const traceRecords = Array.isArray(ctx.runtime_state.trace_records)
      ? (ctx.runtime_state.trace_records as Array<Record<string, unknown>>)
      : [];
    const recentFailures = traceRecords.filter((record) => {
      const observation = record.observation as Record<string, unknown> | undefined;
      return observation?.status === "failure";
    }).length;
    const failureRate = traceRecords.length > 0 ? recentFailures / traceRecords.length : 0;
    const predictionErrorRate =
      typeof ctx.runtime_state.recent_prediction_error_rate === "number"
        ? ctx.runtime_state.recent_prediction_error_rate
        : 0;
    const timeoutRate =
      typeof ctx.runtime_state.recent_timeout_rate === "number"
        ? ctx.runtime_state.recent_timeout_rate
        : 0;
    const forgettingRate =
      state.performance_baseline &&
      typeof state.performance_baseline.metrics.success_rate === "number"
        ? Math.max(
            0,
            state.performance_baseline.metrics.success_rate -
              (typeof ctx.runtime_state.recent_success_rate === "number"
                ? ctx.runtime_state.recent_success_rate
                : 0)
          )
        : 0;
    const planHealthScore = Math.max(0, 1 - failureRate - timeoutRate * 0.5);
    const executionHealthScore = Math.max(0, 1 - predictionErrorRate - failureRate * 0.5);
    const learningHealthScore = Math.max(0, 1 - forgettingRate);
    const modules: ModuleHealth[] = [
      {
        module_name: "planner",
        status: clampStatus(planHealthScore),
        summary: `Planner health score ${planHealthScore.toFixed(2)}.`,
        metrics: { failure_rate: failureRate, timeout_rate: timeoutRate },
        updated_at: ctx.services.now()
      },
      {
        module_name: "execution",
        status: clampStatus(executionHealthScore),
        summary: `Execution health score ${executionHealthScore.toFixed(2)}.`,
        metrics: { prediction_error_rate: predictionErrorRate, failure_rate: failureRate },
        updated_at: ctx.services.now()
      },
      {
        module_name: "continual_learning",
        status: clampStatus(learningHealthScore),
        summary: `Continual learning health score ${learningHealthScore.toFixed(2)}.`,
        metrics: { forgetting_rate: forgettingRate },
        updated_at: ctx.services.now()
      }
    ];
    const overallStatus =
      modules.some((module) => module.status === "failed")
        ? "failed"
        : modules.some((module) => module.status === "degraded")
          ? "degraded"
          : "healthy";
    const report: HealthReport = {
      report_id: ctx.services.generateId("hrp"),
      session_id: ctx.session.session_id,
      overall_status: overallStatus,
      modules,
      summary: `Autonomy health is ${overallStatus}.`,
      created_at: ctx.services.now()
    };
    this.healthStore.append(report);
    return report;
  }

  public async detectDrift(
    ctx: ModuleContext,
    state: import("@neurocore/protocol").AutonomyState
  ): Promise<DriftSignal[]> {
    const traceRecords = Array.isArray(ctx.runtime_state.trace_records)
      ? (ctx.runtime_state.trace_records as Array<Record<string, unknown>>)
      : [];
    const recentFailures = traceRecords.filter((record) => {
      const observation = record.observation as Record<string, unknown> | undefined;
      return observation?.status === "failure";
    }).length;
    const failureRate = traceRecords.length > 0 ? recentFailures / traceRecords.length : 0;
    const predictionErrorRate =
      typeof ctx.runtime_state.recent_prediction_error_rate === "number"
        ? ctx.runtime_state.recent_prediction_error_rate
        : 0;
    const driftSignals: DriftSignal[] = [];
    if (failureRate >= (ctx.profile.autonomy_config?.drift_failure_rate_threshold ?? 0.45)) {
      driftSignals.push({
        drift_id: ctx.services.generateId("drf"),
        session_id: ctx.session.session_id,
        category: "performance",
        severity: failureRate >= 0.8 ? "critical" : "high",
        summary: `Failure rate drift detected at ${failureRate.toFixed(2)}.`,
        detected_at: ctx.services.now()
      });
    }
    if (predictionErrorRate >= (ctx.profile.autonomy_config?.drift_error_rate_threshold ?? 0.35)) {
      driftSignals.push({
        drift_id: ctx.services.generateId("drf"),
        session_id: ctx.session.session_id,
        category: "behavior",
        severity: predictionErrorRate >= 0.7 ? "critical" : "medium",
        summary: `Prediction error drift detected at ${predictionErrorRate.toFixed(2)}.`,
        detected_at: ctx.services.now()
      });
    }
    const forgettingRate =
      state.performance_baseline &&
      typeof state.performance_baseline.metrics.success_rate === "number"
        ? Math.max(
            0,
            state.performance_baseline.metrics.success_rate -
              (typeof ctx.runtime_state.recent_success_rate === "number"
                ? ctx.runtime_state.recent_success_rate
                : 0)
          )
        : 0;
    if (forgettingRate >= 0.2) {
      driftSignals.push({
        drift_id: ctx.services.generateId("drf"),
        session_id: ctx.session.session_id,
        category: "distribution",
        severity: forgettingRate >= 0.4 ? "high" : "medium",
        summary: `Forgetting drift detected at ${forgettingRate.toFixed(2)}.`,
        detected_at: ctx.services.now()
      });
    }
    return driftSignals;
  }

  public async recommendRecovery(
    ctx: ModuleContext,
    _state: import("@neurocore/protocol").AutonomyState,
    healthReport: HealthReport
  ): Promise<RecoveryAction[]> {
    if (healthReport.overall_status === "healthy") {
      return [];
    }
    return [
      {
        recovery_action_id: ctx.services.generateId("rcv"),
        session_id: ctx.session.session_id,
        action_type: healthReport.overall_status === "failed" ? "request_approval" : "replan",
        status: "planned",
        summary:
          healthReport.overall_status === "failed"
            ? "Escalate failed autonomous execution for human review."
            : "Revise autonomous plan to recover from degraded execution.",
        created_at: ctx.services.now()
      }
    ];
  }

  public list(sessionId: string): HealthReport[] {
    return this.healthStore.list(sessionId);
  }

  public deleteSession(sessionId: string): void {
    this.healthStore.deleteSession(sessionId);
  }
}
