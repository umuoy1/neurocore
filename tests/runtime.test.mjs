import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { FileRuntimeStateStore } from "@neurocore/runtime-core";
import { connectRemoteAgent, defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";
import { InMemoryWorldStateGraph } from "@neurocore/world-model";

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
      },
      async *streamText(_ctx, action) {
        const text = action.description ?? action.title;
        const midpoint = Math.max(1, Math.floor(text.length / 2));
        yield text.slice(0, midpoint);
        yield text.slice(midpoint);
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
  assert.ok(eventTypes.includes("checkpoint.created"));
  assert.ok(eventTypes.includes("session.completed"));
  const sequenceNumbers = session.getEvents().map((event) => event.sequence_no);
  assert.deepEqual(
    sequenceNumbers,
    [...sequenceNumbers].sort((left, right) => left - right)
  );

  assert.ok(session.getCheckpoints().length >= 2);
  assert.ok(session.getTraceRecords().length >= 2);

  session.cleanup();

  assert.equal(session.getSession(), undefined);
  assert.throws(() => session.getGoals(), /Unknown session/);
});

test("local session emits suspend/resume events and checkpoint schema version", async () => {
  const agent = defineAgent({
    id: "test-suspend-resume-agent",
    role: "Deterministic suspend resume test agent."
  }).useReasoner({
    name: "test-suspend-resume-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: {
            summary: "Ask user to continue."
          }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Ask for more",
          description: ctx.runtime_state.current_input_content,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const session = agent.createSession({
    agent_id: "test-suspend-resume-agent",
    tenant_id: "local",
    initial_input: {
      content: "first turn"
    }
  });

  const first = await session.run();
  assert.equal(first.finalState, "waiting");
  const checkpoint = session.suspend();
  assert.equal(checkpoint.schema_version, session.getSession()?.schema_version);

  const second = await session.resumeText("second turn");
  assert.equal(second.finalState, "waiting");

  const eventTypes = session.getEvents().map((event) => event.event_type);
  assert.ok(eventTypes.includes("session.suspended"));
  assert.ok(eventTypes.includes("session.resumed"));
  assert.ok(eventTypes.includes("checkpoint.created"));
});

test("runtime forwards content parts into reasoner context", async () => {
  const agent = defineAgent({
    id: "test-multimodal-runtime-agent",
    role: "Deterministic multimodal runtime test agent."
  })
    .useReasoner({
      name: "test-multimodal-runtime-reasoner",
      async plan(ctx) {
        return [
          {
            proposal_id: ctx.services.generateId("prp"),
            schema_version: ctx.profile.schema_version,
            session_id: ctx.session.session_id,
            cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
            module_name: this.name,
            proposal_type: "plan",
            salience_score: 0.8,
            confidence: 0.9,
            risk: 0,
            payload: {
              summary: "Drive a short multimodal exchange."
            }
          }
        ];
      },
      async respond(ctx) {
        const input = typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";
        if (input.includes("second turn")) {
          const contentParts = Array.isArray(ctx.runtime_state.current_input_parts)
            ? ctx.runtime_state.current_input_parts
            : [];
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Return multimodal state",
              description: JSON.stringify({
                contentPartCount: contentParts.length
              }),
              side_effect_level: "none"
            }
          ];
        }

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need another turn",
            description: "continue",
            side_effect_level: "none"
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });

  const session = agent.createSession({
    agent_id: "test-multimodal-runtime-agent",
    tenant_id: "local",
    initial_input: {
      input_id: "inp-mm-1",
      content: "first turn with a long description that should contribute to truncation",
      content_parts: [
        { type: "text", text: "first turn with a long description that should contribute to truncation" },
        { type: "image", mime_type: "image/png", file_name: "diagram.png" }
      ],
      created_at: new Date().toISOString()
    }
  });

  const first = await session.run();
  assert.equal(first.finalState, "waiting");
  const second = await session.resume({
    input_id: "inp-mm-3",
    content: "second turn with attached file",
    content_parts: [
      { type: "text", text: "second turn with attached file" },
      { type: "file", mime_type: "text/plain", file_name: "note.txt", text_excerpt: "hello" }
    ],
    created_at: new Date().toISOString()
  });
  assert.equal(second.finalState, "completed");

  const payload = JSON.parse(second.outputText);
  assert.equal(payload.contentPartCount, 2);
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
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
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
      streamedEvents.push(event);
    });

    const started = await streamSession.run();
    assert.equal(started.active_run, true);
    const settled = await streamSession.waitForSettled({ timeoutMs: 5000 });
    subscription.close();
    await subscription.done;

    assert.equal(settled.session.state, "completed");
    const eventTypes = streamedEvents.map((event) => event.event_type);
    assert.ok(eventTypes.includes("action.executed"));
    assert.ok(eventTypes.includes("session.completed"));
    const outputEvents = streamedEvents.filter((event) => event.event_type === "runtime.output");
    assert.ok(outputEvents.length >= 2);
    assert.equal(outputEvents.at(-1)?.payload.state, "completed");
    assert.equal(outputEvents.at(-1)?.payload.mode, "token_stream");
    assert.equal(outputEvents.at(-1)?.payload.text, "delayed echo: hosted runtime ready");
    const statusPhases = streamedEvents
      .filter((event) => event.event_type === "runtime.status")
      .map((event) => event.payload.phase);
    assert.ok(statusPhases.includes("memory_retrieval"));
    assert.ok(statusPhases.includes("reasoning"));
    assert.ok(statusPhases.includes("response_generation"));
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
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
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

test("tool observations preserve MIME-aware content parts", async () => {
  const agent = defineAgent({
    id: "test-tool-content-parts-agent",
    role: "Deterministic MIME-aware tool test agent."
  })
    .useReasoner({
      name: "test-tool-content-parts-reasoner",
      async plan(ctx) {
        return [
          {
            proposal_id: ctx.services.generateId("prp"),
            schema_version: ctx.profile.schema_version,
            session_id: ctx.session.session_id,
            cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
            module_name: this.name,
            proposal_type: "plan",
            salience_score: 0.8,
            confidence: 0.9,
            risk: 0,
            payload: {
              summary: "Call a file-producing tool, then respond."
            }
          }
        ];
      },
      async respond(ctx) {
        const input = typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";
        if (input.startsWith("Tool observation:")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Return content part state",
              description: input.replace(/^Tool observation:\s*/, "").trim(),
              side_effect_level: "none"
            }
          ];
        }
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Build file payload",
            tool_name: "build_file_payload",
            side_effect_level: "none"
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .registerTool({
      name: "build_file_payload",
      description: "Returns a MIME-aware file payload.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        additionalProperties: true
      },
      async invoke() {
        return {
          summary: "file payload ready",
          mime_type: "text/plain",
          content_parts: [
            { type: "file", mime_type: "text/plain", file_name: "report.txt", text_excerpt: "payload" }
          ],
          payload: {
            kind: "file"
          }
        };
      }
    });

  const session = agent.createSession({
    agent_id: "test-tool-content-parts-agent",
    tenant_id: "local",
    initial_input: {
      input_id: "inp-file-1",
      content: "build the file payload",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  const firstStep = result.steps[0];
  assert.equal(firstStep.observation?.mime_type, "text/plain");
  assert.equal(firstStep.observation?.content_parts?.[0]?.type, "file");
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
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
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

test("structured ask_user schema is preserved in runtime observation payload", async () => {
  const agent = defineAgent({
    id: "structured-ask-user-agent",
    role: "Structured ask_user test agent."
  }).useReasoner({
    name: "structured-ask-user-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.7,
        payload: { summary: "Ask user for structured input." }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "ask_user",
        title: "Collect date",
        description: "Which date works best?",
        ask_user_schema: {
          mode: "form",
          title: "Schedule follow-up",
          fields: [
            {
              name: "scheduled_date",
              label: "Scheduled date",
              type: "date",
              required: true
            }
          ]
        },
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const session = agent.createSession({
    tenant_id: "tenant-ask-user",
    initial_input: {
      content: "schedule something",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "waiting");
  const step = result.steps[0];
  assert.deepEqual(
    step?.observation?.structured_payload?.ask_user_schema,
    {
      mode: "form",
      title: "Schedule follow-up",
      fields: [
        {
          name: "scheduled_date",
          label: "Scheduled date",
          type: "date",
          required: true
        }
      ]
    }
  );
});

test("structured ask_user responses are validated before resume and exposed to runtime_state", async () => {
  let lastStructuredResponse = null;

  const agent = defineAgent({
    id: "structured-ask-user-validation-agent",
    role: "Structured ask_user validation test agent."
  }).useReasoner({
    name: "structured-ask-user-validation-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.7,
        payload: { summary: "Collect a structured yes/no answer." }
      }];
    },
    async respond(ctx) {
      if (ctx.runtime_state.current_input_structured_response) {
        lastStructuredResponse = ctx.runtime_state.current_input_structured_response;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Return answer",
          description: `answer=${String(ctx.runtime_state.current_input_structured_response)}`,
          side_effect_level: "none"
        }];
      }
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "ask_user",
        title: "Choose one",
        description: "Select yes or no.",
        ask_user_schema: {
          mode: "options",
          title: "Decision",
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" }
          ]
        },
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const session = agent.createSession({
    tenant_id: "tenant-ask-user-validation",
    initial_input: {
      content: "start",
      created_at: new Date().toISOString()
    }
  });

  const first = await session.run();
  assert.equal(first.finalState, "waiting");

  await assert.rejects(
    () =>
      session.resume({
        input_id: "inp_invalid",
        content: "maybe",
        created_at: new Date().toISOString()
      }),
    /must match one of: yes, no/
  );
  assert.equal(session.getState(), "waiting");

  const second = await session.resume({
    input_id: "inp_valid",
    content: "yes",
    created_at: new Date().toISOString()
  });
  assert.equal(second.finalState, "completed");
  assert.equal(second.outputText, "answer=yes");
  assert.equal(lastStructuredResponse, "yes");
});

test("multi-turn conversation history is available in runtime_state with token-aware truncation", async () => {
  let lastHistory = [];
  let lastHistoryTokens = 0;
  let lastHistoryTruncated = false;

  const agent = defineAgent({
    id: "conversation-history-agent",
    role: "Conversation history test agent."
  })
    .useReasoner({
      name: "conversation-history-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.7,
          payload: { summary: "Track conversation history." }
        }];
      },
      async respond(ctx) {
        lastHistory = Array.isArray(ctx.runtime_state.conversation_history)
          ? ctx.runtime_state.conversation_history
          : [];
        lastHistoryTokens = Number(ctx.runtime_state.conversation_history_tokens ?? 0);
        lastHistoryTruncated = Boolean(ctx.runtime_state.conversation_history_truncated);
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Continue",
          description: "continue",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });

  const firstTurn = `first ${"alpha ".repeat(95)}`;
  const secondTurn = `second ${"beta ".repeat(95)}`;
  const thirdTurn = `third ${"gamma ".repeat(90)}`;

  const session = agent.createSession({
    tenant_id: "tenant-history",
    initial_input: {
      content: firstTurn,
      created_at: new Date().toISOString()
    }
  });

  await session.run();
  await session.resumeText(secondTurn);
  await session.resumeText(thirdTurn);

  assert.ok(lastHistory.length >= 2);
  assert.equal(lastHistory.at(-1)?.role, "assistant");
  assert.ok(lastHistory.some((message) => message.role === "user"));
  assert.ok(lastHistoryTokens > 0);
  assert.equal(lastHistoryTruncated, true);
});

test("action preconditions are enforced before execution", async () => {
  const worldStateGraph = new InMemoryWorldStateGraph();
  worldStateGraph.addEntity({
    entity_id: "cup_01",
    entity_type: "object",
    properties: { reachable: false },
    confidence: 1,
    last_observed: new Date().toISOString()
  });

  const agent = defineAgent({
    id: "precondition-runtime-agent",
    role: "Precondition test agent."
  })
    .useRuntimeInfrastructure({
      worldStateGraph
    })
    .useReasoner({
      name: "precondition-runtime-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          payload: { summary: "Pick up the cup if reachable." }
        }];
      },
      async respond(ctx) {
        const currentInput =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";
        if (currentInput.startsWith("Tool observation: Preconditions not met")) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need retry",
            description: "Fix the environment and try again.",
            side_effect_level: "none"
          }];
        }
        if (currentInput.startsWith("Tool observation:")) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Done",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }];
        }
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Pick cup",
          tool_name: "pick-cup",
          tool_args: {},
          preconditions: ["entity:cup_01:reachable=true"],
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .registerTool({
      name: "pick-cup",
      description: "Picks the cup.",
      sideEffectLevel: "none",
      inputSchema: {},
      async invoke() {
        return {
          summary: "cup picked"
        };
      }
    });

  const session = agent.createSession({
    tenant_id: "tenant-precondition",
    initial_input: {
      content: "pick up the cup",
      created_at: new Date().toISOString()
    }
  });

  const first = await session.run();
  assert.equal(first.finalState, "waiting");
  const failedStep = first.steps.find((step) => step.observation?.status === "failure");
  assert.equal(failedStep?.observation?.status, "failure");
  assert.match(failedStep?.observation?.summary ?? "", /Preconditions not met/);

  worldStateGraph.updateEntity("cup_01", {
    properties: { reachable: true }
  });

  const second = await session.resumeText("try again");
  assert.equal(second.finalState, "completed");
  assert.equal(second.outputText, "cup picked");
});

test("conditional planning falls back when preconditions fail", async () => {
  const agent = defineAgent({
    id: "conditional-fallback-agent",
    role: "Conditional planning fallback test agent."
  }).useReasoner({
    name: "conditional-fallback-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.8,
        payload: { summary: "Use fallback when the primary action is not executable." }
      }];
    },
    async respond(ctx) {
      return [
        {
          action_id: "primary-action",
          action_type: "call_tool",
          title: "Primary action",
          tool_name: "missing-tool",
          preconditions: ["tool:missing-tool:registered=true"],
          next_action_id_on_failure: "fallback-action",
          plan_group_id: "plan-1",
          side_effect_level: "none"
        },
        {
          action_id: "fallback-action",
          action_type: "respond",
          title: "Fallback action",
          description: "fallback path used",
          plan_group_id: "plan-1",
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const session = agent.createSession({
    tenant_id: "tenant-conditional-fallback",
    initial_input: {
      content: "use the fallback plan",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.equal(result.outputText, "fallback path used");
  assert.equal(result.steps[0]?.selectedAction?.action_id, "fallback-action");
});

test("conditional planning chooses a ready root action from the plan graph", async () => {
  const agent = defineAgent({
    id: "conditional-dag-agent",
    role: "Conditional planning DAG test agent."
  }).useReasoner({
    name: "conditional-dag-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.8,
        payload: { summary: "Choose the executable root node first." }
      }];
    },
    async respond(ctx) {
      return [
        {
          action_id: "dependent-action",
          action_type: "respond",
          title: "Dependent action",
          description: "dependent branch should not run first",
          depends_on_action_ids: ["root-action"],
          plan_group_id: "plan-2",
          side_effect_level: "none"
        },
        {
          action_id: "root-action",
          action_type: "respond",
          title: "Root action",
          description: "root branch selected",
          plan_group_id: "plan-2",
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const session = agent.createSession({
    tenant_id: "tenant-conditional-dag",
    initial_input: {
      content: "run the DAG plan",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.equal(result.outputText, "root branch selected");
  assert.equal(result.steps[0]?.selectedAction?.action_id, "root-action");
  assert.equal(result.steps[0]?.cycle.workspace?.plan_graph?.groups?.[0]?.plan_group_id, "plan-2");
});

test("parallel tool actions execute in one cycle when runtime allows parallel tools", async () => {
  const callOrder = [];

  const agent = defineAgent({
    id: "parallel-tools-agent",
    role: "Parallel tools test agent."
  })
    .configureRuntime({
      allow_parallel_modules: true,
      allow_async_tools: true
    })
    .useReasoner({
      name: "parallel-tools-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          payload: { summary: "Run two reads in parallel, then answer." }
        }];
      },
      async respond(ctx) {
        const currentInput =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";
        if (currentInput.startsWith("Tool observation: Parallel tool observations:")) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Done",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }];
        }
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Read A",
            tool_name: "read-a",
            tool_args: {},
            side_effect_level: "none"
          },
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Read B",
            tool_name: "read-b",
            tool_args: {},
            side_effect_level: "none"
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .registerTool({
      name: "read-a",
      description: "Read A",
      sideEffectLevel: "none",
      inputSchema: {},
      async invoke() {
        callOrder.push("read-a");
        await delay(10);
        return { summary: "A=1" };
      }
    })
    .registerTool({
      name: "read-b",
      description: "Read B",
      sideEffectLevel: "none",
      inputSchema: {},
      async invoke() {
        callOrder.push("read-b");
        await delay(10);
        return { summary: "B=2" };
      }
    });

  const session = agent.createSession({
    tenant_id: "tenant-parallel",
    initial_input: {
      content: "run both reads",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.equal(callOrder.length, 2);
  const batchStep = result.steps.find((step) =>
    Array.isArray(step.observation?.structured_payload?.parallel_results)
  );
  assert.ok(batchStep);
  assert.equal(batchStep?.observation?.structured_payload?.parallel_results.length, 2);
  assert.match(result.outputText ?? "", /read-a: A=1/);
  assert.match(result.outputText ?? "", /read-b: B=2/);
});

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
