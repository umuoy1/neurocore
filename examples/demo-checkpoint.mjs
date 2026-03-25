process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Use the echo tool with message 'Checkpoint demo ready', then summarize the result.";

console.log("[demo-checkpoint] Starting checkpoint demo");
console.log("[demo-checkpoint] Prompt:", prompt);

const checkpointReasoner = {
  name: "checkpoint-demo-reasoner",
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
          summary: "Call echo once, checkpoint while waiting, then restore and complete."
        },
        explanation: "Deterministic workflow to validate checkpoint and resume."
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
          title: "Return final checkpoint summary",
          description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
          expected_outcome: "Complete after restoring from checkpoint.",
          side_effect_level: "none"
        }
      ];
    }

    return [
      {
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Call echo before checkpoint",
        description: "Generate a stable observation before checkpointing.",
        tool_name: "echo",
        tool_args: {
          message: "Checkpoint demo ready"
        },
        expected_outcome: "Produce a tool observation for resume.",
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

const builder = defineAgent({
  id: "checkpoint-demo-agent",
  role: "Deterministic agent used to verify checkpoint and restore."
})
  .useReasoner(checkpointReasoner)
  .registerTool(echoTool);

const session = builder.createSession({
  agent_id: "checkpoint-demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: prompt,
    created_at: new Date().toISOString()
  }
});

console.log("[demo-checkpoint] Created session", { sessionId: session.id });

const firstStep = await session.runOnce();
const checkpoint = session.suspend();
console.log("[demo-checkpoint] Suspended original session", {
  sessionId: firstStep.sessionId,
  cycleId: firstStep.cycleId,
  checkpointId: checkpoint.checkpoint_id,
  pendingInputId: checkpoint.pending_input?.input_id
});

const restoredSession = builder.createSessionFromCheckpoint(checkpoint);
const resumed = await restoredSession.resume();

console.log("[demo-checkpoint] Restored session finished", {
  sessionId: resumed.sessionId,
  finalState: resumed.finalState,
  stepCount: resumed.steps.length
});

console.log(
  JSON.stringify(
    {
      checkpointId: checkpoint.checkpoint_id,
      originalSessionId: session.id,
      restoredSessionId: restoredSession.id,
      checkpointState: checkpoint.session.state,
      pendingInput: checkpoint.pending_input?.content ?? null,
      resumedFinalState: resumed.finalState,
      resumedOutputText: resumed.outputText,
      replay: restoredSession.replay()
    },
    null,
    2
  )
);
