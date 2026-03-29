import type {
  CandidateAction,
  MetaController as IMetaController,
  MetaDecision,
  ModuleContext,
  PolicyDecision,
  Prediction
} from "@neurocore/protocol";

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

    const blockedActionIds = new Set(
      policies.filter((decision) => decision.level === "block").map((decision) => decision.target_id)
    );
    const candidates = actions.filter((action) => !blockedActionIds.has(action.action_id));
    candidates.sort((a, b) => {
      const riskA = predictions.find((p) => p.action_id === a.action_id)?.uncertainty ?? 0;
      const riskB = predictions.find((p) => p.action_id === b.action_id)?.uncertainty ?? 0;
      return riskA - riskB;
    });
    const selected = candidates[0];

    if (!selected) {
      return {
        decision_type: "abort",
        rejection_reasons: ["All candidate actions are blocked by policy."],
        explanation: "No executable action remained after policy evaluation."
      };
    }

    const warnedActionIds = new Set(
      policies.filter((decision) => decision.level === "warn").map((decision) => decision.target_id)
    );

    const approvalThreshold = this.options?.approvalThreshold ?? 0.7;
    const requiresApproval =
      selected.side_effect_level === "high" ||
      warnedActionIds.has(selected.action_id) ||
      predictions.some((prediction) => prediction.action_id === selected.action_id && (prediction.uncertainty ?? 0) > approvalThreshold);

    const prediction = predictions.find((p) => p.action_id === selected.action_id);
    const confidence = prediction
      ? Math.max(0.1, 1 - (prediction.uncertainty ?? 0))
      : 0.6;

    return {
      decision_type: requiresApproval ? "request_approval" : "execute_action",
      selected_action_id: selected.action_id,
      confidence,
      requires_human_approval: requiresApproval,
      explanation: "Selected the lowest-risk policy-compliant action."
    };
  }
}

