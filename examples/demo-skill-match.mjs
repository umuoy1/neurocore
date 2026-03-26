process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-skill-match] Starting skill match demo");

const agent = defineAgent({
  id: "skill-match-demo-agent",
  role: "Agent that consumes skill matches before selecting an action."
})
  .useReasoner({
    name: "skill-match-demo-reasoner",
    async plan(ctx) {
      const skillMatches = Array.isArray(ctx.runtime_state.skill_match_proposals)
        ? ctx.runtime_state.skill_match_proposals
        : [];

      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.88,
          confidence: 0.9,
          risk: 0,
          payload: {
            matchedSkillCount: skillMatches.length
          },
          explanation:
            skillMatches.length > 0
              ? "Use the matched deployment_summary skill to shape the final answer."
              : "No skill matched."
        }
      ];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";
      const skillMatches = Array.isArray(ctx.runtime_state.skill_match_proposals)
        ? ctx.runtime_state.skill_match_proposals
        : [];

      if (currentInput.startsWith("Tool observation:")) {
        const matchedSkill = skillMatches[0];
        const skillName =
          matchedSkill &&
          matchedSkill.payload &&
          typeof matchedSkill.payload.skill_name === "string"
            ? matchedSkill.payload.skill_name
            : "no-skill";

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "complete",
            title: "Finish deployment summary",
            description: `Skill ${skillName} produced summary: ${currentInput.replace(/^Tool observation:\s*/, "").trim()}`,
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Fetch deployment facts",
          description: "Collect deployment facts before applying the matched summary skill.",
          tool_name: "fetch_deployment_facts",
          tool_args: {
            service: "payments-api"
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerSkillProvider({
    name: "deployment-summary-skill-provider",
    async match(ctx) {
      const content =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content.toLowerCase()
          : "";

      if (!content.includes("deploy")) {
        return [];
      }

      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "skill_match",
          salience_score: 0.93,
          confidence: 0.94,
          risk: 0,
          payload: {
            skill_id: "deployment_summary",
            skill_name: "deployment_summary",
            summary: "Summarize deployment facts in operator-friendly release language."
          },
          explanation: "Matched deployment summarization workflow."
        }
      ];
    }
  })
  .registerTool({
    name: "fetch_deployment_facts",
    description: "Returns deterministic deployment facts.",
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
        summary: `service=${input.service} deploy=2026.03.26-rc2 author=anna status=healthy`,
        payload: {
          service: input.service,
          version: "2026.03.26-rc2",
          author: "anna",
          status: "healthy"
        }
      };
    }
  });

const session = agent.createSession({
  agent_id: "skill-match-demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: "Summarize the latest deploy for payments-api.",
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
      workspaceSkillDigest: firstTrace?.workspace?.skill_digest ?? [],
      skillProposals: firstTrace?.proposals
        .filter((proposal) => proposal.proposal_type === "skill_match")
        .map((proposal) => ({
          proposalId: proposal.proposal_id,
          moduleName: proposal.module_name,
          skillId: proposal.payload.skill_id,
          skillName: proposal.payload.skill_name,
          salience: proposal.salience_score
        })) ?? []
    },
    null,
    2
  )
);
