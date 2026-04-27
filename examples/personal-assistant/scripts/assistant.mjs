#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPersonalAssistantConfigFromEnv, startPersonalAssistantApp } from "../dist/main.js";

const scriptPath = fileURLToPath(import.meta.url);

export async function runPersonalAssistantCli(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseArgs(argv, env);
  const command = parsed.positionals[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    writeOutput(parsed, helpText());
    return 0;
  }

  if (command === "setup") return setup(parsed);
  if (command === "start") return start(parsed, env);
  if (command === "serve") return serve(parsed, env);
  if (command === "stop") return stop(parsed);
  if (command === "status") return status(parsed);
  if (command === "install-daemon") return installDaemon(parsed);

  throw new Error(`Unknown personal assistant command: ${command}`);
}

if (process.argv[1] === scriptPath) {
  try {
    const code = await runPersonalAssistantCli();
    process.exitCode = code;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function setup(parsed) {
  const layout = resolveLayout(parsed);
  const result = ensureConfig(layout, parsed, parsed.flags.force === true);
  writeOutput(parsed, {
    ok: true,
    action: "setup",
    changed: result.changed,
    home: layout.home,
    app_config_path: layout.appConfigPath,
    db_path: layout.dbPath,
    url: `http://${result.config.web_chat.host}:${result.config.web_chat.port}/`,
    message: result.changed ? "Personal assistant config created." : "Personal assistant config already exists."
  });
  return 0;
}

async function start(parsed, env) {
  const layout = resolveLayout(parsed);
  if (!existsSync(layout.appConfigPath)) {
    ensureConfig(layout, parsed, false);
  }

  const current = readPid(layout.pidPath);
  if (current && isProcessAlive(current)) {
    const health = await readHealth(layout).catch(() => undefined);
    writeOutput(parsed, {
      ok: Boolean(health?.ok),
      action: "start",
      already_running: true,
      pid: current,
      health,
      url: webUrl(layout)
    });
    return 0;
  }

  mkdirSync(layout.runDir, { recursive: true });
  const out = openSync(layout.logPath, "a");
  const child = spawn(process.execPath, [
    scriptPath,
    "serve",
    "--home",
    layout.home
  ], {
    cwd: process.cwd(),
    env: {
      ...env,
      NEUROCORE_HOME: layout.home,
      PERSONAL_ASSISTANT_ALLOW_BOOTSTRAP_REASONER: env.PERSONAL_ASSISTANT_ALLOW_BOOTSTRAP_REASONER ?? "1"
    },
    detached: true,
    stdio: ["ignore", out, out]
  });
  child.unref();
  closeSync(out);
  writeFileSync(layout.pidPath, `${child.pid}\n`);

  const health = await waitForHealth(layout, 6000);
  writeOutput(parsed, {
    ok: true,
    action: "start",
    pid: child.pid,
    health,
    url: webUrl(layout),
    log_path: layout.logPath,
    pid_path: layout.pidPath
  });
  return 0;
}

async function serve(parsed, env) {
  const layout = resolveLayout(parsed);
  const config = createPersonalAssistantConfigFromEnv(env, { cwd: layout.home });
  if (!config.openai && env.PERSONAL_ASSISTANT_ALLOW_BOOTSTRAP_REASONER !== "0") {
    config.reasoner = createBootstrapReasoner();
  }
  config.web_chat = {
    ...(config.web_chat ?? {}),
    enabled: true
  };
  config.feishu = {
    ...(config.feishu ?? {}),
    enabled: false
  };
  mkdirSync(layout.runDir, { recursive: true });
  writeFileSync(layout.pidPath, `${process.pid}\n`);
  const app = await startPersonalAssistantApp(config);
  const shutdown = async () => {
    await app.close();
    rmSync(layout.pidPath, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
  return 0;
}

async function stop(parsed) {
  const layout = resolveLayout(parsed);
  const pid = readPid(layout.pidPath);
  if (!pid) {
    writeOutput(parsed, {
      ok: true,
      action: "stop",
      stopped: false,
      message: "No pid file found."
    });
    return 0;
  }
  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGTERM");
    await waitForExit(pid, 5000);
  }
  rmSync(layout.pidPath, { force: true });
  writeOutput(parsed, {
    ok: true,
    action: "stop",
    stopped: true,
    pid
  });
  return 0;
}

async function status(parsed) {
  const layout = resolveLayout(parsed);
  const pid = readPid(layout.pidPath);
  const running = Boolean(pid && isProcessAlive(pid));
  const health = running ? await readHealth(layout).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  })) : undefined;
  writeOutput(parsed, {
    ok: running && health?.ok === true,
    action: "status",
    running,
    pid,
    health,
    home: layout.home,
    app_config_path: layout.appConfigPath,
    url: webUrl(layout)
  });
  return 0;
}

function installDaemon(parsed) {
  const layout = resolveLayout(parsed);
  const targetPlatform = parsed.values.platform ?? osPlatform();
  mkdirSync(layout.configDir, { recursive: true });
  const nodePath = process.execPath;
  let daemonPath;
  let content;

  if (targetPlatform === "darwin") {
    daemonPath = join(layout.home, "Library", "LaunchAgents", "com.neurocore.personal-assistant.plist");
    content = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\">",
      "<dict>",
      "  <key>Label</key><string>com.neurocore.personal-assistant</string>",
      "  <key>ProgramArguments</key>",
      "  <array>",
      `    <string>${escapeXml(nodePath)}</string>`,
      `    <string>${escapeXml(scriptPath)}</string>`,
      "    <string>serve</string>",
      "    <string>--home</string>",
      `    <string>${escapeXml(layout.home)}</string>`,
      "  </array>",
      "  <key>RunAtLoad</key><true/>",
      "  <key>KeepAlive</key><true/>",
      `  <key>StandardOutPath</key><string>${escapeXml(layout.logPath)}</string>`,
      `  <key>StandardErrorPath</key><string>${escapeXml(layout.logPath)}</string>`,
      "</dict>",
      "</plist>"
    ].join("\n");
  } else {
    daemonPath = join(layout.home, ".config", "systemd", "user", "neurocore-personal-assistant.service");
    content = [
      "[Unit]",
      "Description=NeuroCore Personal Assistant",
      "",
      "[Service]",
      `Environment=NEUROCORE_HOME=${layout.home}`,
      `ExecStart=${nodePath} ${scriptPath} serve --home ${layout.home}`,
      "Restart=always",
      `WorkingDirectory=${process.cwd()}`,
      "",
      "[Install]",
      "WantedBy=default.target"
    ].join("\n");
  }

  mkdirSync(dirname(daemonPath), { recursive: true });
  writeFileSync(daemonPath, `${content}\n`);
  writeOutput(parsed, {
    ok: true,
    action: "install-daemon",
    platform: targetPlatform,
    daemon_path: daemonPath
  });
  return 0;
}

function resolveLayout(parsed) {
  const home = resolve(parsed.values.home ?? process.env.NEUROCORE_HOME ?? process.env.HOME ?? homedir());
  const root = join(home, ".neurocore");
  const configDir = join(root, ".personal-assistant");
  return {
    home,
    root,
    configDir,
    runDir: configDir,
    appConfigPath: join(configDir, "app.local.json"),
    dbPath: join(root, "personal-assistant.sqlite"),
    pidPath: join(configDir, "assistant.pid"),
    logPath: join(configDir, "assistant.log")
  };
}

function ensureConfig(layout, parsed, force) {
  mkdirSync(layout.configDir, { recursive: true });
  mkdirSync(dirname(layout.dbPath), { recursive: true });
  if (existsSync(layout.appConfigPath) && !force) {
    return {
      changed: false,
      config: readAppConfig(layout)
    };
  }
  const config = {
    db_path: layout.dbPath,
    tenant_id: parsed.values.tenant ?? "local",
    agent: {
      id: "personal-assistant",
      name: "NeuroCore Assistant",
      auto_approve: false,
      required_approval_tools: ["email_send"]
    },
    web_chat: {
      enabled: true,
      host: parsed.values.host ?? "127.0.0.1",
      port: parsePort(parsed.values.port ?? "3301"),
      path: parsed.values.path ?? "/chat"
    },
    feishu: {
      enabled: false
    },
    proactive: {
      enabled: true
    }
  };
  writeJson(layout.appConfigPath, config);
  return {
    changed: true,
    config
  };
}

function parseArgs(argv, env) {
  const positionals = [];
  const flags = {};
  const values = {
    home: env.NEUROCORE_HOME
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      flags.json = true;
      continue;
    }
    if (arg === "--force") {
      flags.force = true;
      continue;
    }
    if (arg.startsWith("--")) {
      values[arg.slice(2)] = argv[++index];
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags, values };
}

async function waitForHealth(layout, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const health = await readHealth(layout);
      if (health.ok) return health;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError ?? new Error("Timed out waiting for personal assistant health.");
}

async function readHealth(layout) {
  const response = await fetch(`${webUrl(layout)}health`);
  return await response.json();
}

function webUrl(layout) {
  const config = readAppConfig(layout);
  const host = config.web_chat?.host ?? "127.0.0.1";
  const port = config.web_chat?.port ?? 3301;
  return `http://${host}:${port}/`;
}

function readAppConfig(layout) {
  if (!existsSync(layout.appConfigPath)) {
    return {};
  }
  return JSON.parse(readFileSync(layout.appConfigPath, "utf8"));
}

function readPid(pidPath) {
  if (!existsSync(pidPath)) return undefined;
  const value = Number(readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(100);
  }
}

function createBootstrapReasoner() {
  return {
    name: "personal-assistant-bootstrap-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "bootstrap-reasoner",
        proposal_type: "plan",
        salience_score: 0.8,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "Bootstrap local assistant response." }
      }];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Bootstrap response",
        description: `Personal assistant is running. Input received: ${input}`,
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function writeOutput(parsed, value) {
  if (parsed.flags.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(formatPlainOutput(value));
}

function formatPlainOutput(value) {
  return Object.entries(value)
    .map(([key, nested]) => `${key}: ${typeof nested === "object" ? JSON.stringify(nested) : String(nested)}`)
    .join("\n");
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function helpText() {
  return [
    "Usage:",
    "  neurocore assistant setup [--home <dir>] [--port <port>] [--force] [--json]",
    "  neurocore assistant start [--home <dir>] [--json]",
    "  neurocore assistant stop [--home <dir>] [--json]",
    "  neurocore assistant status [--home <dir>] [--json]",
    "  neurocore assistant install-daemon [--home <dir>] [--platform darwin|linux] [--json]",
    "  neurocore assistant serve [--home <dir>]"
  ].join("\n");
}
