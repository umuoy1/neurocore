import type { CandidateAction, ModuleContext, PolicyDecision, PolicyProvider } from "@neurocore/protocol";

export interface SandboxPolicyOptions {
  requiredSandboxTools?: string[];
  sandboxedTools?: string[];
  tenantPolicies?: Record<string, {
    requiredSandboxTools?: string[];
    sandboxedTools?: string[];
  }>;
}

export class SandboxPolicyProvider implements PolicyProvider {
  public readonly name = "sandbox-policy-provider";
  private readonly requiredSandboxTools: ReadonlySet<string>;
  private readonly sandboxedTools: ReadonlySet<string>;
  private readonly tenantPolicies: SandboxPolicyOptions["tenantPolicies"];

  public constructor(options: SandboxPolicyOptions = {}) {
    this.requiredSandboxTools = new Set(options.requiredSandboxTools ?? []);
    this.sandboxedTools = new Set(options.sandboxedTools ?? []);
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
    const requiredSandboxTools = new Set([
      ...this.requiredSandboxTools,
      ...(tenantPolicy?.requiredSandboxTools ?? [])
    ]);
    const sandboxedTools = new Set([
      ...this.sandboxedTools,
      ...(tenantPolicy?.sandboxedTools ?? [])
    ]);

    if (!requiredSandboxTools.has(action.tool_name) || sandboxedTools.has(action.tool_name)) {
      return [];
    }

    return [
      {
        decision_id: `pol_${action.action_id}`,
        policy_name: this.name,
        level: "block",
        severity: 30,
        target_type: "action",
        target_id: action.action_id,
        reason: `Tool "${action.tool_name}" must be routed through a sandbox provider.`,
        recommendation: "Use a sandbox_* tool or configure a sandbox wrapper for this operation."
      }
    ];
  }

  public async evaluateOutput(): Promise<PolicyDecision[]> {
    return [];
  }
}
