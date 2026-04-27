import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPersonalAssistantConfigFromEnv } from "../examples/personal-assistant/dist/app/assistant-config.js";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import {
  MatrixAdapter,
  SignalAdapter,
  TeamsAdapter,
  WeChatAdapter,
  WhatsAppAdapter
} from "../examples/personal-assistant/dist/im-gateway/adapter/extended-channels.js";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { normalizePersonalIngressMessage } from "../examples/personal-assistant/dist/im-gateway/ingress.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import { SqlitePersonalMemoryStore } from "../examples/personal-assistant/dist/memory/sqlite-personal-memory-store.js";

test("extended channel adapters normalize receive send approval and safe fallback", async () => {
  for (const scenario of channelScenarios()) {
    const recorder = createFetchRecorder(scenario.platform);
    const adapter = new scenario.Adapter({ fetch: recorder.fetch, now: () => "2026-04-28T03:00:00.000Z" });
    const observed = [];

    adapter.onMessage((message) => observed.push(message));
    await adapter.start(scenario.config);

    assert.equal(await scenario.receiveText(adapter), true, scenario.platform);
    assert.equal(observed[0].platform, scenario.platform);
    assert.equal(observed[0].sender_id, scenario.senderId);
    assert.equal(observed[0].content.type, "text");
    assert.equal(observed[0].content.text, "hello");
    assert.equal(observed[0].channel.kind, "im");
    assert.equal(observed[0].channel.capabilities.approval_requests, true);
    assert.equal(observed[0].identity.trust_level, "paired");

    assert.equal(await scenario.receiveAction(adapter), true, scenario.platform);
    assert.equal(observed[1].content.type, "action");
    assert.equal(observed[1].content.action, "reject");
    assert.equal(observed[1].content.params.approval_id, `apv-${scenario.platform}`);

    assert.equal(await scenario.receiveUnauthorized(adapter), false, scenario.platform);
    assert.equal(observed.length, 2);

    const approval = await adapter.sendMessage(scenario.chatId, {
      type: "approval_request",
      text: `Approve ${scenario.platform}?`,
      approval_id: `apv-${scenario.platform}`,
      approve_label: "Allow",
      reject_label: "Deny"
    });
    await adapter.sendMessage(scenario.chatId, {
      type: "voice",
      url: "https://cdn.example.test/voice.ogg",
      transcript: "voice transcript"
    });
    await adapter.editMessage(scenario.chatId, approval.message_id, { type: "text", text: "edited" });
    await adapter.typingIndicator?.(scenario.chatId);

    assert.ok(approval.message_id.length > 0);
    assert.ok(recorder.requests.some((request) => JSON.stringify(request.body).includes(`apv-${scenario.platform}`)), scenario.platform);
    assert.ok(recorder.requests.some((request) => JSON.stringify(request.body).includes("voice transcript") || JSON.stringify(request.body).includes("voice.ogg")), scenario.platform);
    assert.equal(recorder.requests.every((request) => request.url.startsWith(scenario.expectedBaseUrl)), true, scenario.platform);

    if (scenario.platform === "matrix") {
      assert.ok(recorder.requests.some((request) => request.body?.["m.relates_to"]?.rel_type === "m.replace"));
      assert.ok(recorder.requests.some((request) => request.body?.typing === true));
    } else if (scenario.platform === "teams") {
      assert.ok(recorder.requests.some((request) => request.body?.type === "typing"));
      assert.ok(recorder.requests.some((request) => JSON.stringify(request.body).includes("AdaptiveCard")));
    } else {
      assert.ok(recorder.requests.some((request) => JSON.stringify(request.body).includes("[edit:")));
    }
  }
});

test("extended channel platform config can be loaded from env", () => {
  const config = createPersonalAssistantConfigFromEnv({
    OPENAI_BASE_URL: "https://model.test/v1",
    OPENAI_API_KEY: "model-token",
    OPENAI_MODEL: "test-model",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-id",
    SIGNAL_ENABLED: "true",
    SIGNAL_SENDER: "+15551230000",
    SIGNAL_API_TOKEN: "signal-token",
    WECHAT_ENABLED: "true",
    WECHAT_ACCESS_TOKEN: "wechat-token",
    MATRIX_ENABLED: "true",
    MATRIX_ACCESS_TOKEN: "matrix-token",
    MATRIX_USER_ID: "@bot:example.test",
    TEAMS_ENABLED: "true",
    TEAMS_BOT_TOKEN: "teams-token"
  }, {
    cwd: "/tmp/neurocore-config-test"
  });

  assert.equal(config.whatsapp.enabled, true);
  assert.equal(config.whatsapp.phone_number_id, "phone-id");
  assert.equal(config.signal.sender, "+15551230000");
  assert.equal(config.wechat.access_token, "wechat-token");
  assert.equal(config.matrix.user_id, "@bot:example.test");
  assert.equal(config.teams.bot_token, "teams-token");
});

test("extended channel platforms pass gateway handoff and memory smoke", { concurrency: false }, async () => {
  for (const platform of ["whatsapp", "signal", "wechat", "matrix", "teams"]) {
    const tempDir = mkdtempSync(join(tmpdir(), `personal-assistant-${platform}-smoke-`));
    const dbPath = join(tempDir, "assistant.sqlite");
    const memoryStore = new SqlitePersonalMemoryStore({ filename: dbPath });

    try {
      memoryStore.remember({
        user_id: `${platform}-user`,
        content: `${platform} preference memory`,
        source: {
          platform,
          chat_id: `${platform}-chat`,
          message_id: `${platform}-memory`
        }
      });
      const runtimeFactory = new AssistantRuntimeFactory({
        dbPath,
        buildAgent: () => createPersonalAssistantAgent({
          db_path: dbPath,
          tenant_id: "extended-channel-test",
          reasoner: createSmokeReasoner()
        }, {
          personalMemoryStore: memoryStore
        })
      });
      const builder = runtimeFactory.getBuilder();
      const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
      const router = new ConversationRouter({
        builder,
        tenantId: "extended-channel-test",
        mappingStore
      });
      const adapter = new FakeAdapter(platform);
      const dispatcher = new NotificationDispatcher({
        getAdapter: () => adapter,
        mappingStore
      });
      const gateway = new IMGateway({
        builder,
        router,
        dispatcher,
        approvalBindingStore: new SqliteApprovalBindingStore({ filename: dbPath }),
        memoryStore
      });

      gateway.registerAdapter(adapter, { auth: {} });
      await gateway.handleMessage(normalizePersonalIngressMessage({
        message_id: `${platform}-1`,
        platform,
        chat_id: `${platform}-chat`,
        sender_id: `${platform}-user`,
        content: "first message"
      }));
      await gateway.handleMessage(normalizePersonalIngressMessage({
        message_id: `${platform}-2`,
        platform,
        chat_id: `${platform}-chat`,
        sender_id: `${platform}-user`,
        content: "second message"
      }));

      const text = adapter.messages.map((message) => message.content.text ?? "").join("\n");
      assert.match(text, new RegExp(`platform=${platform}`));
      assert.match(text, new RegExp(`${platform} preference memory`));
      assert.match(text, /handoff=yes/);
    } finally {
      memoryStore.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

function channelScenarios() {
  return [
    {
      platform: "whatsapp",
      Adapter: WhatsAppAdapter,
      chatId: "15551230000",
      senderId: "15551230000",
      expectedBaseUrl: "https://whatsapp.test",
      config: {
        auth: {
          access_token: "wa-token",
          phone_number_id: "phone-id",
          api_base_url: "https://whatsapp.test"
        },
        allowed_senders: ["15551230000"]
      },
      receiveText: (adapter) => adapter.receiveWebhookEvent(whatsAppPayload("15551230000", "hello")),
      receiveAction: (adapter) => adapter.receiveWebhookEvent(whatsAppPayload("15551230000", undefined, "reject:apv-whatsapp")),
      receiveUnauthorized: (adapter) => adapter.receiveWebhookEvent(whatsAppPayload("19990000000", "blocked"))
    },
    {
      platform: "signal",
      Adapter: SignalAdapter,
      chatId: "+15551230000",
      senderId: "+15551230000",
      expectedBaseUrl: "https://signal.test",
      config: {
        auth: {
          sender: "+15550000000",
          api_token: "signal-token",
          api_base_url: "https://signal.test"
        },
        allowed_senders: ["+15551230000"]
      },
      receiveText: (adapter) => adapter.receiveEnvelope(signalPayload("+15551230000", "hello")),
      receiveAction: (adapter) => adapter.receiveEnvelope(signalPayload("+15551230000", "reject:apv-signal")),
      receiveUnauthorized: (adapter) => adapter.receiveEnvelope(signalPayload("+19990000000", "blocked"))
    },
    {
      platform: "wechat",
      Adapter: WeChatAdapter,
      chatId: "openid-1",
      senderId: "openid-1",
      expectedBaseUrl: "https://wechat.test",
      config: {
        auth: {
          access_token: "wechat-token",
          api_base_url: "https://wechat.test"
        },
        allowed_senders: ["openid-1"]
      },
      receiveText: (adapter) => adapter.receiveMessage(wechatPayload("openid-1", "hello")),
      receiveAction: (adapter) => adapter.receiveMessage(wechatPayload("openid-1", "reject:apv-wechat")),
      receiveUnauthorized: (adapter) => adapter.receiveMessage(wechatPayload("openid-9", "blocked"))
    },
    {
      platform: "matrix",
      Adapter: MatrixAdapter,
      chatId: "!room:example.test",
      senderId: "@ada:example.test",
      expectedBaseUrl: "https://matrix.test",
      config: {
        auth: {
          access_token: "matrix-token",
          user_id: "@bot:example.test",
          api_base_url: "https://matrix.test"
        },
        allowed_senders: ["@ada:example.test"]
      },
      receiveText: (adapter) => adapter.receiveEvent(matrixPayload("@ada:example.test", "hello")),
      receiveAction: (adapter) => adapter.receiveEvent(matrixPayload("@ada:example.test", "reject:apv-matrix")),
      receiveUnauthorized: (adapter) => adapter.receiveEvent(matrixPayload("@mallory:example.test", "blocked"))
    },
    {
      platform: "teams",
      Adapter: TeamsAdapter,
      chatId: "conv-1",
      senderId: "29:ada",
      expectedBaseUrl: "https://teams.test",
      config: {
        auth: {
          bot_token: "teams-token",
          api_base_url: "https://teams.test"
        },
        allowed_senders: ["29:ada"]
      },
      receiveText: (adapter) => adapter.receiveActivity(teamsPayload("29:ada", "hello")),
      receiveAction: (adapter) => adapter.receiveActivity({
        id: "teams-action",
        type: "invoke",
        conversation: { id: "conv-1", conversationType: "personal" },
        from: { id: "29:ada", name: "Ada" },
        value: { action: "reject", approval_id: "apv-teams" },
        timestamp: "2026-04-28T03:00:00.000Z"
      }),
      receiveUnauthorized: (adapter) => adapter.receiveActivity(teamsPayload("29:mallory", "blocked"))
    }
  ];
}

function createFetchRecorder(platform) {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body
      });
      return new Response(JSON.stringify(responseFor(platform, requests.length)), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  };
}

function responseFor(platform, index) {
  if (platform === "whatsapp") return { messages: [{ id: `wamid.${index}` }] };
  if (platform === "signal") return { timestamp: 1777240000000 + index };
  if (platform === "wechat") return { errcode: 0, msgid: `wx-${index}` };
  if (platform === "matrix") return { event_id: `$event-${index}` };
  return { id: `teams-${index}` };
}

function whatsAppPayload(sender, text, action) {
  return {
    entry: [{
      changes: [{
        value: {
          contacts: [{ wa_id: sender, profile: { name: "Ada" } }],
          messages: [{
            id: `wamid.${sender}.${text ?? action}`,
            from: sender,
            timestamp: "1777240000",
            ...(action
              ? { interactive: { button_reply: { id: action, title: action } } }
              : { text: { body: text } })
          }]
        }
      }]
    }]
  };
}

function signalPayload(sender, message) {
  return {
    envelope: {
      source: sender,
      timestamp: 1777240000000,
      dataMessage: {
        timestamp: 1777240000000,
        message
      }
    }
  };
}

function wechatPayload(sender, content) {
  return {
    FromUserName: sender,
    ToUserName: "assistant",
    MsgId: `wx-${sender}-${content}`,
    CreateTime: 1777240000,
    MsgType: "text",
    Content: content
  };
}

function matrixPayload(sender, body) {
  return {
    event_id: `$${sender}-${body}`,
    room_id: "!room:example.test",
    sender,
    origin_server_ts: 1777240000000,
    type: "m.room.message",
    content: {
      msgtype: "m.text",
      body
    }
  };
}

function teamsPayload(sender, text) {
  return {
    id: `teams-${sender}-${text}`,
    type: "message",
    conversation: { id: "conv-1", conversationType: "personal" },
    from: { id: sender, name: "Ada" },
    text,
    timestamp: "2026-04-28T03:00:00.000Z"
  };
}

function createSmokeReasoner() {
  return {
    name: "extended-channel-smoke-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "extended-channel-smoke-reasoner",
        proposal_type: "plan",
        salience_score: 0.8,
        confidence: 0.9,
        risk: 0,
        payload: { summary: "extended channel smoke" }
      }];
    },
    async respond(ctx) {
      const metadata = ctx.runtime_state.current_input_metadata ?? {};
      const memory = metadata.personal_memory?.memories?.[0]?.content ?? "no-memory";
      const handoff = metadata.conversation_handoff ? "yes" : "no";
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "channel smoke",
        description: `platform=${metadata.platform} memory=${memory} handoff=${handoff}`,
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
      message_id: `${this.platform}-sent-${this.messages.length + 1}`,
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
      content
    });
  }
}
