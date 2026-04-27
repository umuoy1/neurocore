import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAICompatibleModelRouterReasoner,
  OpenAICompatibleProviderRegistry
} from "@neurocore/sdk-node";
import { CommandHandler } from "../examples/personal-assistant/dist/im-gateway/command/command-handler.js";
import { normalizePersonalIngressMessage } from "../examples/personal-assistant/dist/im-gateway/ingress.js";

test("model router falls back from a rate-limited primary provider to the backup provider", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push(body.model);
    if (body.model === "primary-model") {
      return new Response("rate limit", {
        status: 429,
        statusText: "Too Many Requests"
      });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [
                  {
                    action_type: "respond",
                    title: "Answer from backup",
                    description: "backup provider answered"
                  }
                ]
              })
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };

  const registry = new OpenAICompatibleProviderRegistry({
    defaultProviderId: "primary",
    fetch: fetchImpl,
    providers: [
      {
        id: "primary",
        provider: "openai-compatible",
        model: "primary-model",
        apiUrl: "https://primary.example/v1",
        bearerToken: "primary-token",
        fallbackProviderIds: ["backup"]
      },
      {
        id: "backup",
        provider: "openai-compatible",
        model: "backup-model",
        apiUrl: "https://backup.example/v1",
        bearerToken: "backup-token"
      }
    ]
  });
  const reasoner = new OpenAICompatibleModelRouterReasoner({
    registry,
    fetch: fetchImpl
  });
  const ctx = createModuleContext({
    personal_assistant: {
      model_provider_id: "primary"
    }
  });

  const actions = await reasoner.respond(ctx);

  assert.deepEqual(requests, ["primary-model", "backup-model"]);
  assert.equal(actions[0].action_type, "respond");
  assert.equal(actions[0].description, "backup provider answered");
  assert.equal(ctx.session.metadata.model_provider_router.last_selected_provider_id, "backup");
  assert.equal(ctx.session.metadata.model_provider_router.last_failure_count, 1);
});

test("model provider health probe reports rate-limit failure mode", async () => {
  const registry = new OpenAICompatibleProviderRegistry({
    defaultProviderId: "primary",
    fetch: async () => new Response("quota exceeded", {
      status: 429,
      statusText: "Too Many Requests"
    }),
    providers: [
      {
        id: "primary",
        provider: "openai-compatible",
        model: "primary-model",
        apiUrl: "https://primary.example/v1",
        bearerToken: "primary-token"
      }
    ]
  });

  const report = await registry.healthCheck("primary");

  assert.equal(report.ok, false);
  assert.equal(report.provider_id, "primary");
  assert.equal(report.failure_mode, "rate_limit");
  assert.equal(report.status, 429);
});

test("model command switches only the current session and writes an audit entry", async () => {
  const harness = createModelCommandHarness();

  const switched = await harness.send("/model use backup", "chat-a");
  const otherStatus = await harness.send("/model", "chat-b");
  const audit = await harness.send("/model audit", "chat-a");
  const health = await harness.send("/model health primary", "chat-a");

  assert.match(switched, /provider_id: backup/);
  assert.equal(harness.sessions.a.metadata.personal_assistant.model_provider_id, "backup");
  assert.equal(harness.sessions.b.metadata.personal_assistant?.model_provider_id, undefined);
  assert.match(otherStatus, /session_provider_id: default/);
  assert.match(audit, /command=use/);
  assert.match(audit, /from=primary/);
  assert.match(audit, /to=backup/);
  assert.match(health, /failure_mode: rate_limit/);
});

function createModuleContext(sessionMetadata = {}) {
  return {
    tenant_id: "test",
    session: {
      session_id: "ses-model",
      schema_version: "0.1.0",
      tenant_id: "test",
      agent_id: "personal-assistant",
      state: "running",
      session_mode: "interactive",
      goal_tree_ref: "goal-tree",
      budget_state: {},
      policy_state: {},
      metadata: sessionMetadata
    },
    profile: {
      schema_version: "0.1.0",
      role: "Test assistant",
      tool_refs: [],
      metadata: {}
    },
    goals: [],
    runtime_state: {
      current_input_content: "answer",
      current_input_metadata: {}
    },
    services: {
      now: () => "2026-04-27T00:00:00.000Z",
      generateId: (prefix) => `${prefix}_model`
    }
  };
}

function createModelCommandHarness() {
  const sent = [];
  const sessions = {
    a: createSession("ses-a"),
    b: createSession("ses-b")
  };
  const routes = {
    "chat-a": {
      platform: "web",
      chat_id: "chat-a",
      session_id: sessions.a.session_id,
      sender_id: "user-model",
      canonical_user_id: "user-model"
    },
    "chat-b": {
      platform: "web",
      chat_id: "chat-b",
      session_id: sessions.b.session_id,
      sender_id: "user-model",
      canonical_user_id: "user-model"
    }
  };
  const router = {
    listRoutesForUser() {
      return Object.values(routes);
    },
    connect(sessionId) {
      return {
        getSession() {
          return sessionId === sessions.a.session_id ? sessions.a : sessions.b;
        }
      };
    },
    clearRoute() {}
  };
  const dispatcher = {
    async sendToChat(platform, chatId, content) {
      sent.push({ platform, chatId, content });
      return { message_id: `sent-${sent.length}` };
    }
  };
  const handler = new CommandHandler({
    router,
    dispatcher,
    model: {
      defaultProviderId: "primary",
      providers: [
        {
          id: "primary",
          provider: "openai-compatible",
          model: "primary-model",
          apiUrl: "https://primary.example/v1",
          fallbackProviderIds: ["backup"]
        },
        {
          id: "backup",
          provider: "openai-compatible",
          model: "backup-model",
          apiUrl: "https://backup.example/v1"
        }
      ],
      healthCheck: async (providerId) => ({
        provider_id: providerId ?? "primary",
        provider: "openai-compatible",
        model: `${providerId ?? "primary"}-model`,
        api_url: "https://primary.example/v1",
        ok: false,
        status: 429,
        status_text: "Too Many Requests",
        latency_ms: 7,
        failure_mode: "rate_limit",
        error_message: "quota exceeded"
      })
    }
  });

  return {
    sessions,
    async send(text, chatId) {
      await handler.tryHandle(normalizePersonalIngressMessage({
        platform: "web",
        chat_id: chatId,
        sender_id: "user-model",
        content: text
      }));
      return sent.at(-1)?.content.text ?? "";
    }
  };
}

function createSession(sessionId) {
  return {
    session_id: sessionId,
    schema_version: "0.1.0",
    tenant_id: "test",
    agent_id: "personal-assistant",
    state: "running",
    session_mode: "interactive",
    goal_tree_ref: "goal-tree",
    budget_state: {},
    policy_state: {},
    metadata: {
      personal_assistant: {}
    }
  };
}
