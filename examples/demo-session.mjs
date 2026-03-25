process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";
import {
  loadOpenAICompatibleConfig,
  OpenAICompatibleReasoner
} from "@neurocore/sdk-node";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Use the echo tool with message 'NeuroCore demo is connected', then summarize the result briefly.";

console.log("[demo] Starting demo session");
console.log("[demo] Prompt:", prompt);

const config = await loadOpenAICompatibleConfig();
const reasoner = new OpenAICompatibleReasoner(config);
console.log("[demo] Loaded model config", {
  model: config.model,
  apiUrl: config.apiUrl,
  timeoutMs: config.timeoutMs ?? 60000
});

const echoTool = {
  name: "echo",
  description: "Returns the provided message. Useful for connectivity and tool-path demos.",
  sideEffectLevel: "none",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" }
    },
    required: ["message"]
  },
  async invoke(input) {
    const message =
      typeof input.message === "string" ? input.message : JSON.stringify(input, null, 2);
    return {
      summary: `echo: ${message}`,
      payload: {
        message
      }
    };
  }
};

const agent = defineAgent({
  id: "demo-agent",
  role:
    "General assistant that can reason and use tools. Available tool: echo(message) returns the provided message verbatim and is useful for connectivity and tool-path verification."
})
  .useReasoner(reasoner)
  .registerTool(echoTool);

const session = agent.createSession({
  agent_id: "demo-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: prompt,
    created_at: new Date().toISOString()
  }
});

console.log("[demo] Created session", { sessionId: session.id });

const result = await session.run();
const lastStep = result.steps.at(-1);

console.log("[demo] Session finished", {
  sessionId: result.sessionId,
  finalState: result.finalState,
  stepCount: result.steps.length
});

console.log(
  JSON.stringify(
    {
      sessionId: result.sessionId,
      finalState: result.finalState,
      stepCount: result.steps.length,
      selectedAction: lastStep?.selectedAction
        ? {
            actionType: lastStep.selectedAction.action_type,
            title: lastStep.selectedAction.title,
            toolName: lastStep.selectedAction.tool_name,
            toolArgs: lastStep.selectedAction.tool_args
          }
        : null,
      outputText: result.outputText,
      observation: lastStep?.observation
        ? {
            sourceType: lastStep.observation.source_type,
            status: lastStep.observation.status,
            summary: lastStep.observation.summary,
            payload: lastStep.observation.structured_payload
          }
        : null,
      decision: lastStep?.cycle.decision ?? null,
      traces: result.traces.map((trace) => ({
        traceId: trace.trace_id,
        cycleId: trace.cycle_id,
        selectedActionRef: trace.selected_action_ref,
        observationRefs: trace.observation_refs
      }))
    },
    null,
    2
  )
);
