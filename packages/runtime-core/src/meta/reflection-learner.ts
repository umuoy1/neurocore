import type {
  CandidateAction,
  MetaAssessment,
  Observation,
  ReflectionRule,
  ReflectionStore
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";
import { InMemoryReflectionStore } from "./in-memory-reflection-store.js";

export interface ReflectionLearnInput {
  sessionId: string;
  cycleId: string;
  taskBucket?: string;
  riskLevel?: string;
  action: CandidateAction;
  observation: Observation;
  metaAssessment?: MetaAssessment;
}

export class ReflectionLearner {
  public constructor(private readonly store: ReflectionStore = new InMemoryReflectionStore()) {}

  public findApplicableRule(taskBucket?: string, riskLevel?: string) {
    if (!taskBucket) {
      return undefined;
    }
    return this.store.findByTaskBucket(taskBucket, riskLevel)[0];
  }

  public learn(input: ReflectionLearnInput): ReflectionRule | null {
    if (input.observation.status !== "failure") {
      return null;
    }

    const taskBucket = input.taskBucket;
    if (!taskBucket) {
      return null;
    }

    const recommended = deriveRecommendedControlAction(input);
    const existing = this.findApplicableRule(taskBucket, input.riskLevel);
    const timestamp = nowIso();
    const nextEvidenceCount = (existing?.evidence_count ?? 0) + 1;
    const strength = clamp01(
      existing
        ? Math.max(existing.strength, 0.35) + 0.15
        : 0.4 + Math.min(0.4, (nextEvidenceCount - 1) * 0.1)
    );
    const rule: ReflectionRule = {
      rule_id: existing?.rule_id ?? generateId("rfr"),
      pattern: `task_bucket:${taskBucket}`,
      task_bucket: taskBucket,
      risk_level: input.riskLevel,
      trigger_conditions: buildTriggerConditions(taskBucket, input.riskLevel, input.metaAssessment),
      failure_modes: input.metaAssessment?.failure_modes,
      recommended_control_action: recommended,
      strength,
      evidence_count: nextEvidenceCount,
      session_id: input.sessionId,
      cycle_id: input.cycleId,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    };

    this.store.save(rule);
    return rule;
  }

  public list(sessionId?: string) {
    return this.store.list(sessionId);
  }

  public deleteSession(sessionId: string) {
    this.store.deleteSession(sessionId);
  }
}

function deriveRecommendedControlAction(input: ReflectionLearnInput): ReflectionRule["recommended_control_action"] {
  const failureModes = new Set(input.metaAssessment?.failure_modes ?? []);
  if (input.riskLevel === "high" || input.action.side_effect_level === "high") {
    return "execute-with-approval";
  }
  if (
    failureModes.has("insufficient_evidence") ||
    failureModes.has("retrieval_miss") ||
    failureModes.has("stale_memory")
  ) {
    return "request-more-evidence";
  }
  if (failureModes.has("bad_plan") || failureModes.has("wrong_assumption")) {
    return "replan";
  }
  if (failureModes.has("tool_failure") || failureModes.has("policy_block")) {
    return "switch-to-safe-response";
  }
  if (failureModes.has("overconfidence")) {
    return "request-more-evidence";
  }
  return "switch-to-safe-response";
}

function buildTriggerConditions(taskBucket: string, riskLevel: string | undefined, metaAssessment?: MetaAssessment) {
  const conditions = [`task_bucket=${taskBucket}`];
  if (riskLevel) {
    conditions.push(`risk_level=${riskLevel}`);
  }
  for (const failureMode of metaAssessment?.failure_modes ?? []) {
    conditions.push(`failure_mode=${failureMode}`);
  }
  return conditions;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
