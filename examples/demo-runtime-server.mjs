process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-server] Starting runtime-server demo");

const agent = defineAgent({
  id: "runtime-server-demo-agent",
  role: "Deterministic agent exposed over the runtime HTTP API."
})
  .useReasoner({
    name: "runtime-server-demo-reasoner",
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
            summary: "Call echo once, then return the observation."
          },
          explanation: "HTTP runtime-server smoke test."
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
            title: "Return server result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call echo through runtime-server",
          tool_name: "echo",
          tool_args: {
            message: "runtime-server ready"
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
console.log("[demo-runtime-server] Server listening", { url });

try {
  const createResponse = await postJson(`${url}/v1/agents/runtime-server-demo-agent/sessions`, {
    tenant_id: "local",
    initial_input: {
      content: "Use the echo tool with message 'runtime-server ready', then summarize the result."
    }
  });

  const sessionId = createResponse.session.session_id;
  const tracesResponse = await getJson(`${url}/v1/sessions/${sessionId}/traces`);
  const firstCycleId = tracesResponse.traces[0]?.trace?.cycle_id;
  const workspaceResponse = firstCycleId
    ? await getJson(`${url}/v1/sessions/${sessionId}/workspace/${firstCycleId}`)
    : null;
  const episodesResponse = await getJson(`${url}/v1/sessions/${sessionId}/episodes`);
  const sessionResponse = await getJson(`${url}/v1/sessions/${sessionId}`);

  console.log(
    JSON.stringify(
      {
        create: {
          sessionId,
          finalState: createResponse.session.state,
          outputText: createResponse.last_run?.output_text ?? null,
          traceCount: createResponse.trace_count
        },
        session: {
          state: sessionResponse.session.state,
          traceCount: sessionResponse.trace_count,
          episodeCount: sessionResponse.episode_count
        },
        traces: tracesResponse.traces.map((trace) => ({
          cycleId: trace.trace.cycle_id,
          selectedAction: trace.selected_action
            ? {
                actionType: trace.selected_action.action_type,
                toolName: trace.selected_action.tool_name ?? null
              }
            : null,
          observation: trace.observation
            ? {
                status: trace.observation.status,
                summary: trace.observation.summary
              }
            : null
        })),
        workspace: workspaceResponse
          ? {
              cycleId: workspaceResponse.cycle_id,
              candidateActionCount: workspaceResponse.workspace.candidate_actions.length,
              memoryDigestCount: workspaceResponse.workspace.memory_digest.length
            }
          : null,
        episodes: episodesResponse.episodes.map((episode) => ({
          episodeId: episode.episode_id,
          outcome: episode.outcome,
          strategy: episode.selected_strategy
        }))
      },
      null,
      2
    )
  );
} finally {
  await server.close();
}

async function getJson(target) {
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`GET ${target} failed with status ${response.status}`);
  }
  return response.json();
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
