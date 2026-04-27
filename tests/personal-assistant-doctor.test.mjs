import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

test("personal assistant doctor detects config, provider, port, sqlite, policy and channel risks", { concurrency: false }, async () => {
  const home = await mkdtemp(join(tmpdir(), "neurocore-pa-doctor-"));
  const portServer = createHttpServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, platform: "not-assistant" }));
  });
  const port = await listen(portServer);
  const blockedParent = join(home, "not-a-directory");
  const configPath = join(home, ".neurocore", ".personal-assistant", "app.local.json");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(blockedParent, "file");
  writeFileSync(configPath, `${JSON.stringify({
    db_path: join(blockedParent, "assistant.sqlite"),
    tenant_id: "doctor-test",
    agent: {
      auto_approve: true
    },
    web_chat: {
      enabled: true,
      host: "127.0.0.1",
      port,
      path: "/chat"
    },
    telegram: {
      enabled: true,
      bot_token: "redacted-test-token",
      allowed_senders: []
    },
    openai: {
      apiUrl: "https://example.test/v1",
      model: "test-model",
      timeoutMs: 1000,
      jsonTimeoutMs: 90000,
      streamTimeoutMs: 2000
    }
  }, null, 2)}\n`);

  try {
    const report = await runAssistant(["doctor", "--home", home, "--json"], { allowFailure: true });
    assert.equal(report.action, "doctor");
    assert.equal(report.ok, false);
    assertHasFailedCheck(report, "model_config_present");
    assertHasFailedCheck(report, "provider_timeout_config");
    assertHasFailedCheck(report, "sqlite_path_writable");
    assertHasFailedCheck(report, "web_chat_port_available");
    assertHasFailedCheck(report, "approval_policy_safe");
    assertHasFailedCheck(report, "telegram_allowlist");
  } finally {
    await new Promise((resolve) => portServer.close(resolve));
    rmSync(home, { recursive: true, force: true });
  }
});

test("personal assistant config dry-run emits redacted resolved config", async () => {
  const home = await mkdtemp(join(tmpdir(), "neurocore-pa-config-dry-run-"));
  const port = await getAvailablePort();

  try {
    await runAssistant(["setup", "--home", home, "--port", String(port), "--json"]);
    const dryRun = await runAssistant(["config", "--dry-run", "--home", home, "--json"], {
      env: {
        OPENAI_API_KEY: "sk-test-secret",
        OPENAI_BASE_URL: "https://example.test/v1",
        OPENAI_MODEL: "test-model"
      }
    });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.resolved_config.openai.bearerToken, "[redacted]");
    assert.equal(dryRun.resolved_config.openai.model, "test-model");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function assertHasFailedCheck(report, code) {
  const check = report.checks.find((item) => item.code === code);
  assert.ok(check, `missing check ${code}`);
  assert.equal(check.status, "fail", `${code} should fail`);
}

function runAssistant(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/neurocore.mjs", "assistant", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      timeout: 10000
    }, (error, stdout, stderr) => {
      if (error && !options.allowFailure) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(new Error(`Failed to parse assistant output: ${stdout}\n${stderr}\n${parseError.message}`));
      }
    });
  });
}

async function listen(server) {
  return await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate local port."));
        return;
      }
      resolve(address.port);
    });
    server.on("error", reject);
  });
}

async function getAvailablePort() {
  const server = createNetServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}
