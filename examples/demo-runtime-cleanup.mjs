process.env.NEUROCORE_DEBUG ??= "1";

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineAgent } from "@neurocore/sdk-core";
import { SqliteRuntimeStateStore } from "@neurocore/runtime-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-cleanup] Starting terminal session cleanup demo");

const stateDir = mkdtempSync(join(tmpdir(), "neurocore-runtime-cleanup-"));
const dbPath = join(stateDir, "runtime-state.sqlite");

const agent = defineAgent({
  id: "runtime-cleanup-demo-agent",
  role: "Deterministic agent used to verify terminal session cleanup."
})
  .useReasoner({
    name: "runtime-cleanup-demo-reasoner",
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
            summary: "Call echo and return the result."
          },
          explanation: "Terminal session cleanup verification."
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
            title: "Return cleanup result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call echo for cleanup demo",
          tool_name: "echo",
          tool_args: {
            message: "runtime cleanup ready"
          },
          side_effect_level: "none"
        }
      ];
    }
  })
  .useRuntimeStateStore(() => new SqliteRuntimeStateStore({ filename: dbPath }))
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

let server = createRuntimeServer({
  agents: [agent]
});

try {
  const firstServer = await server.listen();
  const created = await postJson(`${firstServer.url}/v1/agents/runtime-cleanup-demo-agent/sessions`, {
    tenant_id: "local",
    initial_input: {
      content: "Use echo to say runtime cleanup ready, then summarize it."
    }
  });

  const sessionId = created.session.session_id;
  const localHandle = agent.connectSession(sessionId);
  const checkpointCountBefore = localHandle.getCheckpoints().length;

  const deleted = await deleteJson(`${firstServer.url}/v1/sessions/${sessionId}`);
  const afterDelete = await getJson(`${firstServer.url}/v1/sessions/${sessionId}`, true);

  await server.close();

  server = createRuntimeServer({
    agents: [agent]
  });
  const secondServer = await server.listen();
  const afterRestart = await getJson(`${secondServer.url}/v1/sessions/${sessionId}`, true);

  console.log(
    JSON.stringify(
      {
        dbPath,
        sessionId,
        checkpointCountBefore,
        deleted,
        afterDelete,
        afterRestart
      },
      null,
      2
    )
  );
} finally {
  await server.close().catch(() => undefined);
  rmSync(stateDir, { recursive: true, force: true });
}

async function getJson(target, allowNotFound = false) {
  const response = await fetch(target);
  if (allowNotFound && response.status === 404) {
    return {
      status: response.status,
      body: await response.json()
    };
  }
  if (!response.ok) {
    throw new Error(`GET ${target} failed with status ${response.status}`);
  }
  return {
    status: response.status,
    body: await response.json()
  };
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

async function deleteJson(target) {
  const response = await fetch(target, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(`DELETE ${target} failed with status ${response.status}`);
  }

  return {
    status: response.status,
    body: await response.json()
  };
}
