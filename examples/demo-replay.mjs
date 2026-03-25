process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Use the echo tool with message 'Replay demo ready', then summarize the result.";

console.log("[demo-replay] Starting replay demo");
console.log("[demo-replay] Prompt:", prompt);

const replayReasoner = {
  name: "replay-demo-reasoner",
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
        confidence: 0.95,
        risk: 0,
        payload: {
          summary: "Replay demo: call the echo tool once, then respond with the observation."
        },
        explanation: "Deterministic local reasoner for replay validation."
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
          action_type: "respond",
          title: "Return final replay summary",
          description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
          expected_outcome: "Finish the replay demo with a deterministic answer.",
          side_effect_level: "none"
        }
      ];
    }

    return [
      {
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Call echo for replay demo",
        description: "Invoke echo to produce a stable observation for replay.",
        tool_name: "echo",
        tool_args: {
          message: "Replay demo ready"
        },
        expected_outcome: "Obtain a stable tool observation.",
        side_effect_level: "none"
      }
    ];
  }
};

const echoTool = {
  name: "echo",
  description: "Returns the provided message.",
  sideEffectLevel: "none",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" }
    },
    required: ["message"]
  },
  async invoke(input) {
    return {
      summary: `echo: ${typeof input.message === "string" ? input.message : "unknown"}`,
      payload: {
        message: input.message
      }
    };
  }
};

const agent = defineAgent({
  id: "replay-demo-agent",
  role: "Deterministic agent used to verify trace replay."
})
  .useReasoner(replayReasoner)
  .registerTool(echoTool);

const session = agent.createSession({
  agent_id: "replay-demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: prompt,
    created_at: new Date().toISOString()
  }
});

console.log("[demo-replay] Created session", { sessionId: session.id });

const result = await session.run();
const replay = session.replay();

console.log("[demo-replay] Session finished", {
  sessionId: result.sessionId,
  finalState: result.finalState,
  stepCount: result.steps.length,
  replayCycleCount: replay.cycle_count
});

console.log(
  JSON.stringify(
    {
      sessionId: result.sessionId,
      finalState: result.finalState,
      outputText: result.outputText,
      replay: {
        cycleCount: replay.cycle_count,
        finalOutput: replay.final_output,
        cycles: replay.traces.map((record, index) => ({
          index: index + 1,
          traceId: record.trace.trace_id,
          cycleId: record.trace.cycle_id,
          input: record.inputs[0]?.content,
          selectedAction: record.selected_action
            ? {
                actionType: record.selected_action.action_type,
                title: record.selected_action.title,
                toolName: record.selected_action.tool_name
              }
            : null,
          observation: record.observation
            ? {
                sourceType: record.observation.source_type,
                summary: record.observation.summary
              }
            : null,
          workspace: record.workspace
            ? {
                contextSummary: record.workspace.context_summary,
                memoryDigestCount: record.workspace.memory_digest.length
              }
            : null
        }))
      }
    },
    null,
    2
  )
);
