import type {
  CandidateAction,
  ControlAllocator,
  FastMetaAssessment,
  MetaAssessment,
  MetaControlAction,
  MetaDecisionV2,
  ModuleContext,
  PolicyDecision,
  Prediction
} from "@neurocore/protocol";

interface ScoredCandidate {
  action: CandidateAction;
  salience: number;
  risk: number;
  confidence: number;
  score: number;
}

export class DefaultControlAllocator implements ControlAllocator {
  public async decide(input: {
    ctx: ModuleContext;
    actions: CandidateAction[];
    predictions: Prediction[];
    policies: PolicyDecision[];
    workspace: import("@neurocore/protocol").WorkspaceSnapshot;
    budgetAssessment?: import("@neurocore/protocol").BudgetAssessment;
    fastAssessment: FastMetaAssessment;
    metaAssessment: MetaAssessment;
    predictionErrorRate?: number;
  }): Promise<MetaDecisionV2> {
    const budgetAssessment = input.budgetAssessment ?? input.workspace.budget_assessment;
    if (budgetAssessment && !budgetAssessment.within_budget) {
      return {
        decision_id: input.ctx.services.generateId("mdv2"),
        session_id: input.ctx.session.session_id,
        cycle_id: input.workspace.cycle_id,
        control_action: "abort",
        requires_approval: false,
        decision_source: "fast",
        confidence: 0,
        meta_state: input.metaAssessment.meta_state,
        rationale: budgetAssessment.summary ?? "Budget exceeded.",
        rejection_reasons: [budgetAssessment.summary ?? "Budget exceeded."],
        budget_summary: budgetAssessment.summary
      };
    }

    const blockedActionIds = new Set<string>(
      input.policies
        .filter((decision) => decision.level === "block" && decision.target_id != null)
        .map((decision) => decision.target_id!)
    );
    const candidates = input.actions.filter((action) => !blockedActionIds.has(action.action_id));
    if (candidates.length === 0) {
      return {
        decision_id: input.ctx.services.generateId("mdv2"),
        session_id: input.ctx.session.session_id,
        cycle_id: input.workspace.cycle_id,
        control_action: "abort",
        requires_approval: false,
        decision_source: sourceOf(input.metaAssessment),
        confidence: 0,
        meta_state: input.metaAssessment.meta_state,
        rationale: "No executable action remained after policy evaluation.",
        rejection_reasons: ["All candidate actions are blocked by policy."],
        risk_summary: "All candidate actions are blocked by policy."
      };
    }

    const scored = this.scoreAndRank(candidates, input.predictions, input.policies);
    const controlAction = normalizeFinalControlAction(
      input.fastAssessment,
      input.metaAssessment,
      candidates,
      input.policies
    );
    const selected = this.resolveSelected(scored, input.predictions, controlAction, input.metaAssessment);
    const confidence = resolveDecisionConfidence(input.fastAssessment, input.metaAssessment);
    const requiresApproval = controlAction === "execute-with-approval" || controlAction === "ask-human";
    const rationale = input.metaAssessment.rationale || input.fastAssessment.rationale;

    return {
      decision_id: input.ctx.services.generateId("mdv2"),
      session_id: input.ctx.session.session_id,
      cycle_id: input.workspace.cycle_id,
      control_action: controlAction,
      selected_action_id: selected?.action.action_id,
      requires_approval: requiresApproval,
      decision_source: sourceOf(input.metaAssessment),
      confidence,
      meta_state: input.metaAssessment.meta_state,
      verification_trace: input.metaAssessment.verification_trace,
      rationale,
      rejection_reasons: controlAction === "abort" ? [rationale] : undefined,
      risk_summary: buildRiskSummary(selected, input.policies, input.predictionErrorRate, input.metaAssessment)
    };
  }

  private scoreAndRank(
    candidates: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[]
  ): ScoredCandidate[] {
    const warnedIds = new Set(
      policies.filter((decision) => decision.level === "warn").map((decision) => decision.target_id)
    );

    const scored: ScoredCandidate[] = candidates.map((action) => {
      const prediction = predictions.find((row) => row.action_id === action.action_id);
      const uncertainty = prediction?.uncertainty ?? 0;
      const risk = uncertainty;
      const confidence = prediction ? Math.max(0.1, 1 - uncertainty) : 0.6;
      const salience = prediction?.success_probability ?? 0.5;
      const warnPenalty = warnedIds.has(action.action_id) ? 0.15 : 0;
      const sideEffectPenalty = action.side_effect_level === "high" ? 0.1 : 0;
      const score = salience * 0.4 + confidence * 0.35 + (1 - risk) * 0.25 - warnPenalty - sideEffectPenalty;
      return { action, salience, risk, confidence, score };
    });

    scored.sort((left, right) => right.score - left.score);
    return scored;
  }

  private resolveSelected(
    scored: ScoredCandidate[],
    predictions: Prediction[],
    controlAction: MetaControlAction,
    metaAssessment: MetaAssessment
  ): ScoredCandidate | undefined {
    const byId = metaAssessment.recommended_candidate_action_id
      ? scored.find((candidate) => candidate.action.action_id === metaAssessment.recommended_candidate_action_id)
      : undefined;

    if (controlAction === "request-more-evidence") {
      return interactiveCandidate(scored, ["ask_user"]) ??
        interactiveCandidate(scored, ["respond"]) ??
        nonToolCandidate(byId) ??
        safestNonToolCandidate(scored) ??
        safestLowRiskExecutionCandidate(scored);
    }

    if (controlAction === "switch-to-safe-response") {
      return interactiveCandidate(scored, ["respond", "ask_user"]) ??
        nonToolCandidate(byId) ??
        safestNonToolCandidate(scored) ??
        safestLowRiskExecutionCandidate(scored);
    }

    if (controlAction === "ask-human" || controlAction === "execute-with-approval" || controlAction === "execute-now") {
      return byId ?? bestPredictedCandidate(scored, predictions) ?? scored[0];
    }

    return byId ?? safestCandidate(scored) ?? scored[0];
  }
}

function normalizeFinalControlAction(
  fastAssessment: FastMetaAssessment,
  metaAssessment: MetaAssessment,
  candidates: CandidateAction[],
  policies: PolicyDecision[]
): MetaControlAction {
  const warnedIds = new Set(
    policies
      .filter((decision) => decision.level === "warn" && typeof decision.target_id === "string")
      .map((decision) => decision.target_id as string)
  );
  const hasWarnedCandidate = candidates.some((candidate) => warnedIds.has(candidate.action_id));
  const hasApprovalCandidate = candidates.some((candidate) => hasElevatedExecutionRisk(candidate));
  const hasInteractiveCandidate = candidates.some((candidate) => isInteractiveAction(candidate));
  const requestMoreEvidenceFallback = hasInteractiveCandidate
    ? "request-more-evidence"
    : hasApprovalCandidate
      ? "execute-with-approval"
      : "execute-now";

  if (hasWarnedCandidate) {
    return "execute-with-approval";
  }

  const calibratedConfidence =
    metaAssessment.calibrated_confidence ??
    metaAssessment.confidence.overall_confidence ??
    fastAssessment.provisional_confidence;

  if (calibratedConfidence < 0.3) {
    return candidates.some((candidate) => candidate.action_type === "ask_user")
      ? "request-more-evidence"
      : hasApprovalCandidate && !hasInteractiveCandidate
        ? "execute-with-approval"
        : hasInteractiveCandidate
          ? "switch-to-safe-response"
          : "execute-now";
  }

  if (metaAssessment.meta_state === "high-risk" && calibratedConfidence < 0.55) {
    return hasApprovalCandidate ? "ask-human" : "switch-to-safe-response";
  }

  const preferred = metaAssessment.recommended_control_action;
  if (preferred === "switch-to-safe-response" && !hasInteractiveCandidate && hasApprovalCandidate) {
    return "execute-with-approval";
  }
  if (
    preferred === "execute-now" ||
    preferred === "execute-with-approval" ||
    preferred === "switch-to-safe-response" ||
    preferred === "ask-human" ||
    preferred === "abort"
  ) {
    return preferred;
  }
  if (preferred === "request-more-evidence") {
    return requestMoreEvidenceFallback;
  }

  if (fastAssessment.meta_state === "evidence-insufficient") {
    return requestMoreEvidenceFallback;
  }
  if (fastAssessment.meta_state === "high-risk") {
    return "execute-with-approval";
  }
  if (fastAssessment.meta_state === "simulation-unreliable") {
    return "switch-to-safe-response";
  }
  return "switch-to-safe-response";
}

function safestCandidate(scored: ScoredCandidate[]) {
  return [...scored].sort((left, right) => compareSafety(left.action, right.action))[0];
}

function safestNonToolCandidate(scored: ScoredCandidate[]) {
  return [...scored]
    .filter((candidate) => candidate.action.action_type !== "call_tool")
    .sort((left, right) => compareSafety(left.action, right.action))[0];
}

function safestLowRiskExecutionCandidate(scored: ScoredCandidate[]) {
  return [...scored]
    .filter((candidate) => !hasElevatedExecutionRisk(candidate.action))
    .sort((left, right) => compareSafety(left.action, right.action))[0];
}

function interactiveCandidate(scored: ScoredCandidate[], actionTypes: Array<"respond" | "ask_user">) {
  return [...scored]
    .filter((candidate) => actionTypes.includes(candidate.action.action_type as "respond" | "ask_user"))
    .sort((left, right) => compareSafety(left.action, right.action))[0];
}

function nonToolCandidate(candidate: ScoredCandidate | undefined) {
  return candidate?.action.action_type === "call_tool" ? undefined : candidate;
}

function bestPredictedCandidate(scored: ScoredCandidate[], predictions: Prediction[]) {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.action_id, prediction]));
  return [...scored].sort((left, right) => {
    const leftPrediction = predictionMap.get(left.action.action_id);
    const rightPrediction = predictionMap.get(right.action.action_id);
    return (rightPrediction?.success_probability ?? right.score) - (leftPrediction?.success_probability ?? left.score);
  })[0];
}

function compareSafety(left: CandidateAction, right: CandidateAction) {
  return safetyRank(left) - safetyRank(right);
}

function isInteractiveAction(action: CandidateAction) {
  return action.action_type === "respond" || action.action_type === "ask_user";
}

function hasElevatedExecutionRisk(action: CandidateAction) {
  return action.side_effect_level === "high";
}

function safetyRank(action: CandidateAction) {
  const typeRank =
    action.action_type === "respond"
      ? 0
      : action.action_type === "ask_user"
        ? 1
        : action.action_type === "call_tool"
          ? 2
          : 3;
  const sideEffectRank =
    action.side_effect_level === "high"
      ? 3
      : action.side_effect_level === "medium"
        ? 2
        : action.side_effect_level === "low"
          ? 1
          : 0;
  return typeRank * 10 + sideEffectRank;
}

function resolveDecisionConfidence(
  fastAssessment: FastMetaAssessment,
  metaAssessment: MetaAssessment
) {
  const value =
    metaAssessment.calibrated_confidence ??
    metaAssessment.confidence.overall_confidence ??
    fastAssessment.provisional_confidence;
  return Math.max(0.03, Math.min(0.99, value));
}

function sourceOf(metaAssessment: MetaAssessment): "fast" | "deep" {
  return metaAssessment.deep_evaluation_used ? "deep" : "fast";
}

function buildRiskSummary(
  selected: ScoredCandidate | undefined,
  policies: PolicyDecision[],
  predictionErrorRate: number | undefined,
  metaAssessment: MetaAssessment
) {
  const reasons: string[] = [];
  if (selected?.action.side_effect_level === "high") {
    reasons.push("action has high side-effect level");
  }
  const warnedPolicies = selected
    ? policies.filter((decision) => decision.level === "warn" && decision.target_id === selected.action.action_id)
    : [];
  if (warnedPolicies.length > 0) {
    reasons.push(`warned by policy: ${warnedPolicies.map((row) => row.reason ?? row.policy_name).join(", ")}`);
  }
  if (selected && selected.risk > 0.5) {
    reasons.push(`high prediction uncertainty (${selected.risk.toFixed(2)})`);
  }
  if (predictionErrorRate != null && predictionErrorRate >= 0.5) {
    reasons.push(`high prediction error rate (${(predictionErrorRate * 100).toFixed(0)}%)`);
  }
  if (metaAssessment.meta_state === "high-risk") {
    reasons.push("metacognitive state is high-risk");
  }
  if (metaAssessment.bucket_reliability != null && metaAssessment.bucket_reliability < 0.5) {
    reasons.push(`low calibration reliability (${metaAssessment.bucket_reliability.toFixed(2)})`);
  }
  if (reasons.length === 0) {
    return "Low risk. No policy warnings or high-uncertainty signals.";
  }
  return reasons.join("; ") + ".";
}
