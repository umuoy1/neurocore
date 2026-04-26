import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { normalizePersonalIngressMessage } from "../examples/personal-assistant/dist/im-gateway/ingress.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import {
  extractMediaForRuntime,
  formatMediaDeliveryText,
  formatMediaPrompt
} from "../examples/personal-assistant/dist/im-gateway/media/media-attachments.js";

test("media ingress normalizes image file audio and voice into channel attachments", () => {
  const message = normalizePersonalIngressMessage({
    message_id: "media-msg-1",
    platform: "web",
    chat_id: "chat-media",
    sender_id: "user-media",
    content: { type: "text", text: "please inspect these" },
    attachments: [
      {
        kind: "image",
        url: "https://example.test/cat.png",
        caption: "cat photo",
        alt_text: "a cat"
      },
      {
        kind: "file",
        url: "https://example.test/report.pdf",
        filename: "report.pdf",
        text_excerpt: "quarterly revenue"
      },
      {
        kind: "audio",
        url: "https://example.test/briefing.mp3",
        filename: "briefing.mp3",
        transcript: "audio transcript",
        duration_ms: 12_000
      },
      {
        kind: "voice",
        url: "https://example.test/voice.ogg",
        transcript: "voice transcript",
        duration_ms: 4_000
      }
    ]
  });

  assert.deepEqual(message.attachments.map((item) => item.kind), ["image", "file", "audio", "voice"]);
  assert.equal(message.attachments[0].provenance.platform, "web");
  assert.equal(message.attachments[0].provenance.message_id, "media-msg-1");
  assert.equal(message.attachments[1].mime_type, "application/pdf");
  assert.equal(message.attachments[1].sensitivity, "private");
  assert.equal(message.attachments[2].sensitivity, "private");
  assert.equal(message.attachments[3].mime_type, "audio/ogg");

  const imageMessage = normalizePersonalIngressMessage({
    message_id: "image-msg",
    platform: "telegram",
    chat_id: "chat-image",
    sender_id: "user-image",
    content: { type: "image", url: "https://example.test/diagram.jpg", caption: "diagram" }
  });
  assert.equal(imageMessage.attachments.length, 1);
  assert.equal(imageMessage.attachments[0].kind, "image");
  assert.equal(imageMessage.attachments[0].mime_type, "image/jpeg");
});

test("media extraction marks provenance sensitivity and injects runtime content parts", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-media-"));
  const dbPath = join(tempDir, "assistant.sqlite");

  try {
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath,
      buildAgent: () => createPersonalAssistantAgent({
        db_path: dbPath,
        tenant_id: "test-tenant",
        reasoner: createMediaEchoReasoner()
      })
    });
    const builder = runtimeFactory.getBuilder();
    const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
    const router = new ConversationRouter({
      builder,
      tenantId: "test-tenant",
      mappingStore
    });
    const adapter = new FakeAdapter("web");
    const dispatcher = new NotificationDispatcher({
      getAdapter: () => adapter,
      mappingStore
    });
    const gateway = new IMGateway({
      builder,
      router,
      dispatcher,
      approvalBindingStore: new SqliteApprovalBindingStore({ filename: dbPath })
    });
    gateway.registerAdapter(adapter, { auth: {} });

    const message = normalizePersonalIngressMessage({
      message_id: "media-msg-2",
      platform: "web",
      chat_id: "chat-media",
      sender_id: "user-media",
      content: { type: "audio", url: "https://example.test/briefing.mp3", transcript: "ship the weekly plan" }
    });
    const extractions = extractMediaForRuntime(message);
    assert.equal(extractions.length, 1);
    assert.equal(extractions[0].kind, "audio");
    assert.equal(extractions[0].sensitivity, "private");
    assert.equal(extractions[0].content_parts.some((part) => part.type === "file" && part.mime_type === "audio/mpeg"), true);
    assert.match(formatMediaPrompt(extractions), /provenance=web:chat-media:media-msg-2/);

    await gateway.handleMessage(message);
    const textMessages = adapter.messages.filter((item) => item.content.type === "text");
    const mediaEcho = textMessages.find((item) => /kinds=audio/.test(item.content.text));
    assert.ok(mediaEcho);
    assert.ok(textMessages.some((item) => /kinds=audio/.test(item.content.text)));
    assert.ok(/parts=[1-9]/.test(mediaEcho.content.text));
    assert.ok(textMessages.some((item) => /sensitivity=private/.test(item.content.text)));
    assert.ok(textMessages.some((item) => /ship the weekly plan/.test(item.content.text)));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("media delivery preserves rich content and provides text fallback", async () => {
  const adapter = new FakeAdapter("web");
  const dispatcher = new NotificationDispatcher({
    getAdapter: () => adapter,
    mappingStore: {
      getRoute() {},
      upsertRoute() {},
      deleteRoute() {},
      listRoutesForUser() {
        return [];
      }
    }
  });

  await dispatcher.sendToChat("web", "chat-media", {
    type: "voice",
    url: "https://example.test/voice.ogg",
    transcript: "approve the plan",
    duration_ms: 2_000
  });

  assert.equal(adapter.messages[0].content.type, "voice");
  assert.match(formatMediaDeliveryText(adapter.messages[0].content), /Voice message/);
  assert.match(formatMediaDeliveryText(adapter.messages[0].content), /approve the plan/);
  assert.match(formatMediaDeliveryText({
    type: "audio",
    url: "https://example.test/briefing.mp3",
    filename: "briefing.mp3",
    transcript: "daily briefing"
  }), /daily briefing/);
});

function createMediaEchoReasoner() {
  return {
    name: "media-echo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "media-echo-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Echo media metadata." }
        }
      ];
    },
    async respond(ctx) {
      const metadata = ctx.runtime_state.current_input_metadata ?? {};
      const extractions = Array.isArray(metadata.media_extractions) ? metadata.media_extractions : [];
      const kinds = extractions.map((item) => item.kind).join(",");
      const sensitivity = extractions.map((item) => item.sensitivity).join(",");
      const text = extractions.map((item) => item.text).filter(Boolean).join("|");
      const parts = Array.isArray(ctx.runtime_state.current_input_parts)
        ? ctx.runtime_state.current_input_parts.length
        : 0;
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Echo media metadata",
          description: `kinds=${kinds};parts=${parts};sensitivity=${sensitivity};text=${text}`,
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
