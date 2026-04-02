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
        approvers: ["owner"]
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
      timeoutMs: 1234
    }),
    "utf8"
  );

  const config = createPersonalAssistantConfigFromEnv({}, { cwd: directory });

  assert.equal(config.db_path, "data/personal-assistant.sqlite");
  assert.equal(config.tenant_id, "team-local");
  assert.equal(config.agent?.name, "Team Assistant");
  assert.deepEqual(config.agent?.approvers, ["owner"]);
  assert.equal(config.openai?.model, "pa-local-model");
  assert.equal(config.openai?.apiUrl, "https://pa.example.com/v1");
  assert.equal(config.openai?.bearerToken, "pa-local-token");
  assert.equal(config.openai?.timeoutMs, 1234);
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
      bearerToken: "root-token"
    }),
    "utf8"
  );

  const config = createPersonalAssistantConfigFromEnv({}, { cwd: directory });

  assert.equal(config.openai?.model, "root-model");
  assert.equal(config.openai?.apiUrl, "https://root.example.com/v1");
  assert.equal(config.openai?.bearerToken, "root-token");
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
      PERSONAL_ASSISTANT_APPROVERS: "alice,bob"
    },
    { cwd: directory }
  );

  assert.equal(config.openai?.model, "env-model");
  assert.equal(config.openai?.apiUrl, "https://local.example.com/v1");
  assert.equal(config.openai?.bearerToken, "local-token");
  assert.equal(config.openai?.timeoutMs, 9000);
  assert.equal(config.web_chat?.port, 5501);
  assert.deepEqual(config.agent?.approvers, ["alice", "bob"]);
});
