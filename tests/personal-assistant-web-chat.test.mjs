import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { startPersonalAssistantApp } from "../examples/personal-assistant/dist/main.js";

test("personal assistant web chat serves a local page and health endpoint", { concurrency: false }, async (t) => {
  const fixture = await createFixtureOrSkip(t, {
    reasoner: createRespondReasoner((input) => `echo:${input}`)
  });

  if (!fixture) {
    return;
  }

  try {
    const pageResponse = await fetch(`http://127.0.0.1:${fixture.port}/`);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.match(page, /Personal Assistant/);
    assert.match(page, /Local Web Chat/);

    const healthResponse = await fetch(`http://127.0.0.1:${fixture.port}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      platform: "web",
      path: "/chat"
    });
  } finally {
    await fixture.close();
  }
});

test("personal assistant web chat reconnects the same chat to the same waiting session", { concurrency: false }, async (t) => {
  const fixture = await createFixtureOrSkip(t, {
    reasoner: createAskUserReasoner()
  });

  if (!fixture) {
    return;
  }

  try {
    const firstClient = await connectWebSocket(fixture.port, "chat-reconnect", "user-reconnect");
    firstClient.socket.send("hello");
    const firstReply = await firstClient.nextMessage();
    assert.equal(firstReply.type, "message");
    assert.equal(firstReply.content.type, "text");
    assert.match(firstReply.content.text, /What should I do next\?/);

    firstClient.socket.send("/status");
    const firstStatus = await firstClient.nextMessage();
    const firstSessionId = extractSessionId(firstStatus.content.text);
    assert.match(firstStatus.content.text, /state: waiting/);
    firstClient.socket.close();
    await firstClient.closed;

    const secondClient = await connectWebSocket(fixture.port, "chat-reconnect", "user-reconnect");
    secondClient.socket.send("/status");
    const secondStatus = await secondClient.nextMessage();
    const secondSessionId = extractSessionId(secondStatus.content.text);
    assert.equal(secondSessionId, firstSessionId);
    assert.match(secondStatus.content.text, /state: waiting/);

    secondClient.socket.send("follow up");
    const secondReply = await secondClient.nextMessage();
    assert.match(secondReply.content.text, /What should I do next\?/);
    secondClient.socket.close();
    await secondClient.closed;
  } finally {
    await fixture.close();
  }
});

test("personal assistant web chat carries recent chat context across completed runtime sessions", { concurrency: false }, async (t) => {
  const fixture = await createFixtureOrSkip(t, {
    reasoner: createHandoffReasoner()
  });

  if (!fixture) {
    return;
  }

  try {
    const client = await connectWebSocket(fixture.port, "chat-handoff", "user-handoff");

    client.socket.send("ChatGPT released the latest 5.5 model today. Find the latest information.");
    const firstReply = await client.nextMessage();
    assert.equal(firstReply.type, "message");
    assert.match(firstReply.content.text, /ChatGPT 5\.5/);

    client.socket.send("This model was released less than one hour ago.");
    const secondReply = await client.nextMessage();
    assert.equal(secondReply.type, "message");
    assert.match(secondReply.content.text, /You mean ChatGPT 5\.5/);

    client.socket.close();
    await client.closed;
  } finally {
    await fixture.close();
  }
});

test("personal assistant web chat streams runtime status and incremental reply updates", { concurrency: false }, async (t) => {
  const fixture = await createFixtureOrSkip(t, {
    reasoner: createRespondReasoner(() => "This is a deliberately long assistant reply used to verify incremental frontend updates over the web chat stream.")
  });

  if (!fixture) {
    return;
  }

  try {
    const client = await connectWebSocket(fixture.port, "chat-stream", "user-stream");

    client.socket.send("show me progress");
    const status = await client.nextMessage({ includeStatus: true, onlyStatus: true });
    assert.equal(status.type, "message");
    assert.equal(status.content.type, "status");
    assert.match(status.content.phase, /memory_retrieval|reasoning|response_generation|session/);

    const firstReply = await client.nextMessage();
    assert.equal(firstReply.type, "message");
    assert.equal(firstReply.content.type, "text");
    assert.match(firstReply.content.text, /deliberately long assistant reply/i);

    const editedReply = await client.nextMessage({ includeStatus: true, onlyEdits: true });
    assert.equal(editedReply.type, "edit");
    assert.equal(editedReply.message_id, firstReply.message_id);
    assert.ok(editedReply.content.text.length > firstReply.content.text.length);

    client.socket.close();
    await client.closed;
  } finally {
    await fixture.close();
  }
});

test("personal assistant web chat reports tool execution progress before final reply", { concurrency: false }, async (t) => {
  const emailSendCalls = [];
  const fixture = await createFixtureOrSkip(t, {
    reasoner: createApprovalReasoner(),
    agent: {
      auto_approve: true,
      approvers: ["approved-user"],
      required_approval_tools: ["email_send"]
    },
    connectors: {
      email: {
        sender: {
          async send(args) {
            emailSendCalls.push(args);
            return {
              message_id: `email-${emailSendCalls.length}`,
              sent_at: new Date().toISOString()
            };
          }
        }
      }
    }
  });

  if (!fixture) {
    return;
  }

  try {
    const client = await connectWebSocket(fixture.port, "chat-approval", "approved-user");

    client.socket.send("please send the email");
    const toolStatus = await client.nextMessage({ includeStatus: true, onlyStatus: true, phase: "tool_execution" });
    assert.equal(toolStatus.type, "message");
    assert.equal(toolStatus.content.type, "status");
    assert.equal(toolStatus.content.phase, "tool_execution");
    assert.match(toolStatus.content.text, /Calling tool email_send|Tool email_send finished/);

    const finalMessage = await client.nextMessage();
    assert.equal(finalMessage.type, "message");
    assert.equal(finalMessage.content.type, "text");
    assert.match(finalMessage.content.text, /Email sent with id email-1/i);
    assert.equal(emailSendCalls.length, 1);

    client.socket.close();
    await client.closed;
  } finally {
    await fixture.close();
  }
});

async function createWebChatFixture(config) {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-web-chat-"));
  const port = await getAvailablePort();
  const dbPath = join(tempDir, "assistant.sqlite");
  const app = await startPersonalAssistantApp({
    db_path: dbPath,
    tenant_id: "test-tenant",
    reasoner: config.reasoner,
    agent: config.agent,
    connectors: config.connectors,
    web_chat: {
      enabled: true,
      host: "127.0.0.1",
      port,
      path: "/chat"
    },
    feishu: {
      enabled: false
    }
  });

  return {
    app,
    port,
    async close() {
      await app.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function createFixtureOrSkip(t, options) {
  try {
    return await createWebChatFixture(options);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      t.skip("Local port binding is not permitted in this environment.");
      return null;
    }
    throw error;
  }
}

async function connectWebSocket(port, chatId, userId) {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/chat?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`
  );

  const queue = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const payload = JSON.parse(raw.toString());
    queue.push(payload);
    while (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve();
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise((resolve) => {
    socket.once("close", resolve);
  });

  await opened;
  await new Promise((resolve) => setTimeout(resolve, 10));

  return {
    socket,
    closed,
    async nextMessage(options = {}) {
      const predicate = createPayloadPredicate(options);

      while (true) {
        const index = queue.findIndex(predicate);
        if (index >= 0) {
          return queue.splice(index, 1)[0];
        }

        await new Promise((resolve, reject) => {
          let wrapped;
          const timeout = setTimeout(() => {
            const waiterIndex = waiters.indexOf(wrapped);
            if (waiterIndex >= 0) {
              waiters.splice(waiterIndex, 1);
            }
            reject(new Error("Timed out waiting for WebSocket message."));
          }, 5000);

          wrapped = () => {
            clearTimeout(timeout);
            resolve();
          };

          waiters.push(wrapped);
        });
      }
    }
  };
}

function createPayloadPredicate(options) {
  return (payload) => {
    if (payload.type === "typing" && !options.includeTyping) {
      return false;
    }

    const contentType = payload?.content?.type;
    if (contentType === "status" && !options.includeStatus) {
      return false;
    }

    if (options.onlyStatus) {
      if (contentType !== "status") {
        return false;
      }
      if (options.phase && payload?.content?.phase !== options.phase) {
        return false;
      }
      return true;
    }

    if (options.onlyEdits) {
      return payload.type === "edit";
    }

    if (!options.includeEdits && payload.type === "edit") {
      return false;
    }

    if (options.phase && payload?.content?.phase !== options.phase) {
      return false;
    }

    return true;
  };
}

function extractSessionId(text) {
  const match = /session_id:\s+([^\n]+)/.exec(text);
  assert.ok(match, `Expected session_id in message: ${text}`);
  return match[1];
}

function createRespondReasoner(responder) {
  return {
    name: "respond-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "respond-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Respond directly." }
        }
      ];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: responder(input),
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
  };
}

function createAskUserReasoner() {
  return {
    name: "ask-user-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "ask-user-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Ask for more input." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Ask a follow-up",
          description: "What should I do next?",
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function createHandoffReasoner() {
  return {
    name: "handoff-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "handoff-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Respond with continuity." }
        }
      ];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      const metadata = ctx.runtime_state.current_input_metadata &&
        typeof ctx.runtime_state.current_input_metadata === "object"
        ? ctx.runtime_state.current_input_metadata
        : {};
      const handoff = metadata.conversation_handoff && typeof metadata.conversation_handoff === "object"
        ? metadata.conversation_handoff
        : {};
      const recentMessages = Array.isArray(handoff.recent_messages) ? handoff.recent_messages : [];
      const recentTurns = Array.isArray(handoff.recent_turns) ? handoff.recent_turns : [];
      const shortReferenceContext = handoff.short_reference_context &&
        typeof handoff.short_reference_context === "object"
        ? handoff.short_reference_context
        : {};
      const topLevelShortReferenceContext = metadata.short_reference_context &&
        typeof metadata.short_reference_context === "object"
        ? metadata.short_reference_context
        : {};
      const hasPreviousUser = recentMessages.some((message) =>
        message.role === "user" && /ChatGPT/.test(message.content) && /5\.5/.test(message.content)
      );
      const hasPreviousAssistant = recentMessages.some((message) =>
        message.role === "assistant" && /ChatGPT 5\.5/.test(message.content)
      );
      const hasTurnBundle = recentTurns.some((turn) =>
        turn.user?.content?.includes("ChatGPT") && turn.assistant?.content?.includes("ChatGPT 5.5")
      );
      const hasShortReferenceContext =
        /ChatGPT/.test(shortReferenceContext.last_user_message ?? "") &&
        /ChatGPT 5\.5/.test(shortReferenceContext.last_assistant_message ?? "") &&
        Array.isArray(shortReferenceContext.recent_entities) &&
        shortReferenceContext.recent_entities.some((entity) => /ChatGPT/i.test(entity)) &&
        /ChatGPT 5\.5/.test(topLevelShortReferenceContext.last_assistant_message ?? "");

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: input.includes("less than one hour") &&
            hasPreviousUser &&
            hasPreviousAssistant &&
            hasTurnBundle &&
            hasShortReferenceContext
            ? "You mean ChatGPT 5.5. I will continue using that model context."
            : "I will look up the latest information about ChatGPT 5.5.",
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function createApprovalReasoner() {
  return {
    name: "approval-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "approval-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0.2,
          payload: { summary: "Send the email after approval." }
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
            title: "Email sent",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Send email",
          tool_name: "email_send",
          tool_args: {
            to: ["demo@example.com"],
            subject: "Demo",
            body: input
          },
          side_effect_level: "high"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a local port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}
