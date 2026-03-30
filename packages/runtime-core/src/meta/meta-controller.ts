import type {
  CandidateAction,
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
  public constructor(private readonly options?: { approvalThreshold?: number }) {}

  public async evaluate(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictions: Prediction[],
    policies: PolicyDecision[]
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
    const top = scored[0];
    const conflict = this.detectConflict(scored);

    const warnedActionIds = new Set<string>(
      policies
        .filter((decision) => decision.level === "warn" && decision.target_id != null)
        .map((decision) => decision.target_id!)
    );

    const approvalThreshold = this.options?.approvalThreshold ?? 0.7;
    const requiresApproval =
      top.action.side_effect_level === "high" ||
      warnedActionIds.has(top.action.action_id) ||
      top.risk > approvalThreshold ||
      conflict.hasConflict;

    const riskSummary = this.buildRiskSummary(top, conflict, warnedActionIds, policies);

    return {
      decision_type: requiresApproval ? "request_approval" : "execute_action",
      selected_action_id: top.action.action_id,
      confidence: top.confidence,
      risk_summary: riskSummary,
      requires_human_approval: requiresApproval,
      explanation: conflict.hasConflict
        ? `Selected "${top.action.action_type}" (score ${top.score.toFixed(2)}) over ${conflict.rivalCount} competing candidate(s) with close scores.`
        : `Selected the highest-scoring policy-compliant action (score ${top.score.toFixed(2)}).`
    };
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
    policies: PolicyDecision[]
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

    if (reasons.length === 0) {
      return "Low risk. No policy warnings or high-uncertainty signals.";
    }
    return reasons.join("; ") + ".";
  }
}
