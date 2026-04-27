import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { IMGateway } from "../examples/personal-assistant/dist/im-gateway/gateway.js";
import { normalizePersonalIngressMessage } from "../examples/personal-assistant/dist/im-gateway/ingress.js";
import { CommandHandler } from "../examples/personal-assistant/dist/im-gateway/command/command-handler.js";
import { SqliteApprovalBindingStore } from "../examples/personal-assistant/dist/im-gateway/approval/sqlite-approval-binding-store.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import {
  FixtureSpeechToTextProvider,
  FixtureTextToSpeechProvider,
  VoiceIOService
} from "../examples/personal-assistant/dist/voice/voice-io.js";

test("voice IO transcribes push-to-talk input and delivers TTS voice output", { concurrency: false }, async () => {
  const fixture = createVoiceGateway({
    platform: "whatsapp",
    sttTranscript: "ship the weekly plan",
    ttsAudioUrl: "fixture://voice/output.ogg"
  });

  try {
    await fixture.gateway.handleMessage(normalizePersonalIngressMessage({
      message_id: "voice-1",
      platform: "whatsapp",
      chat_id: "voice-chat",
      sender_id: "voice-user",
      content: {
        type: "voice",
        url: "https://example.test/voice.ogg"
      },
      metadata: {
        push_to_talk: true,
        voice_output: true
      }
    }));

    const voice = fixture.adapter.messages.find((message) => message.content.type === "voice");
    assert.equal(voice.content.url, "fixture://voice/output.ogg");
    assert.match(voice.content.transcript, /heard=ship the weekly plan/);
    assert.match(voice.content.transcript, /push_to_talk=true/);
  } finally {
    fixture.close();
  }
});

test("TTS failures fall back to text output", { concurrency: false }, async () => {
  const fixture = createVoiceGateway({
    platform: "whatsapp",
    sttTranscript: "fallback voice input",
    failTts: true
  });

  try {
    await fixture.gateway.handleMessage(normalizePersonalIngressMessage({
      message_id: "voice-fallback",
      platform: "whatsapp",
      chat_id: "voice-chat",
      sender_id: "voice-user",
      content: {
        type: "audio",
        url: "https://example.test/audio.mp3"
      },
      metadata: {
        voice_output: true
      }
    }));

    assert.equal(fixture.adapter.messages.some((message) => message.content.type === "voice"), false);
    assert.ok(fixture.adapter.messages.some((message) =>
      message.content.type === "text" && /heard=fallback voice input/.test(message.content.text)
    ));
  } finally {
    fixture.close();
  }
});

test("STT failures keep the text response path available", { concurrency: false }, async () => {
  const fixture = createVoiceGateway({
    platform: "whatsapp",
    sttTranscript: "unused transcript",
    failStt: true
  });

  try {
    await fixture.gateway.handleMessage(normalizePersonalIngressMessage({
      message_id: "voice-stt-fallback",
      platform: "whatsapp",
      chat_id: "voice-chat",
      sender_id: "voice-user",
      content: {
        type: "audio",
        url: "https://example.test/audio.mp3"
      },
      metadata: {}
    }));

    assert.equal(fixture.adapter.messages.some((message) => message.content.type === "voice"), false);
    assert.ok(fixture.adapter.messages.some((message) =>
      message.content.type === "text" && /heard=no-media-text/.test(message.content.text)
    ));
  } finally {
    fixture.close();
  }
});

test("voice command toggles current session voice output metadata", { concurrency: false }, async () => {
  const fixture = createVoiceGateway({
    sttTranscript: "voice command input",
    ttsAudioUrl: "fixture://voice/command.ogg",
    commandHandler: true
  });

  try {
    await fixture.gateway.handleMessage(normalizePersonalIngressMessage({
      message_id: "voice-command-1",
      platform: "web",
      chat_id: "voice-command-chat",
      sender_id: "voice-user",
      content: "start session"
    }));
    await fixture.gateway.handleMessage(normalizePersonalIngressMessage({
      message_id: "voice-command-2",
      platform: "web",
      chat_id: "voice-command-chat",
      sender_id: "voice-user",
      content: "/voice on"
    }));
    await fixture.gateway.handleMessage(normalizePersonalIngressMessage({
      message_id: "voice-command-3",
      platform: "web",
      chat_id: "voice-command-chat",
      sender_id: "voice-user",
      content: "/voice status"
    }));

    const text = fixture.adapter.messages.map((message) => message.content.text ?? "").join("\n");
    assert.match(text, /Voice output enabled/);
    assert.match(text, /voice_output_enabled: true/);
  } finally {
    fixture.close();
  }
});

function createVoiceGateway(options) {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-voice-"));
  const dbPath = join(tempDir, "assistant.sqlite");
  const voiceIO = new VoiceIOService({
    sttProvider: new FixtureSpeechToTextProvider({
      transcript: options.sttTranscript,
      fail: options.failStt
    }),
    ttsProvider: new FixtureTextToSpeechProvider({
      audioUrl: options.ttsAudioUrl,
      fail: options.failTts
    }),
    fallbackToText: true
  });
  const runtimeFactory = new AssistantRuntimeFactory({
    dbPath,
    buildAgent: () => createPersonalAssistantAgent({
      db_path: dbPath,
      tenant_id: "voice-test",
      reasoner: createVoiceReasoner()
    })
  });
  const builder = runtimeFactory.getBuilder();
  const mappingStore = new SqliteSessionMappingStore({ filename: dbPath });
  const router = new ConversationRouter({
    builder,
    tenantId: "voice-test",
    mappingStore
  });
  const platform = options.platform ?? "web";
  const adapter = new FakeAdapter(platform);
  const dispatcher = new NotificationDispatcher({
    getAdapter: () => adapter,
    mappingStore
  });
  const commandHandler = options.commandHandler
    ? new CommandHandler({
        router,
        dispatcher,
        voiceIO
      })
    : undefined;
  const gateway = new IMGateway({
    builder,
    router,
    dispatcher,
    commandHandler,
    approvalBindingStore: new SqliteApprovalBindingStore({ filename: dbPath }),
    voiceIO
  });
  gateway.registerAdapter(adapter, { auth: {} });
  return {
    gateway,
    adapter,
    close() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createVoiceReasoner() {
  return {
    name: "voice-io-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "voice-io-reasoner",
        proposal_type: "plan",
        salience_score: 0.8,
        confidence: 0.9,
        risk: 0,
        payload: { summary: "voice io" }
      }];
    },
    async respond(ctx) {
      const metadata = ctx.runtime_state.current_input_metadata ?? {};
      const extraction = Array.isArray(metadata.media_extractions) ? metadata.media_extractions[0] : undefined;
      const voice = metadata.voice_io && typeof metadata.voice_io === "object" ? metadata.voice_io : {};
      const heard = extraction?.text ?? "no-media-text";
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "voice response",
        description: `heard=${heard} push_to_talk=${voice.push_to_talk === true}`,
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
