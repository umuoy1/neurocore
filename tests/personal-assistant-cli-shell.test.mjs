import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("personal assistant chat shell handles multiline input, status stream and slash completion", { concurrency: false, timeout: 20000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "neurocore-pa-cli-shell-"));

  try {
    const output = await runChatShell(home, [
      "\"\"\"",
      "first line",
      "second line",
      "\"\"\"",
      "/status",
      "/exit",
      ""
    ].join("\n"));

    assert.match(output.stdout, /Personal assistant is running\. Input received: first line[\s\S]*second line/);
    assert.match(output.stdout, /\[status\] memory_retrieval started/);
    assert.match(output.stdout, /\[status\] response_generation completed/);
    assert.match(output.stdout, /session_id: ses_/);

    const completions = await runAssistantJson(["chat", "--home", home, "--complete", "/st", "--json"]);
    assert.deepEqual(completions.completions, ["/status", "/stop"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("personal assistant chat shell handles ctrl-c interrupt in a pseudo terminal", { concurrency: false, timeout: 20000 }, async (t) => {
  const scriptPath = await commandPath("script");
  if (!scriptPath) {
    t.skip("script command is unavailable for pseudo-terminal coverage");
    return;
  }

  const home = mkdtempSync(join(tmpdir(), "neurocore-pa-cli-pty-"));
  try {
    const command = pseudoTerminalCommand(home);
    const output = await execShell(command);
    assert.match(output, /\[interrupt\] input cancelled/);
    assert.match(output, /No active conversation is mapped to this chat/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function runChatShell(home, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "scripts/neurocore.mjs",
      "assistant",
      "chat",
      "--home",
      home,
      "--no-banner"
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PERSONAL_ASSISTANT_ALLOW_BOOTSTRAP_REASONER: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`chat shell exited with ${code}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function runAssistantJson(args) {
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

function commandPath(command) {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", `command -v ${quote(command)}`], (error, stdout) => {
      resolve(error ? undefined : stdout.trim());
    });
  });
}

function execShell(command) {
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PERSONAL_ASSISTANT_ALLOW_BOOTSTRAP_REASONER: "1"
      },
      timeout: 10000
    }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (error) {
        error.output = output;
        reject(error);
        return;
      }
      resolve(output);
    });
  });
}

function pseudoTerminalCommand(home) {
  const nodeCommand = [
    quote(process.execPath),
    "scripts/neurocore.mjs",
    "assistant",
    "chat",
    "--home",
    quote(home),
    "--no-banner"
  ].join(" ");
  const input = "{ sleep 0.5; printf '\\003'; sleep 0.2; printf '/status\\n/exit\\n'; }";
  const scriptCommand = process.platform === "darwin"
    ? `script -q /dev/null ${nodeCommand}`
    : `script -q -c ${quote(nodeCommand)} /dev/null`;
  return `${input} | ${scriptCommand}`;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
