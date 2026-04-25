import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { CommandHandler } from "../examples/personal-assistant/dist/im-gateway/command/command-handler.js";
import { createUserInput } from "../examples/personal-assistant/dist/im-gateway/input/input-factory.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { SqlitePersonalMemoryStore } from "../examples/personal-assistant/dist/memory/sqlite-personal-memory-store.js";

test("personal assistant router reconnects to waiting sessions for the same chat", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-router-"));
  const dbPath = join(tempDir, "assistant.sqlite");

  try {
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath,
      buildAgent: () => createPersonalAssistantAgent({
        db_path: dbPath,
        tenant_id: "test-tenant",
        reasoner: createAskUserReasoner()
      })
    });
    const builder = runtimeFactory.getBuilder();
    const router = new ConversationRouter({
      builder,
      tenantId: "test-tenant",
      mappingStore: new SqliteSessionMappingStore({ filename: dbPath })
    });

    const message = {
      message_id: "msg-1",
      platform: "web",
      chat_id: "chat-1",
      sender_id: "user-1",
      timestamp: new Date().toISOString(),
      content: { type: "text", text: "hello" },
      metadata: {}
    };

    const first = router.resolveOrCreate(message, createUserInput("hello"));
    const firstRun = await first.handle.run();
    assert.equal(first.is_new, true);
    assert.equal(firstRun.finalState, "waiting");

    const second = router.resolveOrCreate(
      { ...message, message_id: "msg-2", content: { type: "text", text: "tell me more" } },
      createUserInput("tell me more")
    );

    assert.equal(second.is_new, false);
    assert.equal(second.session_id, first.session_id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant gateway forwards runtime progress and streamed edits to feishu", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-feishu-gateway-"));
  const dbPath = join(tempDir, "assistant.sqlite");

  try {
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath,
      buildAgent: () => createPersonalAssistantAgent({
        db_path: dbPath,
        tenant_id: "test-tenant",
        reasoner: createStreamingRespondReasoner()
      })
    });
    const builder = runtimeFactory.getBuilder();
    const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
    const router = new ConversationRouter({
      builder,
      tenantId: "test-tenant",
      mappingStore
    });
    const approvalBindingStore = new SqliteApprovalBindingStore({ filename: dbPath });
    const adapter = new FakeAdapter("feishu");
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

    await gateway.handleMessage({
      message_id: "msg-1",
      platform: "feishu",
      chat_id: "chat-1",
      sender_id: "user-1",
      timestamp: new Date().toISOString(),
      content: { type: "text", text: "hello" },
      metadata: {}
    });

    const statusMessages = adapter.messages.filter((message) => message.content.type === "status");
    assert.ok(statusMessages.length >= 4);
    assert.ok(statusMessages.some((message) => message.content.phase === "memory_retrieval"));
    assert.ok(statusMessages.some((message) => message.content.phase === "reasoning"));
    assert.ok(statusMessages.some((message) => message.content.phase === "response_generation"));

    const textMessages = adapter.messages.filter((message) => message.content.type === "text" && !message.edited);
    assert.ok(textMessages.length >= 1);
    assert.match(textMessages[0].content.text, /streamed reply/i);

    const editedMessages = adapter.messages.filter((message) => message.edited);
    assert.ok(editedMessages.length >= 1);
    assert.equal(editedMessages[0].message_id, textMessages[0].message_id);
    assert.ok(editedMessages.at(-1).content.text.length > textMessages[0].content.text.length);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant memory commands remember, correct, and forget user memories", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-memory-commands-"));
  const dbPath = join(tempDir, "assistant.sqlite");

  try {
    const memoryStore = new SqlitePersonalMemoryStore({ filename: dbPath });
    const sent = [];
    const handler = new CommandHandler({
      router: {},
      dispatcher: {
        async sendToChat(platform, chatId, content) {
          sent.push({ platform, chatId, content });
          return { message_id: `sent-${sent.length}` };
        }
      },
      memoryStore,
      resolveUserId: () => "canonical-user"
    });

    await handler.tryHandle(createTextMessage("msg-1", "/remember User prefers concise Chinese answers."));
    let memories = memoryStore.listActive("canonical-user");
    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /concise Chinese/);

    await handler.tryHandle(createTextMessage("msg-2", `/correct ${memories[0].memory_id} => User prefers detailed Chinese answers.`));
    memories = memoryStore.listActive("canonical-user");
    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /detailed Chinese/);
    assert.ok(memories[0].correction_of);

    await handler.tryHandle(createTextMessage("msg-3", `/forget ${memories[0].memory_id}`));
    memories = memoryStore.listActive("canonical-user");
    assert.equal(memories.length, 0);
    assert.ok(sent.some((message) => /Forgot 1 memory/.test(message.content.text)));

    memoryStore.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant injects active user memories into runtime input metadata", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-memory-injection-"));
  const dbPath = join(tempDir, "assistant.sqlite");

  try {
    const memoryStore = new SqlitePersonalMemoryStore({ filename: dbPath });
    memoryStore.remember({
      user_id: "canonical-user",
      content: "User prefers answers in Chinese.",
      created_at: "2026-04-25T00:00:00.000Z"
    });
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath,
      buildAgent: () => createPersonalAssistantAgent({
        db_path: dbPath,
        tenant_id: "test-tenant",
        reasoner: createMemoryAwareReasoner()
      })
    });
    const builder = runtimeFactory.getBuilder();
    const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
    const router = new ConversationRouter({
      builder,
      tenantId: "test-tenant",
      mappingStore
    });
    const approvalBindingStore = new SqliteApprovalBindingStore({ filename: dbPath });
    const adapter = new FakeAdapter("feishu");
    const dispatcher = new NotificationDispatcher({
      getAdapter: () => adapter,
      mappingStore
    });
    const gateway = new IMGateway({
      builder,
      router,
      dispatcher,
      approvalBindingStore,
      memoryStore,
      resolveUserId: () => "canonical-user"
    });
    gateway.registerAdapter(adapter, { auth: {} });

    await gateway.handleMessage(createTextMessage("msg-1", "How should you answer me?"));

    const textMessages = adapter.messages.filter((message) => message.content.type === "text");
    assert.ok(textMessages.some((message) => /User prefers answers in Chinese/.test(message.content.text)));

    memoryStore.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

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
          payload: { summary: "Ask a follow-up question." }
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

function createStreamingRespondReasoner() {
  return {
    name: "streaming-respond-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "streaming-respond-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Respond with a streamed answer." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: "streamed reply for feishu progress coverage",
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

function createMemoryAwareReasoner() {
  return {
    name: "memory-aware-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "memory-aware-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Respond using personal memories." }
        }
      ];
    },
    async respond(ctx) {
      const metadata = ctx.runtime_state.current_input_metadata ?? {};
      const personalMemory = metadata.personal_memory ?? {};
      const memories = Array.isArray(personalMemory.memories) ? personalMemory.memories : [];
      const memoryText = memories.map((memory) => memory.content).join(" | ");
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond with memory",
          description: `memory: ${memoryText}`,
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
  constructor(platform) {
    this.platform = platform;
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
}

function createTextMessage(messageId, text, senderId = "user-1") {
  return {
    message_id: messageId,
    platform: "feishu",
    chat_id: "chat-1",
    sender_id: senderId,
    timestamp: new Date().toISOString(),
    content: { type: "text", text },
    metadata: {}
  };
}
