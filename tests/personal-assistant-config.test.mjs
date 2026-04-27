import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantConfigFromEnv } from "../examples/personal-assistant/dist/main.js";

test("createPersonalAssistantConfigFromEnv loads config from .neurocore/.personal-assistant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neurocore-pa-config-"));
  const configDirectory = join(directory, ".neurocore", ".personal-assistant");
  await mkdir(configDirectory, { recursive: true });

  await writeFile(
    join(configDirectory, "app.local.json"),
    JSON.stringify({
      db_path: "data/personal-assistant.sqlite",
      tenant_id: "team-local",
      agent: {
        name: "Team Assistant",
        approvers: ["owner"],
        auto_approve: true
      },
      connectors: {
        browser: {
          maxChars: 2048
        }
      },
      web_chat: {
        host: "0.0.0.0",
        port: 4401,
        path: "/ws"
      },
      feishu: {
        app_id: "cli-app-id",
        app_secret: "cli-app-secret"
      }
    }),
    "utf8"
  );
  await writeFile(
    join(configDirectory, "llm.local.json"),
    JSON.stringify({
      provider: "openai-compatible",
      model: "pa-local-model",
      apiUrl: "https://pa.example.com/v1",
      bearerToken: "pa-local-token",
      timeoutMs: 1234,
      extraBody: {
        enable_thinking: false
      }
    }),
    "utf8"
  );

  const config = createPersonalAssistantConfigFromEnv({}, { cwd: directory });

  assert.equal(config.db_path, "data/personal-assistant.sqlite");
  assert.equal(config.tenant_id, "team-local");
  assert.equal(config.agent?.name, "Team Assistant");
  assert.equal(config.agent?.auto_approve, true);
  assert.deepEqual(config.agent?.approvers, ["owner"]);
  assert.equal(config.openai?.model, "pa-local-model");
  assert.equal(config.openai?.apiUrl, "https://pa.example.com/v1");
  assert.equal(config.openai?.bearerToken, "pa-local-token");
  assert.equal(config.openai?.timeoutMs, 1234);
  assert.equal(config.openai?.jsonTimeoutMs, 1234);
  assert.equal(config.openai?.streamTimeoutMs, 1234);
  assert.deepEqual(config.openai?.extraBody, { enable_thinking: false });
  assert.equal(config.web_chat?.host, "0.0.0.0");
  assert.equal(config.web_chat?.port, 4401);
  assert.equal(config.web_chat?.path, "/ws");
  assert.equal(config.feishu?.enabled, true);
  assert.equal(config.feishu?.app_id, "cli-app-id");
  assert.equal(config.connectors?.browser?.maxChars, 2048);
});

test("createPersonalAssistantConfigFromEnv falls back to root .neurocore/llm.local.json", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neurocore-pa-root-"));
  const rootConfigDirectory = join(directory, ".neurocore");
  await mkdir(rootConfigDirectory, { recursive: true });

  await writeFile(
    join(rootConfigDirectory, "llm.local.json"),
    JSON.stringify({
      provider: "openai-compatible",
      model: "root-model",
      apiUrl: "https://root.example.com/v1",
      bearerToken: "root-token",
      extraBody: {
        enable_thinking: false
      }
    }),
    "utf8"
  );

  const config = createPersonalAssistantConfigFromEnv({}, { cwd: directory });

  assert.equal(config.openai?.model, "root-model");
  assert.equal(config.openai?.apiUrl, "https://root.example.com/v1");
  assert.equal(config.openai?.bearerToken, "root-token");
  assert.equal(config.openai?.jsonTimeoutMs, 45000);
  assert.equal(config.openai?.streamTimeoutMs, undefined);
  assert.deepEqual(config.openai?.extraBody, { enable_thinking: false });
});

test("createPersonalAssistantConfigFromEnv lets env override local config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neurocore-pa-env-"));
  const configDirectory = join(directory, ".neurocore", ".personal-assistant");
  await mkdir(configDirectory, { recursive: true });

  await writeFile(
    join(configDirectory, "llm.local.json"),
    JSON.stringify({
      provider: "openai-compatible",
      model: "local-model",
      apiUrl: "https://local.example.com/v1",
      bearerToken: "local-token",
      timeoutMs: 9000
    }),
    "utf8"
  );

  const config = createPersonalAssistantConfigFromEnv(
    {
      OPENAI_MODEL: "env-model",
      WEB_CHAT_PORT: "5501",
      PERSONAL_ASSISTANT_APPROVERS: "alice,bob",
      PERSONAL_ASSISTANT_AUTO_APPROVE: "true",
      OPENAI_JSON_TIMEOUT_MS: "4321",
      OPENAI_STREAM_TIMEOUT_MS: "8765"
    },
    { cwd: directory }
  );

  assert.equal(config.openai?.model, "env-model");
  assert.equal(config.openai?.apiUrl, "https://local.example.com/v1");
  assert.equal(config.openai?.bearerToken, "local-token");
  assert.equal(config.openai?.timeoutMs, 9000);
  assert.equal(config.openai?.jsonTimeoutMs, 4321);
  assert.equal(config.openai?.streamTimeoutMs, 8765);
  assert.equal(config.web_chat?.port, 5501);
  assert.equal(config.agent?.auto_approve, true);
  assert.deepEqual(config.agent?.approvers, ["alice", "bob"]);
});

test("createPersonalAssistantConfigFromEnv loads model provider registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neurocore-pa-models-"));
  const configDirectory = join(directory, ".neurocore", ".personal-assistant");
  await mkdir(configDirectory, { recursive: true });

  await writeFile(
    join(configDirectory, "app.local.json"),
    JSON.stringify({
      db_path: "data/personal-assistant.sqlite",
      tenant_id: "team-local",
      models: {
        default_provider_id: "primary",
        providers: [
          {
            id: "primary",
            provider: "openai-compatible",
            model: "primary-model",
            apiUrl: "https://primary.example.com/v1",
            bearerToken: "primary-token",
            fallback_provider_ids: ["backup"]
          },
          {
            id: "backup",
            provider: "openai-compatible",
            model: "backup-model",
            apiUrl: "https://backup.example.com/v1",
            bearerToken: "backup-token"
          }
        ]
      }
    }),
    "utf8"
  );

  const config = createPersonalAssistantConfigFromEnv({}, { cwd: directory });

  assert.equal(config.openai?.model, "primary-model");
  assert.equal(config.models?.default_provider_id, "primary");
  assert.equal(config.models?.providers.length, 2);
  assert.deepEqual(config.models?.providers[0].fallback_provider_ids, ["backup"]);
});
