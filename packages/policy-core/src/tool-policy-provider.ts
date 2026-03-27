import type { CandidateAction, ModuleContext, PolicyDecision, PolicyProvider } from "@neurocore/protocol";

export interface ToolPolicyOptions {
  blockedTools?: string[];
  requiredApprovalTools?: string[];
}

export class ToolPolicyProvider implements PolicyProvider {
  public readonly name = "tool-policy-provider";
  private readonly blockedTools: ReadonlySet<string>;
  private readonly requiredApprovalTools: ReadonlySet<string>;

  public constructor(options: ToolPolicyOptions) {
    this.blockedTools = new Set(options.blockedTools ?? []);
    this.requiredApprovalTools = new Set(options.requiredApprovalTools ?? []);
  }

  public async evaluateAction(
    _ctx: ModuleContext,
    action: CandidateAction
  ): Promise<PolicyDecision[]> {
    if (action.action_type !== "call_tool" || !action.tool_name) {
      return [];
    }

    if (this.blockedTools.has(action.tool_name)) {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "block",
          target_type: "action",
          target_id: action.action_id,
          reason: `Tool "${action.tool_name}" is blocked by policy.`
        }
      ];
    }

    if (this.requiredApprovalTools.has(action.tool_name)) {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "warn",
          target_type: "action",
          target_id: action.action_id,
          reason: `Tool "${action.tool_name}" requires human approval before execution.`,
          recommendation: "Request approval before execution."
        }
      ];
    }

    return [];
  }
}
