process.env.NEUROCORE_DEBUG ??= "1";

import { createServer as createHttpServer } from "node:http";
import { defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-webhooks] Starting runtime webhook demo");

const deliveries = [];

const webhookServer = createHttpServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/webhook") {
    response.statusCode = 404;
    response.end();
    return;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  deliveries.push({
    headers: request.headers,
    body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
  });

  response.statusCode = 202;
  response.end("accepted");
});

const webhookAddress = await listen(webhookServer, "127.0.0.1", 0);
const webhookUrl = `http://${webhookAddress.host}:${webhookAddress.port}/webhook`;

const agent = defineAgent({
  id: "runtime-webhooks-demo-agent",
  role: "Deterministic agent used to verify hosted webhook delivery."
})
  .useReasoner({
    name: "runtime-webhooks-demo-reasoner",
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
            summary: "Call echo once, then return the observed output."
          },
          explanation: "Webhook delivery verification."
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
            title: "Return webhook result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call echo for webhook demo",
          tool_name: "echo",
          tool_args: {
            message: "runtime webhooks ready"
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

const runtimeServer = createRuntimeServer({
  agents: [agent],
  webhooks: [
    {
      url: webhookUrl,
      headers: {
        "x-neurocore-source": "runtime-server"
      },
      event_types: ["session.created", "action.executed", "session.completed"]
    }
  ]
});

const runtimeAddress = await runtimeServer.listen();
console.log("[demo-runtime-webhooks] Runtime server listening", { url: runtimeAddress.url });

try {
  const response = await postJson(`${runtimeAddress.url}/v1/agents/runtime-webhooks-demo-agent/sessions`, {
    tenant_id: "local",
    initial_input: {
      content: "Use the echo tool with message 'runtime webhooks ready', then summarize the result."
    }
  });

  await waitFor(
    () => deliveries.some((entry) => entry.body?.event_type === "session.completed"),
    5000
  );

  console.log(
    JSON.stringify(
      {
        sessionId: response.session.session_id,
        finalState: response.session.state,
        deliveredEventTypes: deliveries.map((entry) => entry.body.event_type),
        sourceHeader: deliveries[0]?.headers["x-neurocore-source"] ?? null,
        deliveryCount: deliveries.length
      },
      null,
      2
    )
  );
} finally {
  await runtimeServer.close();
  await closeServer(webhookServer);
}

async function postJson(target, body) {
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`POST ${target} failed with status ${response.status}`);
  }

  return response.json();
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP address."));
        return;
      }
      resolve({
        host,
        port: address.port
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for webhook deliveries.");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}
