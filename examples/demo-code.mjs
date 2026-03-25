/**
 * NeuroCore "code agent" demo — read/list/search the workspace, propose edits and shell commands.
 * High side-effect tools (write_file, run_shell_command) require in-terminal approval (like Claude Code-style gating).
 *
 * Usage:
 *   npm run demo:code -- [workspace_dir]
 *   NEUROCORE_CODE_ROOT=/path/to/repo npm run demo:code
 *
 * Env: NEUROCORE_DEBUG=1 for verbose [neurocore] logs (optional).
 */

import { defineAgent } from "@neurocore/sdk-core";
import {
  loadOpenAICompatibleConfig,
  OpenAICompatibleReasoner
} from "@neurocore/sdk-node";
import { exec } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workspaceRoot = resolveWorkspaceRoot();

const config = await loadOpenAICompatibleConfig();
const reasoner = new OpenAICompatibleReasoner(config);

const agent = defineAgent({
  id: "code-demo-agent",
  role: `You are a coding agent working inside a single workspace on disk.
You have tools to list files, read files, search text, write UTF-8 files, and run shell commands.
Rules:
- Prefer tools over guessing file contents or directory layout.
- Keep paths relative to the workspace root (use forward slashes). Do not path-escape the sandbox.
- For non-trivial questions, inspect files before answering.
- After write_file or run_shell_command is approved and returns, synthesize a concise answer for the user.
- If the user asks for destructive operations, explain risks; only use tools when appropriate.
- Prefer answering in Chinese when the user asks in Chinese.`
})
  .configureRuntime({
    max_cycles: 20,
    tool_execution: {
      timeout_ms: 120_000,
      max_retries: 0
    }
  })
  .useReasoner(reasoner)
  .registerTool(createListWorkspaceFilesTool(workspaceRoot))
  .registerTool(createReadWorkspaceFileTool(workspaceRoot))
  .registerTool(createSearchWorkspaceTool(workspaceRoot))
  .registerTool(createWriteWorkspaceFileTool(workspaceRoot))
  .registerTool(createRunShellCommandTool(workspaceRoot));

const rl = createInterface({ input, output });

console.log("[demo-code] NeuroCore code-agent demo");
console.log("[demo-code] Workspace:", workspaceRoot);
console.log("[demo-code] Model:", config.model);
console.log("[demo-code] Commands: /help /tools /new /exit");

printHelp();

/** @type {import("@neurocore/sdk-core").AgentSessionHandle | null} */
let session = null;

try {
  if (input.isTTY) {
    while (true) {
      const line = (await rl.question("\ncode> ")).trim();
      const shouldContinue = await handleLine(line);
      if (!shouldContinue) {
        break;
      }
    }
  } else {
    for await (const rawLine of rl) {
      const shouldContinue = await handleLine(rawLine.trim());
      if (!shouldContinue) {
        break;
      }
    }
  }
} finally {
  rl.close();
}

console.log("[demo-code] Goodbye.");

function resolveWorkspaceRoot() {
  const fromEnv = process.env.NEUROCORE_CODE_ROOT?.trim();
  const fromArg = process.argv[2]?.trim();
  const raw = fromEnv || fromArg || process.cwd();
  return resolve(raw);
}

function printHelp() {
  console.log("\n[help]");
  console.log("Multi-turn session: follow-up messages keep context until /new.");
  console.log("High-risk tools (write, shell) pause for y/n approval.");
  console.log("Examples:");
  console.log("- Summarize packages/runtime-core/src/runtime/agent-runtime.ts");
  console.log("- Find where runUntilSettled is defined");
  console.log("- Add a one-line comment at the top of package.json (will ask approval)");
  console.log("- 列出目录下文件");
}

function printTools() {
  console.log("\n[tools]");
  console.log("- list_workspace_files(path?)");
  console.log("- read_workspace_file(path)");
  console.log("- search_workspace(query, path?)");
  console.log("- write_workspace_file(path, content)  [requires approval]");
  console.log("- run_shell_command(command)  [requires approval, cwd=workspace]");
}

/**
 * @param {import("@neurocore/sdk-core").AgentSessionHandle} s
 * @param {() => Promise<import("@neurocore/runtime-core").AgentRunLoopResult>} startRun
 */
async function runUntilSettledWithApprovals(s, startRun) {
  let result = await startRun();
  // After approve()+resume(), another high-risk tool may escalate again in the same settle loop.
  while (s.getPendingApproval()) {
    const pending = s.getPendingApproval();
    console.log("\n[approval required]");
    console.log("Reason:", pending.review_reason);
    console.log("Tool:", pending.action?.tool_name);
    console.log("Args:", JSON.stringify(pending.action?.tool_args ?? {}, null, 2));
    const ans = (await rl.question("Approve execution? [y/N] ")).trim().toLowerCase();
    if (ans === "y" || ans === "yes") {
      await s.approve({ approver_id: "code-demo-user", comment: "approved in demo-code CLI" });
      result = await s.resume();
    } else {
      await s.reject({ approver_id: "code-demo-user", comment: "rejected in demo-code CLI" });
      console.log("[demo-code] Approval rejected; stopping this turn.");
      break;
    }
  }
  return result;
}

async function handleLine(line) {
  if (!line) {
    return true;
  }

  if (line === "/exit" || line === "/quit") {
    return false;
  }
  if (line === "/help") {
    printHelp();
    return true;
  }
  if (line === "/tools") {
    printTools();
    return true;
  }
  if (line === "/new") {
    session = null;
    console.log("[demo-code] New session — context cleared.");
    return true;
  }

  if (!session) {
    session = agent.createSession({
      agent_id: "code-demo-agent",
      tenant_id: "local",
      initial_input: {
        input_id: `inp_${Date.now()}`,
        content: line,
        created_at: new Date().toISOString(),
        metadata: {
          workspaceRoot,
          demo: "code"
        }
      }
    });
    console.log("[demo-code] Session", session.id);
    const result = await runUntilSettledWithApprovals(session, () => session.run());
    printTurnResult(result);
    return true;
  }

  const result = await runUntilSettledWithApprovals(session, () => session.runText(line));
  printTurnResult(result);
  return true;
}

/** @param {import("@neurocore/runtime-core").AgentRunLoopResult} result */
function printTurnResult(result) {
  console.log(`\n--- assistant (state: ${result.finalState}) ---`);
  console.log(result.outputText ?? "(no output)");

  const toolSteps = result.steps.filter(
    (step) => step.selectedAction?.action_type === "call_tool" && step.observation
  );
  if (toolSteps.length > 0) {
    console.log("\n--- tool trace ---");
    for (const step of toolSteps) {
      const name = step.selectedAction?.tool_name ?? "?";
      const summary = step.observation?.summary ?? "";
      console.log(`• ${name}: ${summary.slice(0, 500)}${summary.length > 500 ? "…" : ""}`);
    }
  }
}

function createListWorkspaceFilesTool(rootDir) {
  return {
    name: "list_workspace_files",
    description:
      "List files and directories under a path relative to the workspace root. Use '.' for the root.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path; default '.'" }
      }
    },
    async invoke(inputValue) {
      const requestedPath =
        typeof inputValue.path === "string" && inputValue.path.trim() ? inputValue.path.trim() : ".";
      const target = resolveUnderRoot(rootDir, requestedPath);
      const dirEntries = await readdir(target, { withFileTypes: true });
      const entries = dirEntries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          path: toPosixPath(relative(rootDir, resolve(target, entry.name)))
        }));

      return {
        summary:
          entries.length === 0
            ? `Empty directory: ${requestedPath}`
            : `Listed ${entries.length} entries under ${requestedPath}.`,
        payload: { entries }
      };
    }
  };
}

function createReadWorkspaceFileTool(rootDir) {
  return {
    name: "read_workspace_file",
    description: "Read a UTF-8 text file relative to the workspace root.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_chars: { type: "number", description: "Optional cap; default 120000" }
      },
      required: ["path"]
    },
    async invoke(inputValue) {
      if (typeof inputValue.path !== "string" || !inputValue.path.trim()) {
        throw new Error("read_workspace_file requires path.");
      }
      const maxChars =
        typeof inputValue.max_chars === "number" && inputValue.max_chars > 0
          ? Math.min(inputValue.max_chars, 500_000)
          : 120_000;
      const target = resolveUnderRoot(rootDir, inputValue.path.trim());
      const st = await stat(target);
      if (!st.isFile()) {
        throw new Error(`Not a file: ${inputValue.path}`);
      }
      const content = await readFile(target, "utf8");
      const truncated = content.length > maxChars;
      const body = truncated ? `${content.slice(0, maxChars)}\n\n...[truncated]` : content;
      return {
        summary: `Read ${toPosixPath(relative(rootDir, target))} (${content.length} chars${truncated ? ", truncated" : ""}).`,
        payload: { path: toPosixPath(relative(rootDir, target)), content: body, truncated }
      };
    }
  };
}

function createSearchWorkspaceTool(rootDir) {
  return {
    name: "search_workspace",
    description:
      "Search for a literal substring (case-insensitive) in text files under a relative path.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string", description: "Relative directory or file; default '.'" }
      },
      required: ["query"]
    },
    async invoke(inputValue) {
      if (typeof inputValue.query !== "string" || !inputValue.query.trim()) {
        throw new Error("search_workspace requires query.");
      }
      const query = inputValue.query.trim().toLowerCase();
      const requestedPath =
        typeof inputValue.path === "string" && inputValue.path.trim() ? inputValue.path.trim() : ".";
      const target = resolveUnderRoot(rootDir, requestedPath);
      const files = await collectTextFiles(target);
      const matches = [];

      for (const filePath of files) {
        const content = await readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((text, index) => {
          if (text.toLowerCase().includes(query)) {
            matches.push({
              path: toPosixPath(relative(rootDir, filePath)),
              line: index + 1,
              snippet: text.trim()
            });
          }
        });
      }

      return {
        summary:
          matches.length === 0
            ? `No matches for "${inputValue.query}".`
            : `Found ${matches.length} line(s) matching "${inputValue.query}".`,
        payload: { matches: matches.slice(0, 40) }
      };
    }
  };
}

function createWriteWorkspaceFileTool(rootDir) {
  return {
    name: "write_workspace_file",
    description:
      "Create or overwrite a UTF-8 file relative to the workspace root. Creates parent directories. Requires human approval before execution.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    },
    async invoke(inputValue) {
      if (typeof inputValue.path !== "string" || !inputValue.path.trim()) {
        throw new Error("write_workspace_file requires path.");
      }
      if (typeof inputValue.content !== "string") {
        throw new Error("write_workspace_file requires content string.");
      }
      const target = resolveUnderRoot(rootDir, inputValue.path.trim());
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, inputValue.content, "utf8");
      return {
        summary: `Wrote ${toPosixPath(relative(rootDir, target))} (${inputValue.content.length} bytes).`,
        payload: { path: toPosixPath(relative(rootDir, target)), bytes: inputValue.content.length }
      };
    }
  };
}

function createRunShellCommandTool(rootDir) {
  return {
    name: "run_shell_command",
    description:
      "Run a shell command with cwd set to the workspace root. Stdout/stderr are captured; timeout applies. Requires human approval.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number", description: "Optional; default 60000, max 120000" }
      },
      required: ["command"]
    },
    async invoke(inputValue) {
      if (typeof inputValue.command !== "string" || !inputValue.command.trim()) {
        throw new Error("run_shell_command requires non-empty command.");
      }
      const timeoutMs = Math.min(
        120_000,
        Math.max(
          1000,
          typeof inputValue.timeout_ms === "number" && inputValue.timeout_ms > 0
            ? inputValue.timeout_ms
            : 60_000
        )
      );
      const maxBuffer = 400_000;
      try {
        const { stdout, stderr } = await execAsync(inputValue.command, {
          cwd: rootDir,
          timeout: timeoutMs,
          maxBuffer
        });
        const out = [stdout, stderr].filter(Boolean).join("\n");
        const clipped = out.length > 32_000 ? `${out.slice(0, 32_000)}\n...[clipped]` : out;
        return {
          summary: `Exit 0. Output ${out.length} chars.`,
          payload: { exitCode: 0, output: clipped }
        };
      } catch (error) {
        const code = error.code ?? "error";
        const stdout = typeof error.stdout === "string" ? error.stdout : "";
        const stderr = typeof error.stderr === "string" ? error.stderr : "";
        const out = [stdout, stderr, error.message].filter(Boolean).join("\n");
        const clipped = out.length > 32_000 ? `${out.slice(0, 32_000)}\n...[clipped]` : out;
        return {
          summary: `Command finished with non-zero status (${String(code)}).`,
          payload: { exitCode: code, output: clipped }
        };
      }
    }
  };
}

function resolveUnderRoot(rootDir, requestedPath) {
  const normalizedInput =
    requestedPath === "/" ? "." : requestedPath.replace(/^\/+/, "") || ".";
  const resolved = resolve(rootDir, normalizedInput);
  const rel = relative(rootDir, resolved);
  if (rel.startsWith("..") || rel.includes(`${sep}..`)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }
  if (!resolved.startsWith(rootDir)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }
  return resolved;
}

function toPosixPath(p) {
  return p.split(sep).join("/");
}

async function collectTextFiles(startPath) {
  const st = await stat(startPath);
  if (st.isFile()) {
    return isProbablyText(startPath) ? [startPath] : [];
  }

  const out = [];
  const dirEntries = await readdir(startPath, { withFileTypes: true });
  for (const entry of dirEntries) {
    const full = resolve(startPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      out.push(...(await collectTextFiles(full)));
    } else if (entry.isFile() && isProbablyText(full)) {
      out.push(full);
    }
  }
  return out.sort();
}

function isProbablyText(filePath) {
  const skip = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|wasm|so|dylib|dll|exe|bin)$/i;
  return !skip.test(filePath);
}
