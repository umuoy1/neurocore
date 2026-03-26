process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-semantic-memory] Starting semantic memory demo");

const agent = defineAgent({
  id: "semantic-memory-demo-agent",
  role: "Agent that reuses consolidated semantic memory from repeated successful sessions."
})
  .useReasoner({
    name: "semantic-memory-demo-reasoner",
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
          confidence: 0.94,
          risk: 0,
          payload: {
            recallCount: recalledMemories.length
          },
          explanation: "Use semantic memory when repeated successful sessions have already consolidated a pattern."
        }
      ];
    },
    async respond(ctx) {
      const semanticRecall = Array.isArray(ctx.runtime_state.memory_recall_proposals)
        ? ctx.runtime_state.memory_recall_proposals.find(
            (proposal) =>
              proposal &&
              proposal.payload &&
              proposal.payload.memory_type === "semantic" &&
              Array.isArray(proposal.payload.records) &&
              proposal.payload.records.length > 0
          )
        : undefined;

      if (semanticRecall) {
        const record = semanticRecall.payload.records[0];
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "complete",
            title: "Reuse semantic memory",
            description: `Semantic memory reused (${record.occurrence_count} repeats): ${record.summary}`,
            side_effect_level: "none"
          }
        ];
      }

      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (currentInput.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "complete",
            title: "Finish baseline semantic run",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Collect semantic baseline",
          description: "Run the same successful workflow so semantic memory can consolidate it.",
          tool_name: "fetch_release_pattern",
          tool_args: {
            service: "payments-api"
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerTool({
    name: "fetch_release_pattern",
    description: "Returns deterministic release pattern output.",
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
        summary: `release pattern for ${input.service}: deploy checks pass, rollout healthy`,
        payload: {
          service: input.service,
          status: "healthy"
        }
      };
    }
  });

for (const suffix of ["first", "second"]) {
  const session = agent.createSession({
    agent_id: "semantic-memory-demo-agent",
    tenant_id: "semantic-tenant",
    initial_input: {
      input_id: `inp_${Date.now()}_${suffix}`,
      content: "Summarize the healthy release rollout pattern for payments-api.",
      created_at: new Date().toISOString()
    }
  });
  await session.run();
}

const thirdSession = agent.createSession({
  agent_id: "semantic-memory-demo-agent",
  tenant_id: "semantic-tenant",
  initial_input: {
    input_id: `inp_${Date.now()}_third`,
    content: "Use prior rollout knowledge to summarize the healthy release rollout pattern for payments-api.",
    created_at: new Date().toISOString()
  }
});

const thirdResult = await thirdSession.run();
const firstTrace = thirdSession.getTraceRecords()[0];

console.log(
  JSON.stringify(
    {
      sessionId: thirdResult.sessionId,
      finalState: thirdResult.finalState,
      outputText: thirdResult.outputText,
      semanticRecall: firstTrace?.proposals
        .filter(
          (proposal) =>
            proposal.proposal_type === "memory_recall" &&
            proposal.payload &&
            proposal.payload.memory_type === "semantic"
        )
        .map((proposal) => ({
          proposalId: proposal.proposal_id,
          explanation: proposal.explanation,
          recordCount: Array.isArray(proposal.payload.records) ? proposal.payload.records.length : 0
        })) ?? []
    },
    null,
    2
  )
);
