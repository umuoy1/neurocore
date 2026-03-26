process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-policy-block] Starting custom policy block demo");

const agent = defineAgent({
  id: "policy-block-demo-agent",
  role: "Agent that demonstrates custom runtime policy providers."
})
  .useReasoner({
    name: "policy-block-demo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.92,
          risk: 0.2,
          payload: {
            summary: "Attempt the blocked production cleanup action."
          },
          explanation: "Custom policy should block this tool completely."
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Delete production accounts",
          description: "Destructive action that should be blocked by policy.",
          tool_name: "delete_production_accounts",
          tool_args: {
            tenant: "prod"
          },
          side_effect_level: "high"
        }
      ];
    }
  })
  .registerPolicyProvider({
    name: "block-production-delete-policy",
    async evaluateAction(_ctx, action) {
      if (action.tool_name !== "delete_production_accounts") {
        return [];
      }

      return [
        {
          decision_id: `pol_${action.action_id}`,
          policy_name: this.name,
          level: "block",
          target_type: "action",
          target_id: action.action_id,
          reason: "Production account deletion is disabled in this environment.",
          recommendation: "Use a manual break-glass workflow instead."
        }
      ];
    }
  })
  .registerTool({
    name: "delete_production_accounts",
    description: "Dangerous production deletion tool.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string" }
      },
      required: ["tenant"]
    },
    async invoke() {
      return {
        summary: "this tool should never execute",
        payload: {}
      };
    }
  });

const session = agent.createSession({
  agent_id: "policy-block-demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: "Delete inactive production accounts now.",
    created_at: new Date().toISOString()
  }
});

const result = await session.run();
const firstTrace = session.getTraceRecords()[0];

console.log(
  JSON.stringify(
    {
      sessionId: result.sessionId,
      finalState: result.finalState,
      outputText: result.outputText,
      policyDecisions: firstTrace?.policy_decisions.map((decision) => ({
        policyName: decision.policy_name,
        level: decision.level,
        reason: decision.reason
      })) ?? [],
      selectedAction: firstTrace?.selected_action
        ? {
            actionType: firstTrace.selected_action.action_type,
            toolName: firstTrace.selected_action.tool_name
          }
        : null
    },
    null,
    2
  )
);
