process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-cross-session-memory] Starting cross-session memory demo");

const agent = defineAgent({
  id: "cross-session-memory-demo-agent",
  role: "Agent that reuses successful episodic memory from prior sessions in the same tenant."
})
  .useReasoner({
    name: "cross-session-memory-demo-reasoner",
    async plan(ctx) {
      const recalledMemories = Array.isArray(ctx.runtime_state.memory_recall_proposals)
        ? ctx.runtime_state.memory_recall_proposals
        : [];

      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.93,
          risk: 0,
          payload: {
            recallCount: recalledMemories.length
          },
          explanation:
            recalledMemories.length > 0
              ? "Prior tenant episodes are available and can be reused."
              : "No prior tenant episodes were found."
        }
      ];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";
      const recalledMemories = Array.isArray(ctx.runtime_state.memory_recall_proposals)
        ? ctx.runtime_state.memory_recall_proposals
        : [];
      const crossSessionRecall = recalledMemories.find(
        (proposal) =>
          proposal &&
          proposal.payload &&
          proposal.payload.scope === "tenant" &&
          Array.isArray(proposal.payload.episodes) &&
          proposal.payload.episodes.length > 0
      );

      if (crossSessionRecall) {
        const reusedEpisode = crossSessionRecall.payload.episodes[0];
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "complete",
            title: "Reuse prior tenant episode",
            description: `Reused prior episode: ${reusedEpisode.outcome_summary}`,
            side_effect_level: "none"
          }
        ];
      }

      if (currentInput.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "complete",
            title: "Finish initial run",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Collect baseline deployment facts",
          description: "Gather deployment facts so the result can be remembered for future sessions.",
          tool_name: "fetch_release_snapshot",
          tool_args: {
            service: "payments-api"
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerTool({
    name: "fetch_release_snapshot",
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
        summary: `release snapshot for ${input.service}: version=2026.03.26-rc3 status=healthy`,
        payload: {
          service: input.service,
          version: "2026.03.26-rc3",
          status: "healthy"
        }
      };
    }
  });

const firstSession = agent.createSession({
  agent_id: "cross-session-memory-demo-agent",
  tenant_id: "shared-tenant",
  initial_input: {
    input_id: `inp_${Date.now()}_first`,
    content: "Summarize the latest release snapshot for payments-api.",
    created_at: new Date().toISOString()
  }
});

const firstResult = await firstSession.run();

const secondSession = agent.createSession({
  agent_id: "cross-session-memory-demo-agent",
  tenant_id: "shared-tenant",
  initial_input: {
    input_id: `inp_${Date.now()}_second`,
    content: "Use prior tenant knowledge to summarize the latest release snapshot for payments-api.",
    created_at: new Date().toISOString()
  }
});

const secondResult = await secondSession.run();
const secondTrace = secondSession.getTraceRecords()[0];

console.log(
  JSON.stringify(
    {
      first: {
        sessionId: firstResult.sessionId,
        finalState: firstResult.finalState,
        outputText: firstResult.outputText
      },
      second: {
        sessionId: secondResult.sessionId,
        finalState: secondResult.finalState,
        outputText: secondResult.outputText
      },
      crossSessionRecall: secondTrace?.proposals
        .filter(
          (proposal) =>
            proposal.proposal_type === "memory_recall" &&
            proposal.payload &&
            proposal.payload.scope === "tenant"
        )
        .map((proposal) => ({
          proposalId: proposal.proposal_id,
          explanation: proposal.explanation,
          episodeCount: Array.isArray(proposal.payload.episodes) ? proposal.payload.episodes.length : 0
        })) ?? []
    },
    null,
    2
  )
);
