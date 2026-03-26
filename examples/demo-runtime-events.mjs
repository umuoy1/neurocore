process.env.NEUROCORE_DEBUG ??= "1";

import { connectRemoteAgent, defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-events] Starting runtime events demo");

const agent = defineAgent({
  id: "runtime-events-demo-agent",
  role: "Deterministic agent used to verify runtime event APIs."
})
  .useReasoner({
    name: "runtime-events-demo-reasoner",
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
            summary: "Call echo, then reply with the observed output."
          },
          explanation: "Exercise runtime event listing and streaming."
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
            title: "Return final answer",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Invoke echo tool",
          tool_name: "echo",
          tool_args: {
            message: "runtime events ready"
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerTool({
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
  });

const server = createRuntimeServer({
  agents: [agent]
});

const { url } = await server.listen();
console.log("[demo-runtime-events] Server listening", { url });

try {
  const client = connectRemoteAgent({
    agentId: "runtime-events-demo-agent",
    baseUrl: url
  });

  const session = await client.createSession(
    {
      tenant_id: "local",
      initial_input: {
        content: "Use the echo tool with message 'runtime events ready', then summarize the result."
      }
    },
    {
      runImmediately: false
    }
  );

  const bootstrapEvents = await session.getEvents();
  const streamedEvents = [];
  let resolveCompleted;
  const completed = new Promise((resolve) => {
    resolveCompleted = resolve;
  });

  const stream = await session.subscribeToEvents((event) => {
    streamedEvents.push(event.event_type);
    if (event.event_type === "session.completed") {
      resolveCompleted?.();
    }
  });

  const runResult = await session.run();
  await Promise.race([completed, delay(2000)]);
  stream.close();
  await stream.done.catch(() => undefined);

  const allEvents = await session.getEvents();

  console.log(
    JSON.stringify(
      {
        sessionId: session.id,
        finalState: runResult.session.state,
        bootstrapEventTypes: bootstrapEvents.map((event) => event.event_type),
        streamedEventTypes: streamedEvents,
        totalEventCount: allEvents.length,
        lastEventTypes: allEvents.slice(-8).map((event) => event.event_type)
      },
      null,
      2
    )
  );
} finally {
  await server.close();
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
