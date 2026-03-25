import type { CandidateAction, ModuleContext, PolicyDecision, PolicyProvider } from "@neurocore/protocol";

export class DefaultPolicyProvider implements PolicyProvider {
  public readonly name = "default-policy-provider";

  public async evaluateAction(
    _ctx: ModuleContext,
    action: CandidateAction
  ): Promise<PolicyDecision[]> {
    if (action.action_type === "call_tool" && action.side_effect_level === "high") {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "warn",
          target_type: "action",
          target_id: action.action_id,
          reason: "High side-effect tool actions should require additional review.",
          recommendation: "Request approval before execution."
        }
      ];
    }

    return [];
  }
}

