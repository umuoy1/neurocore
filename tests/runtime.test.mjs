import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { FileRuntimeStateStore } from "@neurocore/runtime-core";
import { connectRemoteAgent, defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

test("local session exposes events, checkpoints, and cleanup", async () => {
  const agent = defineAgent({
    id: "test-local-runtime-agent",
    role: "Deterministic test agent for local runtime coverage."
  })
    .useReasoner({
      name: "test-local-runtime-reasoner",
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
            }
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
              title: "Return local result",
              description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
              side_effect_level: "none"
            }
          ];
        }

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Call echo",
            tool_name: "echo",
            tool_args: {
              message: "local runtime ready"
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

  const session = agent.createSession({
    agent_id: "test-local-runtime-agent",
    tenant_id: "local",
    initial_input: {
      content: "Use echo to say local runtime ready, then summarize it."
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.equal(result.outputText, "echo: local runtime ready");

  const eventTypes = session.getEvents().map((event) => event.event_type);
  assert.ok(eventTypes.includes("session.created"));
  assert.ok(eventTypes.includes("action.executed"));
  assert.ok(eventTypes.includes("session.completed"));

  assert.ok(session.getCheckpoints().length >= 2);
  assert.ok(session.getTraceRecords().length >= 2);

  session.cleanup();

  assert.equal(session.getSession(), undefined);
  assert.throws(() => session.getGoals(), /Unknown session/);
});

test("hosted runtime supports async and stream flows through remote client", async () => {
  const agent = defineAgent({
    id: "test-hosted-runtime-agent",
    role: "Deterministic test agent for hosted runtime coverage."
  })
    .useReasoner({
      name: "test-hosted-runtime-reasoner",
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
            }
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
              title: "Return hosted result",
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
              message: "hosted runtime ready",
              delayMs: 50
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
        await delay(typeof input.delayMs === "number" ? input.delayMs : 25);
        return {
          summary: `delayed echo: ${typeof input.message === "string" ? input.message : "unknown"}`,
          payload: {
            message: input.message
          }
        };
      }
    });

  const server = createRuntimeServer({ agents: [agent] });
  const { url } = await server.listen();

  try {
    const client = connectRemoteAgent({
      agentId: "test-hosted-runtime-agent",
      baseUrl: url
    });

    const asyncSession = await client.createSession(
      {
        tenant_id: "local",
        session_mode: "async",
        initial_input: {
          content: "Use delayed echo to say hosted runtime ready, then summarize it."
        }
      },
      {
        runImmediately: true
      }
    );

    assert.equal(asyncSession.hasActiveRun(), true);
    const asyncSettled = await asyncSession.waitForSettled({ timeoutMs: 5000 });
    assert.equal(asyncSettled.session.state, "completed");
    assert.equal(asyncSettled.last_run?.output_text, "delayed echo: hosted runtime ready");

    const streamSession = await client.createSession(
      {
        tenant_id: "local",
        session_mode: "stream",
        initial_input: {
          content: "Use delayed echo to say hosted runtime ready, then summarize it."
        }
      },
      {
        runImmediately: false
      }
    );

    const streamedEvents = [];
    const subscription = await streamSession.subscribeToEvents((event) => {
      streamedEvents.push(event.event_type);
    });

    const started = await streamSession.run();
    assert.equal(started.active_run, true);
    const settled = await streamSession.waitForSettled({ timeoutMs: 5000 });
    subscription.close();
    await subscription.done;

    assert.equal(settled.session.state, "completed");
    assert.ok(streamedEvents.includes("action.executed"));
    assert.ok(streamedEvents.includes("session.completed"));
  } finally {
    await server.close();
  }
});

test("hosted cleanup removes persisted terminal sessions across restart", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-test-runtime-"));
  const agent = defineAgent({
    id: "test-cleanup-runtime-agent",
    role: "Deterministic test agent for cleanup coverage."
  })
    .useReasoner({
      name: "test-cleanup-runtime-reasoner",
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
            }
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
            title: "Call cleanup echo",
            tool_name: "echo",
            tool_args: {
              message: "cleanup runtime ready"
            },
            side_effect_level: "none"
          }
        ];
      }
    })
    .useRuntimeStateStore(() => new FileRuntimeStateStore({ directory: stateDir }))
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

  let server = createRuntimeServer({ agents: [agent] });
  try {
    const first = await server.listen();
    const client = connectRemoteAgent({
      agentId: "test-cleanup-runtime-agent",
      baseUrl: first.url
    });

    const session = await client.createSession({
      tenant_id: "local",
      initial_input: {
        content: "Use echo to say cleanup runtime ready, then summarize it."
      }
    });
    await session.run();

    const sessionId = session.id;
    const connected = agent.connectSession(sessionId);
    assert.ok(connected.getCheckpoints().length >= 2);

    await session.cleanup();

    const deletedResponse = await fetch(`${first.url}/v1/sessions/${sessionId}`);
    assert.equal(deletedResponse.status, 404);

    await server.close();

    server = createRuntimeServer({ agents: [agent] });
    const second = await server.listen();
    const restartedResponse = await fetch(`${second.url}/v1/sessions/${sessionId}`);
    assert.equal(restartedResponse.status, 404);
  } finally {
    await server.close().catch(() => undefined);
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("resume with explicit input rebases the active root goal", async () => {
  const agent = defineAgent({
    id: "test-rebase-goal-agent",
    role: "Goal rebasing test agent."
  }).useReasoner({
    name: "test-rebase-goal-reasoner",
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
            summary: "Reply with the active root goal description."
          }
        }
      ];
    },
    async respond(ctx) {
      const activeGoal = ctx.goals[0];
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Echo active goal",
          description: activeGoal?.description ?? "missing goal",
          side_effect_level: "none"
        }
      ];
    }
  });

  const session = agent.createSession({
    agent_id: "test-rebase-goal-agent",
    tenant_id: "local",
    initial_input: {
      content: "first request"
    }
  });

  const first = await session.run();
  assert.equal(first.finalState, "waiting");
  assert.equal(first.outputText, "first request");

  const second = await session.resume({
    input_id: "inp_second",
    content: "second request",
    created_at: new Date().toISOString()
  });

  assert.equal(second.finalState, "waiting");
  assert.equal(second.outputText, "second request");
  assert.equal(session.getGoals()[0]?.description, "second request");
});

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
