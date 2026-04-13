import type {
  CandidateAction,
  MetaAssessment,
  MetaControlAction,
  MetaController as IMetaController,
  MetaDecision,
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

export class DefaultMetaController implements IMetaController {
  public constructor(private readonly options?: { approvalThreshold?: number; autoApprove?: boolean }) {}

  public async evaluate(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[],
    predictionErrorRate?: number
  ): Promise<MetaDecision> {
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

    const scored = this.scoreAndRank(candidates, predictions, policies);
    let top = scored[0];
    const fastMetaAssessment = ctx.workspace?.metacognitive_state;
    const deepMetaAssessment = isMetaAssessment(ctx.runtime_state?.meta_assessment)
      ? ctx.runtime_state.meta_assessment
      : undefined;

    if (deepMetaAssessment?.recommended_candidate_action_id) {
      const recommended = scored.find(
        (candidate) => candidate.action.action_id === deepMetaAssessment.recommended_candidate_action_id
      );
      if (recommended) {
        top = recommended;
      }
    } else {
      const metaPreferred = this.selectMetaPreferredAction(candidates, scored, fastMetaAssessment, deepMetaAssessment);
      if (metaPreferred) {
        top = metaPreferred;
      }
    }

    if (predictionErrorRate != null && predictionErrorRate > 0) {
      top.confidence = top.confidence * (1 - predictionErrorRate * 0.3);
    }
    if (fastMetaAssessment) {
      top.confidence = Math.max(0.05, Math.min(0.99, (top.confidence + fastMetaAssessment.provisional_confidence) / 2));
    }
    if (deepMetaAssessment) {
      const calibratedConfidence =
        deepMetaAssessment.calibrated_confidence ?? deepMetaAssessment.confidence.overall_confidence;
      top.confidence = Math.max(0.03, Math.min(0.99, (top.confidence + calibratedConfidence) / 2));
    }

    const conflict = this.detectConflict(scored);

    const warnedActionIds = new Set<string>(
      policies
        .filter((decision) => decision.level === "warn" && decision.target_id != null)
        .map((decision) => decision.target_id!)
    );

    const errorRateThreshold = 0.5;
    const approvalThreshold = this.options?.approvalThreshold ?? 0.7;
    const autoApprove = this.options?.autoApprove ?? ctx.profile?.runtime_config?.auto_approve ?? false;
    const metaActions = mergeMetaActions(
      deepMetaAssessment?.recommended_control_action,
      fastMetaAssessment?.recommended_control_actions
    );
    const metaState = deepMetaAssessment?.meta_state ?? fastMetaAssessment?.meta_state;
    const metaResolvedAction =
      Boolean(deepMetaAssessment?.recommended_candidate_action_id) ||
      (metaActions.includes("request-more-evidence") && top.action.action_type === "ask_user") ||
      (metaActions.includes("switch-to-safe-response") &&
        (top.action.action_type === "respond" || top.action.action_type === "ask_user"));
    const forceAbort =
      deepMetaAssessment?.recommended_control_action === "abort" || metaActions.includes("abort");

    if (forceAbort) {
      return {
        decision_type: "abort",
        confidence: top.confidence,
        meta_state: metaState,
        meta_actions: metaActions,
        rejection_reasons: [
          deepMetaAssessment?.rationale ??
            "Metacognitive control aborted execution after deep evaluation."
        ],
        explanation: deepMetaAssessment?.rationale ?? "Execution aborted by meta controller."
      };
    }

    const requiresApproval = !autoApprove && (
      deepMetaAssessment?.recommended_control_action === "execute-with-approval" ||
      metaActions.includes("execute-with-approval") ||
      metaActions.includes("ask-human") ||
      top.action.side_effect_level === "high" ||
      warnedActionIds.has(top.action.action_id) ||
      top.risk > approvalThreshold ||
      (!metaResolvedAction && conflict.hasConflict) ||
      (predictionErrorRate != null && predictionErrorRate >= errorRateThreshold) ||
      metaState === "high-risk"
    );

    const riskSummary = this.buildRiskSummary(top, conflict, warnedActionIds, policies, predictionErrorRate);

    return {
      decision_type: requiresApproval ? "request_approval" : "execute_action",
      selected_action_id: top.action.action_id,
      confidence: top.confidence,
      meta_state: metaState,
      meta_actions: metaActions,
      risk_summary: riskSummary,
      requires_human_approval: requiresApproval,
      explanation: conflict.hasConflict
        ? `Selected "${top.action.action_type}" (score ${top.score.toFixed(2)}) over ${conflict.rivalCount} competing candidate(s) with close scores.`
        : `Selected the highest-scoring policy-compliant action (score ${top.score.toFixed(2)}).`
    };
  }

  private selectMetaPreferredAction(
    candidates: CandidateAction[],
    scored: ScoredCandidate[],
    fastMetaAssessment?: { recommended_control_actions?: MetaControlAction[] },
    deepMetaAssessment?: MetaAssessment
  ): ScoredCandidate | undefined {
    const metaActions = mergeMetaActions(
      deepMetaAssessment?.recommended_control_action,
      fastMetaAssessment?.recommended_control_actions
    );

    if (metaActions.includes("request-more-evidence") || metaActions.includes("ask-human")) {
      const askUser = candidates.find((action) => action.action_type === "ask_user");
      if (askUser) {
        return scored.find((candidate) => candidate.action.action_id === askUser.action_id);
      }
    }

    if (metaActions.includes("switch-to-safe-response")) {
      const safeAction = [...scored]
        .sort((left, right) => compareSafety(left.action, right.action))[0];
      return safeAction;
    }

    return undefined;
  }

  private scoreAndRank(
    candidates: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[]
  ): ScoredCandidate[] {
    const warnedIds = new Set(
      policies.filter((d) => d.level === "warn").map((d) => d.target_id)
    );

    const scored: ScoredCandidate[] = candidates.map((action) => {
      const prediction = predictions.find((p) => p.action_id === action.action_id);
      const uncertainty = prediction?.uncertainty ?? 0;
      const risk = uncertainty;
      const confidence = prediction ? Math.max(0.1, 1 - uncertainty) : 0.6;

      const salience = prediction?.success_probability ?? 0.5;
      const warnPenalty = warnedIds.has(action.action_id) ? 0.15 : 0;
      const sideEffectPenalty = action.side_effect_level === "high" ? 0.1 : 0;

      const score =
        salience * 0.4 +
        confidence * 0.35 +
        (1 - risk) * 0.25 -
        warnPenalty -
        sideEffectPenalty;

      return { action, salience, risk, confidence, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private detectConflict(scored: ScoredCandidate[]): { hasConflict: boolean; rivalCount: number } {
    if (scored.length < 2) {
      return { hasConflict: false, rivalCount: 0 };
    }

    const top = scored[0];
    const threshold = 0.05;
    const rivals = scored.filter((s, i) => i > 0 && Math.abs(top.score - s.score) < threshold);

    return { hasConflict: rivals.length > 0, rivalCount: rivals.length };
  }

  private buildRiskSummary(
    top: ScoredCandidate,
    conflict: { hasConflict: boolean; rivalCount: number },
    warnedActionIds: Set<string>,
    policies: PolicyDecision[],
    predictionErrorRate?: number
  ): string {
    const reasons: string[] = [];

    if (top.action.side_effect_level === "high") {
      reasons.push("action has high side-effect level");
    }
    if (warnedActionIds.has(top.action.action_id)) {
      const warnPolicies = policies.filter(
        (p) => p.level === "warn" && p.target_id === top.action.action_id
      );
      reasons.push(`warned by policy: ${warnPolicies.map((p) => p.reason ?? p.policy_name).join(", ")}`);
    }
    if (top.risk > 0.5) {
      reasons.push(`high prediction uncertainty (${top.risk.toFixed(2)})`);
    }
    if (conflict.hasConflict) {
      reasons.push(`${conflict.rivalCount} rival action(s) with competing scores`);
    }
    if (predictionErrorRate != null && predictionErrorRate >= 0.5) {
      reasons.push(`high prediction error rate (${(predictionErrorRate * 100).toFixed(0)}%)`);
    }

    if (reasons.length === 0) {
      return "Low risk. No policy warnings or high-uncertainty signals.";
    }
    return reasons.join("; ") + ".";
  }
}

function isMetaAssessment(value: unknown): value is MetaAssessment {
  return Boolean(
    value &&
      typeof value === "object" &&
      "assessment_id" in value &&
      "confidence" in value &&
      "recommended_control_action" in value
  );
}

function mergeMetaActions(
  deepRecommended?: MetaControlAction,
  fastRecommended?: MetaControlAction[]
): MetaControlAction[] {
  const merged = new Set<MetaControlAction>();
  if (deepRecommended) {
    merged.add(deepRecommended);
  }
  for (const action of fastRecommended ?? []) {
    merged.add(action);
  }
  if (merged.size === 0) {
    merged.add("execute-now");
  }
  return Array.from(merged);
}

function compareSafety(left: CandidateAction, right: CandidateAction) {
  return safetyScore(left) - safetyScore(right);
}

function safetyScore(action: CandidateAction) {
  const sideEffect =
    action.side_effect_level === "high"
      ? 3
      : action.side_effect_level === "medium"
        ? 2
        : action.side_effect_level === "low"
          ? 1
          : 0;
  const typePenalty =
    action.action_type === "call_tool"
      ? 2
      : action.action_type === "delegate"
        ? 1.5
        : action.action_type === "ask_user"
          ? 0
          : action.action_type === "respond"
            ? 0.25
            : 0.5;
  return sideEffect + typePenalty;
}
