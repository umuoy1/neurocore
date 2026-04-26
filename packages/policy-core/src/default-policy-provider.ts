import type { CandidateAction, ModuleContext, PolicyDecision, PolicyProvider } from "@neurocore/protocol";

const DEFAULT_APPROVAL_TOOL_PATTERNS = [
  /^(bash|exec|shell|sh|terminal|zsh)$/i,
  /^(message|send_message)$/i,
  /^webhook(_|$)/i
] as const;

export class DefaultPolicyProvider implements PolicyProvider {
  public readonly name = "default-policy-provider";

  public async evaluateInput(): Promise<PolicyDecision[]> {
    return [];
  }

  public async evaluateAction(
    _ctx: ModuleContext,
    action: CandidateAction
  ): Promise<PolicyDecision[]> {
    if (action.action_type === "call_tool" && action.tool_name && requiresDefaultApproval(action.tool_name)) {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "warn",
          severity: 20,
          target_type: "action",
          target_id: action.action_id,
          reason: `Tool "${action.tool_name}" is classified as high-risk and requires human approval by default.`,
          recommendation: "Request approval before execution."
        }
      ];
    }

    if (action.action_type === "call_tool" && action.side_effect_level === "high") {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "warn",
          severity: 20,
          target_type: "action",
          target_id: action.action_id,
          reason: "High side-effect tool actions should require additional review.",
          recommendation: "Request approval before execution."
        }
      ];
    }

    return [];
  }

  public async evaluateOutput(): Promise<PolicyDecision[]> {
    return [];
  }
}

function requiresDefaultApproval(toolName: string): boolean {
  return DEFAULT_APPROVAL_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}
