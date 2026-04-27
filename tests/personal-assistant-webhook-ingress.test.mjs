import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import {
  GmailPubSubWebhookAdapter,
  PersonalWebhookIngress
} from "../examples/personal-assistant/dist/webhook/webhook-ingress.js";

test("generic webhook rejects missing token and creates untrusted task for valid payload", async () => {
  const ingress = new PersonalWebhookIngress({
    routes: [{
      id: "task-route",
      path: "/hooks/task",
      token: "secret-token",
      target: "task",
      target_user: "owner",
      description: "Process webhook task"
    }]
  });

  const rejected = await ingress.handle({
    method: "POST",
    path: "/hooks/task",
    body: { text: "hello" }
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.accepted, false);

  const accepted = await ingress.handle({
    method: "POST",
    path: "/hooks/task",
    headers: { authorization: "Bearer secret-token" },
    body: { text: "hello task" }
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.target, "task");
  const task = ingress.taskLedger.get(accepted.body.task_id);
  assert.equal(task.status, "created");
  assert.equal(task.source, "webhook");
  assert.equal(task.metadata.untrusted_content, true);
  assert.deepEqual(task.metadata.payload, { text: "hello task" });
  assert.equal(ingress.listAuditEvents().at(-1).status, "accepted");
});

test("generic webhook routes valid untrusted payload into personal gateway session", { concurrency: false }, async () => {
  const harness = createWebhookHarness();
  try {
    const ingress = new PersonalWebhookIngress({
      routes: [{
        id: "session-route",
        path: "/hooks/session",
        token: "session-token",
        target: "session",
        platform: "web",
        chat_id: "webhook-chat",
        sender_id: "webhook-sender"
      }],
      handleMessage: (message) => harness.gateway.handleMessage(message)
    });

    const response = await ingress.handle({
      method: "POST",
      path: "/hooks/session",
      headers: { "x-neurocore-webhook-token": "session-token" },
      body: {
        message_id: "webhook-msg-1",
        event: "deploy.finished",
        status: "ok"
      }
    });

    assert.equal(response.status, 202);
    const route = harness.mappingStore.getRoute("web", "webhook-chat");
    assert.ok(route);
    const output = harness.adapter.messages.map((message) => message.content.text ?? "").join("\n");
    assert.match(output, /UNTRUSTED_WEBHOOK_PAYLOAD/);
    assert.match(output, /deploy\.finished/);
  } finally {
    harness.close();
  }
});

test("gmail pubsub adapter authenticates push payload and emits untrusted email event", async () => {
  const observed = [];
  const adapter = new GmailPubSubWebhookAdapter({
    token: "gmail-token",
    handleMessage: async (message) => {
      observed.push(message);
    },
    now: () => "2026-04-28T01:30:00.000Z"
  });
  const data = Buffer.from(JSON.stringify({
    emailAddress: "alice@example.com",
    historyId: "12345"
  }), "utf8").toString("base64");

  const rejected = await adapter.handlePush({
    method: "POST",
    path: "/gmail",
    body: { message: { data } }
  });
  assert.equal(rejected.status, 401);

  const accepted = await adapter.handlePush({
    method: "POST",
    path: "/gmail",
    headers: { authorization: "Bearer gmail-token" },
    body: { message: { messageId: "pubsub-1", data } }
  });
  assert.equal(accepted.status, 202);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "email");
  assert.match(observed[0].content.text, /UNTRUSTED_GMAIL_PUBSUB_EVENT/);
  assert.equal(observed[0].metadata.untrusted_content, true);
  assert.equal(observed[0].metadata.gmail_pubsub.historyId, "12345");
  assert.equal(adapter.listAuditEvents().at(-1).status, "accepted");
});

function createWebhookHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-webhook-"));
  const dbPath = join(tempDir, "assistant.sqlite");
  const runtimeFactory = new AssistantRuntimeFactory({
    dbPath,
    buildAgent: () => createPersonalAssistantAgent({
      db_path: dbPath,
      tenant_id: "tenant-webhook",
      reasoner: createEchoReasoner()
    })
  });
  const builder = runtimeFactory.getBuilder();
  const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
  const approvalBindingStore = new SqliteApprovalBindingStore({ filename: dbPath });
  const router = new ConversationRouter({
    builder,
    tenantId: "tenant-webhook",
    mappingStore
  });
  const adapter = new FakeAdapter();
  let gateway;
  const dispatcher = new NotificationDispatcher({
    getAdapter: () => adapter,
    mappingStore
  });
  gateway = new IMGateway({
    builder,
    router,
    dispatcher,
    approvalBindingStore
  });
  gateway.registerAdapter(adapter, { auth: {} });
  adapter.onMessage((message) => gateway.handleMessage(message));

  return {
    builder,
    gateway,
    mappingStore,
    adapter,
    close() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createEchoReasoner() {
  return {
    name: "webhook-echo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "webhook-echo-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0.2,
          payload: { summary: "Echo webhook payload." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Webhook received",
          description: String(ctx.runtime_state.current_input_content ?? ""),
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

class FakeAdapter {
  constructor() {
    this.platform = "web";
    this.messages = [];
  }

  async start() {}

  async stop() {}

  onMessage(handler) {
    this.handler = handler;
  }

  async sendMessage(chatId, content) {
    const message = {
      message_id: `sent-${this.messages.length + 1}`,
      chat_id: chatId,
      content
    };
    this.messages.push(message);
    return { message_id: message.message_id };
  }

  async editMessage() {}

  async typingIndicator() {}
}
