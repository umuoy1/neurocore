import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { CommandHandler } from "../examples/personal-assistant/dist/im-gateway/command/command-handler.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";

test("personal assistant persists approval binding and resumes execution after approve", { concurrency: false }, async () => {
  const harness = createApprovalHarness();

  try {
    await harness.gateway.handleMessage(createTextMessage("msg-1", "please send the email"));

    const approvalMessage = harness.adapter.lastMessageOfType("approval_request");
    assert.equal(approvalMessage.content.type, "approval_request");
    const binding = harness.approvalBindingStore.getBindingByApprovalId(
      approvalMessage.content.approval_id
    );
    assert.ok(binding, "approval binding should be persisted");

    await harness.gateway.handleMessage(
      createActionMessage("msg-2", "approve", "approved-user", {
        approval_id: approvalMessage.content.approval_id
      })
    );

    const finalMessage = harness.adapter.lastMessageOfType("text");
    assert.equal(finalMessage.content.type, "text");
    assert.match(finalMessage.content.text, /Email sent with id email-1/i);
    assert.equal(harness.emailSendCalls.length, 1);
    assert.equal(
      harness.approvalBindingStore.getBindingByApprovalId(approvalMessage.content.approval_id),
      undefined
    );
  } finally {
    harness.close();
  }
});

test("personal assistant keeps session resumable after approval rejection", { concurrency: false }, async () => {
  const harness = createApprovalHarness();

  try {
    await harness.gateway.handleMessage(createTextMessage("msg-1", "please send the email"));
    const approvalMessage = harness.adapter.lastMessageOfType("approval_request");

    await harness.gateway.handleMessage(
      createActionMessage("msg-2", "reject", "approved-user", {
        approval_id: approvalMessage.content.approval_id
      })
    );

    const rejectionMessage = harness.adapter.lastMessageOfType("text");
    assert.equal(rejectionMessage.content.type, "text");
    assert.match(rejectionMessage.content.text, /Approval rejected/i);
    assert.equal(harness.emailSendCalls.length, 0);

    const binding = harness.approvalBindingStore.getBindingByApprovalId(
      approvalMessage.content.approval_id
    );
    assert.equal(binding, undefined);

    const activeRoute = harness.mappingStore.getRoute("web", "chat-1");
    assert.ok(activeRoute, "chat route should still exist");
    const session = harness.builder.connectSession(activeRoute.session_id).getSession();
    assert.equal(session?.state, "waiting");
  } finally {
    harness.close();
  }
});

test("personal assistant reports unauthorized approver and keeps approval pending", { concurrency: false }, async () => {
  const harness = createApprovalHarness();

  try {
    await harness.gateway.handleMessage(createTextMessage("msg-1", "please send the email"));
    const approvalMessage = harness.adapter.lastMessageOfType("approval_request");

    await harness.gateway.handleMessage(
      createActionMessage("msg-2", "approve", "intruder", {
        approval_id: approvalMessage.content.approval_id
      })
    );

    const errorMessage = harness.adapter.lastMessageOfType("text");
    assert.equal(errorMessage.content.type, "text");
    assert.match(errorMessage.content.text, /not in the allowed approvers list/i);
    assert.equal(harness.emailSendCalls.length, 0);

    const binding = harness.approvalBindingStore.getBindingByApprovalId(
      approvalMessage.content.approval_id
    );
    assert.ok(binding, "approval should remain pending after unauthorized attempt");
  } finally {
    harness.close();
  }
});

test("personal assistant can skip approval when auto_approve is enabled at startup", { concurrency: false }, async () => {
  const harness = createApprovalHarness({
    agent: {
      auto_approve: true,
      approvers: ["approved-user"],
      required_approval_tools: ["email_send"]
    }
  });

  try {
    await harness.gateway.handleMessage(createTextMessage("msg-1", "please send the email"));

    const finalMessage = harness.adapter.lastMessageOfType("text");
    assert.equal(finalMessage.content.type, "text");
    assert.match(finalMessage.content.text, /Email sent with id email-1/i);
    assert.equal(harness.emailSendCalls.length, 1);
    assert.equal(harness.approvalBindingStore.getBinding("web", finalMessage.message_id), undefined);
  } finally {
    harness.close();
  }
});

function createApprovalHarness(overrides = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-approval-"));
  const dbPath = join(tempDir, "assistant.sqlite");
  const emailSendCalls = [];
  const baseConfig = {
    db_path: dbPath,
    tenant_id: "test-tenant",
    reasoner: createApprovalReasoner(),
    agent: {
      approvers: ["approved-user"],
      required_approval_tools: ["email_send"]
    },
    connectors: {
      browser: {},
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
  };
  const config = mergeConfig(baseConfig, overrides);
  const runtimeFactory = new AssistantRuntimeFactory({
    dbPath,
    buildAgent: () => createPersonalAssistantAgent(config)
  });
  const builder = runtimeFactory.getBuilder();

  const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
  const approvalBindingStore = new SqliteApprovalBindingStore({ filename: dbPath });
  const router = new ConversationRouter({
    builder,
    tenantId: "test-tenant",
    mappingStore
  });
  const adapter = new FakeAdapter();
  const dispatcher = new NotificationDispatcher({
    getAdapter: () => adapter,
    mappingStore
  });
  const gateway = new IMGateway({
    builder,
    router,
    dispatcher,
    approvalBindingStore,
    commandHandler: new CommandHandler({
      router,
      dispatcher
    })
  });
  gateway.registerAdapter(adapter, { auth: {} });

  return {
    builder,
    gateway,
    adapter,
    mappingStore,
    approvalBindingStore,
    emailSendCalls,
    close() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function mergeConfig(base, overrides) {
  return {
    ...base,
    ...overrides,
    agent: {
      ...base.agent,
      ...overrides.agent
    },
    connectors: {
      ...base.connectors,
      ...overrides.connectors,
      email: {
        ...base.connectors?.email,
        ...overrides.connectors?.email
      }
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

function createTextMessage(messageId, text, senderId = "user-1") {
  return {
    message_id: messageId,
    platform: "web",
    chat_id: "chat-1",
    sender_id: senderId,
    timestamp: new Date().toISOString(),
    content: { type: "text", text },
    metadata: {}
  };
}

function createActionMessage(messageId, action, senderId, params) {
  return {
    message_id: messageId,
    platform: "web",
    chat_id: "chat-1",
    sender_id: senderId,
    timestamp: new Date().toISOString(),
    content: {
      type: "action",
      action,
      params
    },
    metadata: {}
  };
}

class FakeAdapter {
  constructor() {
    this.platform = "web";
    this.messages = [];
  }

  async start() {}

  async stop() {}

  onMessage() {}

  async sendMessage(chatId, content) {
    const message = {
      message_id: `sent-${this.messages.length + 1}`,
      chat_id: chatId,
      content
    };
    this.messages.push(message);
    return { message_id: message.message_id };
  }

  async editMessage(chatId, messageId, content) {
    this.messages.push({
      message_id: messageId,
      chat_id: chatId,
      content,
      edited: true
    });
  }

  lastMessage() {
    assert.ok(this.messages.length > 0, "expected adapter to have sent messages");
    return this.messages[this.messages.length - 1];
  }

  lastMessageOfType(type) {
    const candidate = [...this.messages].reverse().find((message) => message.content.type === type);
    assert.ok(candidate, `expected adapter to have sent a ${type} message`);
    return candidate;
  }
}
