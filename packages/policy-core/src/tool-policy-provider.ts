import type { CandidateAction, ModuleContext, PolicyDecision, PolicyProvider, SideEffectLevel } from "@neurocore/protocol";

const DEFAULT_REQUIRED_APPROVAL_TOOLS = [
  "bash",
  "exec",
  "message",
  "send_message",
  "shell",
  "sh",
  "terminal",
  "webhook",
  "webhook_post",
  "zsh"
] as const;

export interface ToolPolicyOptions {
  blockedTools?: string[];
  requiredApprovalTools?: string[];
  requiredApprovalRiskLevels?: SideEffectLevel[];
  tenantPolicies?: Record<string, {
    blockedTools?: string[];
    requiredApprovalTools?: string[];
    requiredApprovalRiskLevels?: SideEffectLevel[];
  }>;
}

export class ToolPolicyProvider implements PolicyProvider {
  public readonly name = "tool-policy-provider";
  private readonly blockedTools: ReadonlySet<string>;
  private readonly requiredApprovalTools: ReadonlySet<string>;
  private readonly requiredApprovalRiskLevels: ReadonlySet<SideEffectLevel>;
  private readonly tenantPolicies: ToolPolicyOptions["tenantPolicies"];

  public constructor(options: ToolPolicyOptions) {
    this.blockedTools = new Set(options.blockedTools ?? []);
    this.requiredApprovalTools = new Set([
      ...DEFAULT_REQUIRED_APPROVAL_TOOLS,
      ...(options.requiredApprovalTools ?? [])
    ]);
    this.requiredApprovalRiskLevels = new Set(options.requiredApprovalRiskLevels ?? []);
    this.tenantPolicies = options.tenantPolicies;
  }

  public async evaluateInput(): Promise<PolicyDecision[]> {
    return [];
  }

  public async evaluateAction(
    ctx: ModuleContext,
    action: CandidateAction
  ): Promise<PolicyDecision[]> {
    if (action.action_type !== "call_tool" || !action.tool_name) {
      return [];
    }

    const tenantPolicy = this.tenantPolicies?.[ctx.tenant_id];
    const blockedTools = new Set([
      ...this.blockedTools,
      ...(tenantPolicy?.blockedTools ?? [])
    ]);
    const requiredApprovalTools = new Set([
      ...this.requiredApprovalTools,
      ...(tenantPolicy?.requiredApprovalTools ?? [])
    ]);
    const requiredApprovalRiskLevels = new Set<SideEffectLevel>([
      ...this.requiredApprovalRiskLevels,
      ...(tenantPolicy?.requiredApprovalRiskLevels ?? [])
    ]);

    if (blockedTools.has(action.tool_name)) {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "block",
          severity: 30,
          target_type: "action",
          target_id: action.action_id,
          reason: `Tool "${action.tool_name}" is blocked by policy.`
        }
      ];
    }

    if (requiredApprovalTools.has(action.tool_name)) {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "warn",
          severity: 20,
          target_type: "action",
          target_id: action.action_id,
          reason: `Tool "${action.tool_name}" requires human approval before execution.`,
          recommendation: "Request approval before execution."
        }
      ];
    }

    if (action.side_effect_level && requiredApprovalRiskLevels.has(action.side_effect_level)) {
      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "warn",
          severity: 20,
          target_type: "action",
          target_id: action.action_id,
          reason: `Risk level "${action.side_effect_level}" requires human approval before execution.`,
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
