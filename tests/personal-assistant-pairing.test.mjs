import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { CommandHandler } from "../examples/personal-assistant/dist/im-gateway/command/command-handler.js";
import { PairingManager } from "../examples/personal-assistant/dist/im-gateway/conversation/pairing.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { SqlitePlatformUserLinkStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-platform-user-link-store.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";

test("personal assistant pairing blocks unpaired DM senders and audits pair, home and revoke", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-pairing-"));
  const dbPath = join(tempDir, "assistant.sqlite");
  const calls = {
    count: 0
  };

  try {
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath,
      buildAgent: () => createPersonalAssistantAgent({
        db_path: dbPath,
        tenant_id: "pairing-test",
        reasoner: createCountingReasoner(calls)
      })
    });
    const builder = runtimeFactory.getBuilder();
    const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
    const userLinkStore = new SqlitePlatformUserLinkStore({ filename: dbPath });
    const pairingManager = new PairingManager({
      store: userLinkStore,
      requirePairingFor: ["telegram"],
      generateCode: () => "PAIR1234"
    });
    const router = new ConversationRouter({
      builder,
      tenantId: "pairing-test",
      mappingStore,
      userLinkStore
    });
    const adapter = new FakeAdapter("telegram");
    const dispatcher = new NotificationDispatcher({
      getAdapter: () => adapter,
      mappingStore
    });
    const commandHandler = new CommandHandler({
      router,
      dispatcher,
      pairingManager,
      resolveUserId: (message) => userLinkStore.resolveCanonicalUserId(message.platform, message.sender_id) ?? message.sender_id
    });
    const gateway = new IMGateway({
      builder,
      router,
      dispatcher,
      approvalBindingStore: new SqliteApprovalBindingStore({ filename: dbPath }),
      commandHandler,
      pairingManager,
      resolveUserId: (message) => userLinkStore.resolveCanonicalUserId(message.platform, message.sender_id) ?? message.sender_id
    });
    gateway.registerAdapter(adapter, { auth: {} });

    await gateway.handleMessage(createMessage("msg-1", "hello before pairing"));
    assert.equal(calls.count, 0);
    assert.match(adapter.lastText(), /not paired/i);

    const code = pairingManager.createPairingCode({ canonical_user_id: "canonical-user" });
    assert.equal(code.code, "PAIR1234");

    await gateway.handleMessage(createMessage("msg-2", "/pair PAIR1234"));
    assert.equal(userLinkStore.resolveCanonicalUserId("telegram", "sender-1"), "canonical-user");
    assert.match(adapter.lastText(), /Paired telegram:sender-1 to canonical-user/);

    await gateway.handleMessage(createMessage("msg-3", "/sethome"));
    assert.equal(userLinkStore.getHomeChannel("canonical-user")?.chat_id, "chat-1");
    assert.match(adapter.lastText(), /Home channel set/);

    await gateway.handleMessage(createMessage("msg-4", "hello after pairing"));
    assert.equal(calls.count, 1);
    assert.match(adapter.lastText(), /canonical=canonical-user/);

    await gateway.handleMessage(createMessage("msg-5", "/unpair"));
    assert.equal(userLinkStore.resolveCanonicalUserId("telegram", "sender-1"), undefined);
    assert.match(adapter.lastText(), /Revoked pairing/);

    await gateway.handleMessage(createMessage("msg-6", "hello after revoke"));
    assert.equal(calls.count, 1);
    assert.match(adapter.lastText(), /not paired/i);

    const auditTypes = userLinkStore.listAuditEvents({ limit: 20 }).map((event) => event.event_type);
    assert.ok(auditTypes.includes("blocked_unpaired"));
    assert.ok(auditTypes.includes("pair_code_created"));
    assert.ok(auditTypes.includes("paired"));
    assert.ok(auditTypes.includes("home_channel_set"));
    assert.ok(auditTypes.includes("revoked"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createMessage(messageId, text) {
  return {
    message_id: messageId,
    platform: "telegram",
    chat_id: "chat-1",
    sender_id: "sender-1",
    timestamp: new Date().toISOString(),
    content: { type: "text", text },
    metadata: {}
  };
}

function createCountingReasoner(calls) {
  return {
    name: "pairing-counting-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "pairing-counting-reasoner",
        proposal_type: "plan",
        salience_score: 0.8,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "Respond with identity." }
      }];
    },
    async respond(ctx) {
      calls.count += 1;
      const identity = ctx.runtime_state.current_input_metadata?.identity ?? {};
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Respond",
        description: `canonical=${identity.canonical_user_id}`,
        side_effect_level: "none"
      }];
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

  lastText() {
    return [...this.messages].reverse().find((message) => message.content.type === "text")?.content.text ?? "";
  }
}
