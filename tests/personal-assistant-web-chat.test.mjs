import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { startPersonalAssistantApp } from "../examples/personal-assistant/dist/main.js";

test("personal assistant web chat serves a local page and health endpoint", async (t) => {
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

test("personal assistant web chat reconnects the same chat to the same waiting session", async (t) => {
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

test("personal assistant web chat resumes high-risk approval actions after approve", async (t) => {
  const emailSendCalls = [];
  const fixture = await createFixtureOrSkip(t, {
    reasoner: createApprovalReasoner(),
    agent: {
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
    const approvalMessage = await client.nextMessage();
    assert.equal(approvalMessage.type, "message");
    assert.equal(approvalMessage.content.type, "approval_request");
    assert.ok(approvalMessage.content.approval_id);

    client.socket.send(JSON.stringify({
      type: "action",
      action: "approve",
      params: {
        approval_id: approvalMessage.content.approval_id
      },
      reply_to: approvalMessage.message_id
    }));

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
    if (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(payload);
      return;
    }
    queue.push(payload);
  });

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise((resolve) => {
    socket.once("close", resolve);
  });

  await opened;

  return {
    socket,
    closed,
    async nextMessage() {
      if (queue.length > 0) {
        return queue.shift();
      }

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for WebSocket message."));
        }, 5000);

        waiters.push((payload) => {
          clearTimeout(timeout);
          resolve(payload);
        });
      });
    }
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
