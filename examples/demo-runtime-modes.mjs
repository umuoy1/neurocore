process.env.NEUROCORE_DEBUG ??= "1";

import { connectRemoteAgent, defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-modes] Starting async/stream runtime mode demo");

const agent = defineAgent({
  id: "runtime-modes-demo-agent",
  role: "Deterministic agent used to verify async and stream hosted runtime modes."
})
  .useReasoner({
    name: "runtime-modes-demo-reasoner",
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
            summary: "Call a delayed echo tool, then return the observation."
          },
          explanation: "Hosted runtime mode verification."
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
            title: "Return delayed result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call delayed echo",
          tool_name: "delayed_echo",
          tool_args: {
            message: "runtime modes ready",
            delayMs: 150
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerTool({
    name: "delayed_echo",
    description: "Sleeps briefly, then returns the provided message.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        delayMs: { type: "number" }
      },
      required: ["message", "delayMs"]
    },
    async invoke(input) {
      await delay(typeof input.delayMs === "number" ? input.delayMs : 100);
      return {
        summary: `delayed echo: ${typeof input.message === "string" ? input.message : "unknown"}`,
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
console.log("[demo-runtime-modes] Server listening", { url });

try {
  const client = connectRemoteAgent({
    agentId: "runtime-modes-demo-agent",
    baseUrl: url
  });

  const asyncSession = await client.createSession(
    {
      tenant_id: "local",
      session_mode: "async",
      initial_input: {
        content: "Use delayed echo to say runtime modes ready, then summarize it."
      }
    },
    {
      runImmediately: true
    }
  );
  const asyncImmediate = asyncSession.getSession();
  const asyncActive = asyncSession.hasActiveRun();
  const asyncSettled = await asyncSession.waitForSettled({ timeoutMs: 5_000 });

  const streamSession = await client.createSession(
    {
      tenant_id: "local",
      session_mode: "stream",
      initial_input: {
        content: "Use delayed echo to say runtime modes ready, then summarize it."
      }
    },
    {
      runImmediately: false
    }
  );

  const streamedEventTypes = [];
  let resolveCompleted;
  const completed = new Promise((resolve) => {
    resolveCompleted = resolve;
  });

  const stream = await streamSession.subscribeToEvents((event) => {
    streamedEventTypes.push(event.event_type);
    if (event.event_type === "session.completed") {
      resolveCompleted?.();
    }
  });

  const streamStart = await streamSession.run();
  await Promise.race([completed, delay(5_000)]);
  const streamSettled = await streamSession.waitForSettled({ timeoutMs: 5_000 });
  stream.close();
  await stream.done.catch(() => undefined);

  console.log(
    JSON.stringify(
      {
        async: {
          initialState: asyncImmediate.state,
          activeRunAtCreate: asyncActive,
          settledState: asyncSettled.session.state,
          outputText: asyncSettled.last_run?.output_text ?? null
        },
        stream: {
          activeRunAfterStart: streamStart.active_run,
          settledState: streamSettled.session.state,
          outputText: streamSettled.last_run?.output_text ?? null,
          streamedEventTypes
        }
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
