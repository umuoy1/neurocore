process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-predictor-approval] Starting predictor approval demo");

const agent = defineAgent({
  id: "predictor-approval-demo-agent",
  role: "Agent that uses a predictor to escalate uncertain actions for approval."
})
  .useReasoner({
    name: "predictor-approval-demo-reasoner",
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
          confidence: 0.8,
          risk: 0.3,
          payload: {
            summary: "Try the low-side-effect rollout analysis action."
          },
          explanation: "The predictor will decide whether extra human review is needed."
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Analyze rollout risk",
          description: "Run rollout analysis for the latest production change.",
          tool_name: "analyze_rollout",
          tool_args: {
            service: "payments-api"
          },
          side_effect_level: "low"
        }
      ];
    }
  })
  .registerPredictor({
    name: "uncertainty-predictor",
    async predict(ctx, action) {
      return {
        prediction_id: ctx.services.generateId("prd"),
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        action_id: action.action_id,
        predictor_name: this.name,
        expected_outcome: "The rollout analysis may be incomplete without manual review.",
        uncertainty: 0.92,
        reasoning: "Recent change history is incomplete, so the tool result is uncertain.",
        created_at: ctx.services.now()
      };
    }
  })
  .registerTool({
    name: "analyze_rollout",
    description: "Returns deterministic rollout analysis.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" }
      },
      required: ["service"]
    },
    async invoke(input) {
      return {
        summary: `analysis for ${input.service}: risk unclear, more review needed`,
        payload: {
          service: input.service
        }
      };
    }
  });

const session = agent.createSession({
  agent_id: "predictor-approval-demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: "Analyze the latest rollout and tell me if it is safe to proceed.",
    created_at: new Date().toISOString()
  }
});

const result = await session.run();
const pendingApproval = session.getPendingApproval();

console.log(
  JSON.stringify(
    {
      sessionId: result.sessionId,
      finalState: result.finalState,
      outputText: result.outputText,
      pendingApproval: pendingApproval
        ? {
            approvalId: pendingApproval.approval_id,
            status: pendingApproval.status,
            reviewReason: pendingApproval.review_reason,
            actionType: pendingApproval.action.action_type,
            toolName: pendingApproval.action.tool_name
          }
        : null,
      predictions: session.getTraceRecords().flatMap((record) =>
        record.predictions.map((prediction) => ({
          predictor: prediction.predictor_name,
          actionId: prediction.action_id,
          uncertainty: prediction.uncertainty
        }))
      )
    },
    null,
    2
  )
);
