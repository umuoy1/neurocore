process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-goal-decomposition] Starting goal decomposition demo");

const agent = defineAgent({
  id: "goal-decomposition-demo-agent",
  role: "Deterministic agent that decomposes a root task into executable subgoals."
})
  .useReasoner({
    name: "goal-decomposition-demo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.95,
          confidence: 0.97,
          risk: 0,
          payload: {
            goalTitles: ctx.goals.map((goal) => goal.title)
          },
          explanation: `Execute the current actionable goal: ${ctx.goals[0]?.title ?? "none"}.`
        }
      ];
    },
    async decomposeGoal(ctx, goal) {
      if (goal.parent_goal_id || !goal.title.toLowerCase().includes("release note")) {
        return [];
      }

      return [
        {
          goal_id: ctx.services.generateId("gol"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          parent_goal_id: goal.goal_id,
          title: "Collect release facts",
          description: "Call the release_facts tool to gather the deployment facts.",
          goal_type: "subtask",
          status: "active",
          priority: 90,
          owner: "agent"
        },
        {
          goal_id: ctx.services.generateId("gol"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          parent_goal_id: goal.goal_id,
          title: "Write final release note",
          description: "Summarize the collected facts for the operator.",
          goal_type: "subtask",
          status: "pending",
          priority: 80,
          owner: "agent"
        }
      ];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (currentInput.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "complete",
            title: "Finish release note",
            description: `Release note ready: ${currentInput.replace(/^Tool observation:\s*/, "").trim()}`,
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Collect release facts",
          description: "Gather the deployment facts before writing the final release note.",
          tool_name: "release_facts",
          tool_args: {
            service: "payments-api"
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerTool({
    name: "release_facts",
    description: "Returns deterministic release facts for the demo.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" }
      },
      required: ["service"]
    },
    async invoke(input) {
      return {
        summary: `service=${input.service} version=2026.03.26-rc1 status=healthy`,
        payload: {
          service: input.service,
          version: "2026.03.26-rc1",
          status: "healthy"
        }
      };
    }
  });

const session = agent.createSession({
  agent_id: "goal-decomposition-demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: "Prepare a release note for the latest payments-api deployment.",
    created_at: new Date().toISOString()
  }
});

const result = await session.run();

console.log(
  JSON.stringify(
    {
      sessionId: result.sessionId,
      finalState: result.finalState,
      outputText: result.outputText,
      goals: session.getGoals().map((goal) => ({
        goalId: goal.goal_id,
        parentGoalId: goal.parent_goal_id ?? null,
        title: goal.title,
        status: goal.status,
        decompositionStatus:
          goal.metadata && typeof goal.metadata.decomposition_status === "string"
            ? goal.metadata.decomposition_status
            : null
      }))
    },
    null,
    2
  )
);
