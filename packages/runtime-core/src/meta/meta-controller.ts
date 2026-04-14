import type {
  CandidateAction,
  MetaController as IMetaController,
  MetaDecision,
  MetaDecisionV2,
  ModuleContext,
  PolicyDecision,
  Prediction
} from "@neurocore/protocol";
import { toLegacyMetaDecision } from "./meta-decision.js";

export class DefaultMetaController implements IMetaController {
  public constructor(private readonly options?: { approvalThreshold?: number; autoApprove?: boolean }) {}

  public async evaluate(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[],
    predictionErrorRate?: number
  ): Promise<MetaDecision> {
    const decisionV2 = isMetaDecisionV2(ctx.runtime_state?.meta_decision_v2)
      ? ctx.runtime_state.meta_decision_v2
      : undefined;

    if (decisionV2) {
      return toLegacyMetaDecision(decisionV2);
    }

    return legacyFallbackDecision(ctx, actions, predictions, policies, predictionErrorRate, this.options?.approvalThreshold);
  }
}

function legacyFallbackDecision(
  ctx: ModuleContext,
  actions: CandidateAction[],
  predictions: Prediction[],
  policies: PolicyDecision[],
  predictionErrorRate?: number,
  approvalThreshold?: number
): MetaDecision {
  if (ctx.workspace?.budget_assessment && !ctx.workspace.budget_assessment.within_budget) {
    return {
      decision_type: "abort",
      rejection_reasons: [ctx.workspace.budget_assessment.summary ?? "Budget exceeded."],
      explanation: "Execution blocked: budget exhausted."
    };
  }

  const blockedActionIds = new Set<string>(
    policies
      .filter((decision) => decision.level === "block" && decision.target_id != null)
      .map((decision) => decision.target_id!)
  );
  const candidates = actions.filter((action) => !blockedActionIds.has(action.action_id));
  if (candidates.length === 0) {
    return {
      decision_type: "abort",
      rejection_reasons: ["All candidate actions are blocked by policy."],
      explanation: "No executable action remained after policy evaluation."
    };
  }

  const scored = [...candidates]
    .map((action) => {
      const prediction = predictions.find((row) => row.action_id === action.action_id);
      const uncertainty = prediction?.uncertainty ?? 0;
      const confidence = prediction ? Math.max(0.1, 1 - uncertainty) : 0.6;
      const salience = prediction?.success_probability ?? 0.5;
      const warnPenalty = policies.some((row) => row.level === "warn" && row.target_id === action.action_id) ? 0.15 : 0;
      const sideEffectPenalty = action.side_effect_level === "high" ? 0.1 : 0;
      const score = salience * 0.4 + confidence * 0.35 + (1 - uncertainty) * 0.25 - warnPenalty - sideEffectPenalty;
      return { action, confidence, score, uncertainty };
    })
    .sort((left, right) => right.score - left.score);

  const top = scored[0];
  let confidence = top.confidence;
  if (predictionErrorRate != null && predictionErrorRate > 0) {
    confidence = confidence * (1 - predictionErrorRate * 0.3);
  }

  const requiresApproval = Boolean(
    top.action.side_effect_level === "high" ||
    policies.some((row) => row.level === "warn" && row.target_id === top.action.action_id) ||
    top.uncertainty > (approvalThreshold ?? 0.7)
  );

  return {
    decision_type: requiresApproval ? "request_approval" : "execute_action",
    selected_action_id: top.action.action_id,
    confidence,
    requires_human_approval: requiresApproval,
    risk_summary: requiresApproval ? "Legacy fallback control path detected elevated risk." : undefined,
    explanation: "Selected by legacy fallback control path."
  };
}

function isMetaDecisionV2(value: unknown): value is MetaDecisionV2 {
  return Boolean(
    value &&
    typeof value === "object" &&
    "decision_id" in value &&
    "control_action" in value &&
    "decision_source" in value
  );
}
