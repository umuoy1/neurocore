import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("personal assistant setup start status stop and daemon install work in a temporary home", { concurrency: false, timeout: 30000 }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "neurocore-pa-onboarding-"));
  const port = await getAvailablePort();

  try {
    const setup = await runAssistant(["setup", "--home", home, "--port", String(port), "--json"]);
    assert.equal(setup.ok, true);
    assert.equal(setup.action, "setup");
    assert.equal(setup.changed, true);
    assert.ok(existsSync(setup.app_config_path));

    const start = await runAssistant(["start", "--home", home, "--json"]);
    assert.equal(start.ok, true);
    assert.equal(start.action, "start");
    assert.equal(start.health.ok, true);
    assert.equal(typeof start.pid, "number");

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      platform: "web",
      path: "/chat"
    });

    const status = await runAssistant(["status", "--home", home, "--json"]);
    assert.equal(status.running, true);
    assert.equal(status.health.ok, true);

    const stop = await runAssistant(["stop", "--home", home, "--json"]);
    assert.equal(stop.ok, true);
    assert.equal(stop.stopped, true);

    rmSync(join(home, ".neurocore", ".personal-assistant", "app.local.json"), { force: true });
    const rerun = await runAssistant(["setup", "--home", home, "--port", String(port), "--json"]);
    assert.equal(rerun.changed, true);

    const launchd = await runAssistant(["install-daemon", "--home", home, "--platform", "darwin", "--json"]);
    assert.equal(launchd.ok, true);
    assert.match(launchd.daemon_path, /LaunchAgents/);
    assert.ok(existsSync(launchd.daemon_path));

    const systemd = await runAssistant(["install-daemon", "--home", home, "--platform", "linux", "--json"]);
    assert.equal(systemd.ok, true);
    assert.match(systemd.daemon_path, /systemd\/user/);
    assert.ok(existsSync(systemd.daemon_path));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      t.skip("Local port binding is not permitted in this environment.");
      return;
    }
    throw error;
  } finally {
    await runAssistant(["stop", "--home", home, "--json"]).catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
});

test("personal assistant start can bootstrap setup when config is missing", { concurrency: false, timeout: 30000 }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "neurocore-pa-start-bootstrap-"));
  const port = await getAvailablePort();

  try {
    const start = await runAssistant(["start", "--home", home, "--port", String(port), "--json"]);
    assert.equal(start.ok, true);
    assert.equal(start.action, "start");
    assert.equal(start.health.ok, true);
    assert.ok(existsSync(join(home, ".neurocore", ".personal-assistant", "app.local.json")));

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      t.skip("Local port binding is not permitted in this environment.");
      return;
    }
    throw error;
  } finally {
    await runAssistant(["stop", "--home", home, "--json"]).catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
});

function runAssistant(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/neurocore.mjs", "assistant", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PERSONAL_ASSISTANT_ALLOW_BOOTSTRAP_REASONER: "1"
      },
      timeout: 10000
    }, (error, stdout, stderr) => {
      if (error) {
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

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate local port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}
