process.env.NEUROCORE_DEBUG ??= "1";

import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { defineAgent } from "@neurocore/sdk-core";
import {
  loadOpenAICompatibleConfig,
  OpenAICompatibleReasoner
} from "@neurocore/sdk-node";

const WORKSPACE_MAX_DEPTH = 4;
const WORKSPACE_MAX_ENTRIES = 200;
const FILE_READ_CHAR_LIMIT = 16_000;
const COMMAND_OUTPUT_CHAR_LIMIT = 20_000;
const SEARCH_HIT_LIMIT = 50;
const PREVIEW_CHAR_LIMIT = 20_000;
const IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  "coverage",
  "dist",
  "node_modules"
]);
const AT_REFERENCE_PATTERN = /(^|\s)@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
const USER_APPROVER_ID = "cli-user";

const workspaceRoot = await realpath(process.cwd());
let workspaceBootstrap = await renderWorkspaceTree(workspaceRoot, {
  maxDepth: WORKSPACE_MAX_DEPTH,
  maxEntries: WORKSPACE_MAX_ENTRIES,
  label: basename(workspaceRoot) || workspaceRoot
});

const config = await loadOpenAICompatibleConfig();
const agent = defineAgent({
  id: "claude-code-cli-agent",
  role: [
    "Interactive coding agent running inside a local terminal REPL.",
    "You are operating on the current workspace and must use tools to inspect files before making claims about code.",
    "Prefer the smallest next tool call that advances the task.",
    "Always use ask_user for user-facing replies so the session remains resumable across turns.",
    "Never use respond or complete for normal conversation in this CLI.",
    "Use list_files to discover paths, read_file to inspect files, search_text to find symbols, write_file to modify files, and run_command to verify behavior.",
    "write_file and run_command require approval; plan them carefully and keep arguments explicit.",
    "If the user referenced @paths, their content may already be embedded in the current input. Re-read with tools only if you need fresher or broader context.",
    "When a task is done, summarize the outcome and any follow-up in ask_user."
  ].join(" ")
})
  .useReasoner(createInteractiveCodingReasoner(config))
  .configureRuntime({
    max_cycles: 12,
    default_sync_timeout_ms: 60_000
  })
  .registerTool(createListFilesTool(workspaceRoot))
  .registerTool(createReadFileTool(workspaceRoot))
  .registerTool(createSearchTextTool(workspaceRoot))
  .registerTool(createWriteFileTool(workspaceRoot))
  .registerTool(createRunCommandTool(workspaceRoot));

const scriptedInputs = input.isTTY ? null : await collectScriptedInputs();
const rl = input.isTTY ? createInterface({ input, output }) : null;
const transcript = [];
let session = null;

console.log("[claude-code] NeuroCore coding CLI");
console.log("[claude-code] Workspace:", workspaceRoot);
console.log("[claude-code] Model:", config.model);
console.log("[claude-code] Commands: /help /tools /files /reset /exit");

try {
  printHelp();

  if (input.isTTY) {
    while (true) {
      const line = (await rl.question("\nclaude-code> ")).trim();
      const shouldContinue = await handleLine(line);
      if (!shouldContinue) {
        break;
      }
    }
  } else {
    while (scriptedInputs.length > 0) {
      const shouldContinue = await handleLine((scriptedInputs.shift() ?? "").trim());
      if (!shouldContinue) {
        break;
      }
    }
  }
} finally {
  rl?.close();
  session?.cleanup?.({ force: true });
}

function printHelp() {
  console.log("\n[help]");
  console.log("Ask for codebase analysis, bug fixes, or feature work in the current directory.");
  console.log("Use @path to inline a file or directory tree into the current turn.");
  console.log("Examples:");
  console.log("- 这个项目是做什么的");
  console.log("- @package.json 说明这个仓库当前的入口和脚本");
  console.log("- 运行测试，修复失败，然后再跑一遍");
  console.log("- 在 src/foo.js 增加一个 hello 方法");
}

function printTools() {
  console.log("\n[tools]");
  console.log("- list_files(path='.', max_depth=3)");
  console.log("- read_file(path)");
  console.log("- search_text(query, path='.')");
  console.log("- write_file(path, content)");
  console.log("- run_command(command, cwd='.', timeout_ms=60000)");
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

  if (line === "/files") {
    workspaceBootstrap = await renderWorkspaceTree(workspaceRoot, {
      maxDepth: WORKSPACE_MAX_DEPTH,
      maxEntries: WORKSPACE_MAX_ENTRIES,
      label: basename(workspaceRoot) || workspaceRoot
    });
    console.log(`\n${workspaceBootstrap}`);
    return true;
  }

  if (line === "/reset") {
    resetSession();
    console.log("[claude-code] Session reset");
    return true;
  }

  const turnContext = await buildTurnContext(line, {
    includeBootstrap: session === null,
    workspaceBootstrap,
    workspaceRoot,
    transcript
  });
  transcript.push({ role: "user", content: line });

  if (!session) {
    session = agent.createSession({
      agent_id: "claude-code-cli-agent",
      tenant_id: "local",
      initial_input: createUserInput(turnContext.content, turnContext.metadata)
    });
    console.log("[claude-code] Session created", { sessionId: session.id });
    const result = await session.run();
    await handleRunResult(result);
    return true;
  }

  const result = await session.resume(createUserInput(turnContext.content, turnContext.metadata));
  await handleRunResult(result);
  return true;
}

async function handleRunResult(runResult) {
  let current = runResult;

  while (true) {
    if (needsToolContinuation(current)) {
      current = await session.resume();
      continue;
    }

    if (current.finalState === "escalated") {
      const approval = session.getPendingApproval();
      if (!approval) {
        throw new Error(`Session ${session.id} is escalated but no pending approval was found.`);
      }

      await printApprovalPreview(approval);
      const approved = await askYesNo("Approve this action? [y/N] ");
      if (!approved) {
        await session.reject({
          approver_id: USER_APPROVER_ID,
          comment: "Rejected in CLI"
        });
        console.log("[approval] Rejected");
        return;
      }

      console.log("[approval] Approved, executing...");
      const decision = await session.approve({
        approver_id: USER_APPROVER_ID,
        comment: "Approved in CLI"
      });

      if (!decision.run) {
        return;
      }

      workspaceBootstrap = await renderWorkspaceTree(workspaceRoot, {
        maxDepth: WORKSPACE_MAX_DEPTH,
        maxEntries: WORKSPACE_MAX_ENTRIES,
        label: basename(workspaceRoot) || workspaceRoot
      });
      current = await session.resume();
      continue;
    }

    const message = sanitizeAssistantOutput(current.outputText);
    if (message) {
      console.log(`\nassistant\n${message}`);
      transcript.push({ role: "assistant", content: message });
    }

    if (current.finalState === "failed" || current.finalState === "aborted" || current.finalState === "completed") {
      resetSession();
    }
    return;
  }
}

function resetSession() {
  if (session) {
    try {
      session.cleanup({ force: true });
    } catch {
      // Ignore cleanup conflicts during CLI reset.
    }
  }
  session = null;
}

function createInteractiveCodingReasoner(config) {
  const base = new OpenAICompatibleReasoner(config);
  return {
    name: "interactive-coding-reasoner",
    plan(ctx) {
      return base.plan(ctx);
    },
    async respond(ctx) {
      const actions = await base.respond(ctx);
      return actions.map((action) => {
        if (action.action_type === "respond" || action.action_type === "complete") {
          return {
            ...action,
            action_type: "ask_user",
            title: action.title || "Reply to user",
            side_effect_level: "none"
          };
        }
        return action;
      });
    }
  };
}

function createUserInput(content, metadata) {
  return {
    input_id: `inp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    content,
    created_at: new Date().toISOString(),
    metadata
  };
}

async function buildTurnContext(line, options) {
  const expanded = await expandAtReferences(line, options.workspaceRoot);
  const sections = [
    "You are running inside a local coding CLI.",
    `Workspace root: ${options.workspaceRoot}`,
    "",
    "[User request]",
    line
  ];

  if (options.includeBootstrap) {
    sections.push("");
    sections.push("[Startup workspace tree]");
    sections.push(options.workspaceBootstrap);
  }

  const recentTranscript = formatTranscript(options.transcript);
  if (recentTranscript) {
    sections.push("");
    sections.push("[Recent conversation]");
    sections.push(recentTranscript);
  }

  if (expanded.blocks.length > 0) {
    sections.push("");
    sections.push("[Expanded @ references]");
    sections.push(expanded.blocks.join("\n\n"));
  }

  if (expanded.warnings.length > 0) {
    sections.push("");
    sections.push("[Reference warnings]");
    sections.push(expanded.warnings.join("\n"));
  }

  return {
    content: sections.join("\n"),
    metadata: {
      cliMode: true,
      workspaceRoot: options.workspaceRoot,
      referencedPaths: expanded.referencedPaths
    }
  };
}

function formatTranscript(transcriptEntries) {
  if (!Array.isArray(transcriptEntries) || transcriptEntries.length === 0) {
    return "";
  }

  const recent = transcriptEntries.slice(-12);
  return recent
    .map((entry) => `${entry.role === "assistant" ? "assistant" : "user"}: ${entry.content}`)
    .join("\n");
}

async function expandAtReferences(line, rootDir) {
  const referencedPaths = [];
  const warnings = [];
  const blocks = [];
  const seen = new Set();

  for (const match of line.matchAll(AT_REFERENCE_PATTERN)) {
    const rawPath = match[2] || match[3] || match[4];
    if (!rawPath || seen.has(rawPath)) {
      continue;
    }
    seen.add(rawPath);

    try {
      const absolutePath = resolveWorkspacePath(rootDir, rawPath);
      const stats = await stat(absolutePath);
      const relativePath = normalizeRelativePath(relative(rootDir, absolutePath));
      referencedPaths.push(relativePath);

      if (stats.isDirectory()) {
        const tree = await renderWorkspaceTree(absolutePath, {
          maxDepth: 3,
          maxEntries: 80,
          rootDir,
          label: relativePath
        });
        blocks.push(`[Directory @${relativePath}]\n${tree}`);
        continue;
      }

      const content = await readTextPreview(absolutePath, FILE_READ_CHAR_LIMIT);
      blocks.push([
        `[File @${relativePath}]`,
        "```text",
        content.text,
        content.truncated ? "\n...[truncated]" : "",
        "```"
      ].join("\n"));
    } catch (error) {
      warnings.push(`@${rawPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    referencedPaths,
    warnings,
    blocks
  };
}

function createListFilesTool(rootDir) {
  return {
    name: "list_files",
    description:
      "List files and directories under the current workspace. Use this first to discover relevant paths.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_depth: { type: "number" }
      }
    },
    async invoke(inputValue) {
      const requestedPath =
        typeof inputValue.path === "string" && inputValue.path.trim() ? inputValue.path.trim() : ".";
      const maxDepth =
        typeof inputValue.max_depth === "number" && Number.isFinite(inputValue.max_depth)
          ? Math.max(0, Math.min(6, Math.floor(inputValue.max_depth)))
          : 3;
      const target = resolveWorkspacePath(rootDir, requestedPath);
      const targetStat = await stat(target);
      if (!targetStat.isDirectory()) {
        throw new Error(`Path is not a directory: ${requestedPath}`);
      }

      const tree = await renderWorkspaceTree(target, {
        maxDepth,
        maxEntries: 150,
        rootDir,
        label: normalizeRelativePath(relative(rootDir, target)) || "."
      });

      return {
        summary: `Workspace tree for ${requestedPath}:\n${tree}`,
        payload: {
          path: requestedPath,
          tree
        }
      };
    }
  };
}

function createReadFileTool(rootDir) {
  return {
    name: "read_file",
    description:
      "Read a UTF-8 text file from the current workspace. Use after identifying an exact file path.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    },
    async invoke(inputValue) {
      if (typeof inputValue.path !== "string" || !inputValue.path.trim()) {
        throw new Error("read_file requires a non-empty path.");
      }

      const target = resolveWorkspacePath(rootDir, inputValue.path.trim());
      const targetStat = await stat(target);
      if (!targetStat.isFile()) {
        throw new Error(`Path is not a file: ${inputValue.path}`);
      }

      const preview = await readTextPreview(target, FILE_READ_CHAR_LIMIT);
      const relativePath = normalizeRelativePath(relative(rootDir, target));

      return {
        summary: [
          `Read file ${relativePath}:`,
          "```text",
          preview.text,
          preview.truncated ? "\n...[truncated]" : "",
          "```"
        ].join("\n"),
        payload: {
          path: relativePath,
          content: preview.text,
          truncated: preview.truncated
        }
      };
    }
  };
}

function createSearchTextTool(rootDir) {
  return {
    name: "search_text",
    description:
      "Search for literal text in the workspace and return matching lines with file and line numbers.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" }
      },
      required: ["query"]
    },
    async invoke(inputValue) {
      if (typeof inputValue.query !== "string" || !inputValue.query.trim()) {
        throw new Error("search_text requires a non-empty query.");
      }

      const requestedPath =
        typeof inputValue.path === "string" && inputValue.path.trim() ? inputValue.path.trim() : ".";
      const target = resolveWorkspacePath(rootDir, requestedPath);
      const result = await searchWorkspaceText(rootDir, target, inputValue.query.trim(), SEARCH_HIT_LIMIT);

      return {
        summary: result.summary,
        payload: {
          path: requestedPath,
          query: inputValue.query.trim(),
          matches: result.matches
        }
      };
    }
  };
}

function createWriteFileTool(rootDir) {
  return {
    name: "write_file",
    description:
      "Write UTF-8 text content to a workspace file. This overwrites the target file or creates it if missing.",
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
        throw new Error("write_file requires a non-empty path.");
      }
      if (typeof inputValue.content !== "string") {
        throw new Error("write_file requires string content.");
      }

      const target = await resolveWorkspacePathForWrite(rootDir, inputValue.path.trim());
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, inputValue.content, "utf8");
      const relativePath = normalizeRelativePath(relative(rootDir, target));

      return {
        summary: `Wrote ${relativePath} (${inputValue.content.length} chars).`,
        payload: {
          path: relativePath,
          chars: inputValue.content.length
        }
      };
    }
  };
}

function createRunCommandTool(rootDir) {
  return {
    name: "run_command",
    description:
      "Run a shell command inside the workspace and capture stdout, stderr, and exit status for verification.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["command"]
    },
    execution: {
      timeout_ms: 120_000
    },
    async invoke(inputValue, ctx) {
      if (typeof inputValue.command !== "string" || !inputValue.command.trim()) {
        throw new Error("run_command requires a non-empty command.");
      }

      const requestedCwd =
        typeof inputValue.cwd === "string" && inputValue.cwd.trim() ? inputValue.cwd.trim() : ".";
      const commandCwd = resolveWorkspacePath(rootDir, requestedCwd);
      const timeoutMs =
        typeof inputValue.timeout_ms === "number" && Number.isFinite(inputValue.timeout_ms)
          ? Math.max(1_000, Math.min(300_000, Math.floor(inputValue.timeout_ms)))
          : 60_000;

      const result = await runShellCommand(inputValue.command.trim(), {
        cwd: commandCwd,
        timeoutMs,
        signal: ctx.signal
      });
      const relativeCwd = normalizeRelativePath(relative(rootDir, commandCwd)) || ".";

      return {
        summary: formatCommandSummary(inputValue.command.trim(), relativeCwd, result),
        payload: {
          command: inputValue.command.trim(),
          cwd: relativeCwd,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut
        }
      };
    }
  };
}

async function printApprovalPreview(approval) {
  console.log("\n[approval]");
  console.log(`Tool: ${approval.action.tool_name}`);
  if (approval.review_reason) {
    console.log(`Reason: ${approval.review_reason}`);
  }

  if (approval.action.tool_name === "write_file") {
    const preview = await buildWriteApprovalPreview(workspaceRoot, approval.action.tool_args ?? {});
    console.log(preview);
    return;
  }

  if (approval.action.tool_name === "run_command") {
    const preview = buildCommandApprovalPreview(approval.action.tool_args ?? {});
    console.log(preview);
    return;
  }

  console.log(JSON.stringify(approval.action.tool_args ?? {}, null, 2));
}

async function buildWriteApprovalPreview(rootDir, toolArgs) {
  const rawPath = typeof toolArgs.path === "string" ? toolArgs.path.trim() : "";
  const content = typeof toolArgs.content === "string" ? toolArgs.content : "";
  if (!rawPath) {
    return "write_file preview unavailable: missing path.";
  }

  const target = await resolveWorkspacePathForWrite(rootDir, rawPath);
  let before = "";
  try {
    before = await readFile(target, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const diff = await buildUnifiedDiff(rawPath, before, content);
  return [
    `Path: ${normalizeRelativePath(relative(rootDir, target))}`,
    diff || "(no textual diff)"
  ].join("\n");
}

function buildCommandApprovalPreview(toolArgs) {
  const command = typeof toolArgs.command === "string" ? toolArgs.command.trim() : "";
  const cwd = typeof toolArgs.cwd === "string" && toolArgs.cwd.trim() ? toolArgs.cwd.trim() : ".";
  const timeoutMs =
    typeof toolArgs.timeout_ms === "number" && Number.isFinite(toolArgs.timeout_ms)
      ? Math.floor(toolArgs.timeout_ms)
      : 60_000;

  return [
    `cwd: ${cwd}`,
    `timeout_ms: ${timeoutMs}`,
    `command: ${command || "(missing command)"}`
  ].join("\n");
}

async function buildUnifiedDiff(displayPath, before, after) {
  const tempDir = await mkdtemp(join(tmpdir(), "neurocore-diff-"));
  const beforePath = join(tempDir, "before.txt");
  const afterPath = join(tempDir, "after.txt");

  try {
    await writeFile(beforePath, before, "utf8");
    await writeFile(afterPath, after, "utf8");

    const diffResult = await runSubprocess("diff", [
      "-u",
      "-L",
      `a/${displayPath}`,
      "-L",
      `b/${displayPath}`,
      beforePath,
      afterPath
    ], { rejectOnNonZero: false });

    if (![0, 1].includes(diffResult.exitCode)) {
      throw new Error(diffResult.stderr || diffResult.stdout || `diff exited with ${diffResult.exitCode}`);
    }

    const combined = [diffResult.stdout, diffResult.stderr].filter(Boolean).join("\n");
    if (!combined.trim()) {
      return "";
    }
    return truncateText(combined.trim(), PREVIEW_CHAR_LIMIT);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runShellCommand(command, options) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: process.env,
      shell: true,
      signal: options.signal
    });

    let stdoutText = "";
    let stderrText = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs);

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };

    child.stdout.on("data", (chunk) => {
      stdoutText = appendLimited(stdoutText, String(chunk), COMMAND_OUTPUT_CHAR_LIMIT);
    });
    child.stderr.on("data", (chunk) => {
      stderrText = appendLimited(stderrText, String(chunk), COMMAND_OUTPUT_CHAR_LIMIT);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      finish({
        exitCode: code ?? (signal ? 1 : 0),
        signal: signal ?? null,
        timedOut,
        stdout: stdoutText,
        stderr: stderrText
      });
    });
  });
}

function formatCommandSummary(command, cwd, result) {
  const parts = [
    `Command: ${command}`,
    `cwd: ${cwd}`,
    `exit_code: ${result.exitCode}`,
    `timed_out: ${result.timedOut ? "yes" : "no"}`
  ];

  if (result.stdout) {
    parts.push("stdout:");
    parts.push("```text");
    parts.push(result.stdout);
    parts.push("```");
  }

  if (result.stderr) {
    parts.push("stderr:");
    parts.push("```text");
    parts.push(result.stderr);
    parts.push("```");
  }

  return parts.join("\n");
}

function needsToolContinuation(runResult) {
  if (!runResult || runResult.finalState !== "waiting") {
    return false;
  }

  const lastStep = Array.isArray(runResult.steps) ? runResult.steps.at(-1) : null;
  return lastStep?.selectedAction?.action_type === "call_tool" && Boolean(lastStep.observation);
}

function sanitizeAssistantOutput(outputText) {
  if (typeof outputText !== "string") {
    return "";
  }
  return outputText.trim();
}

async function askYesNo(prompt) {
  const answer = input.isTTY
    ? (await rl.question(prompt)).trim().toLowerCase()
    : consumeScriptedInput(prompt).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function collectScriptedInputs() {
  let buffered = "";
  for await (const chunk of input) {
    buffered += chunk;
  }
  return buffered.split(/\r?\n/);
}

function consumeScriptedInput(prompt) {
  const answer = scriptedInputs.shift() ?? "";
  console.log(`${prompt}${answer}`);
  return answer;
}

async function renderWorkspaceTree(rootPath, options = {}) {
  const targetRoot = options.rootDir ?? rootPath;
  const label = options.label ?? (normalizeRelativePath(relative(targetRoot, rootPath)) || ".");
  const lines = [label];
  const state = {
    maxDepth: options.maxDepth ?? 3,
    maxEntries: options.maxEntries ?? 150,
    entryCount: 0,
    truncated: false
  };

  await walkDirectory(rootPath, "", 0, lines, state);

  if (state.truncated) {
    lines.push("... [truncated]");
  }

  return lines.join("\n");
}

async function walkDirectory(directoryPath, prefix, depth, lines, state) {
  if (depth >= state.maxDepth || state.truncated) {
    return;
  }

  let entries = await readdir(directoryPath, { withFileTypes: true });
  entries = entries
    .filter((entry) => !IGNORED_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  for (let index = 0; index < entries.length; index += 1) {
    if (state.entryCount >= state.maxEntries) {
      state.truncated = true;
      return;
    }

    const entry = entries[index];
    const connector = index === entries.length - 1 ? "└── " : "├── ";
    const childPrefix = prefix + (index === entries.length - 1 ? "    " : "│   ");
    lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    state.entryCount += 1;

    if (entry.isDirectory()) {
      await walkDirectory(join(directoryPath, entry.name), childPrefix, depth + 1, lines, state);
      if (state.truncated) {
        return;
      }
    }
  }
}

async function searchWorkspaceText(rootDir, targetPath, query, maxHits) {
  const rgResult = await tryRipgrepSearch(rootDir, targetPath, query, maxHits);
  if (rgResult) {
    return rgResult;
  }

  const matches = [];
  await searchTextFallback(rootDir, targetPath, query, matches, maxHits);
  return formatSearchResult(query, matches, maxHits);
}

async function tryRipgrepSearch(rootDir, targetPath, query, maxHits) {
  const result = await runSubprocess("rg", [
    "--line-number",
    "--column",
    "--color",
    "never",
    "--fixed-strings",
    "--max-count",
    String(maxHits),
    "--glob",
    "!node_modules",
    "--glob",
    "!.git",
    "--glob",
    "!dist",
    query,
    targetPath
  ], { rejectOnNonZero: false });

  if (result.errorCode === "ENOENT") {
    return null;
  }

  if (![0, 1].includes(result.exitCode)) {
    throw new Error(result.stderr || result.stdout || `rg exited with ${result.exitCode}`);
  }

  const matches = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(\d+):(.*)$/);
      if (!match) {
        return null;
      }
      return {
        path: normalizeRelativePath(relative(rootDir, resolve(targetPath, match[1]))),
        line: Number.parseInt(match[2], 10),
        column: Number.parseInt(match[3], 10),
        text: match[4].trim()
      };
    })
    .filter(Boolean);

  return formatSearchResult(query, matches, maxHits);
}

async function searchTextFallback(rootDir, targetPath, query, matches, maxHits) {
  if (matches.length >= maxHits) {
    return;
  }

  const targetStat = await stat(targetPath);
  if (targetStat.isFile()) {
    const preview = await readTextPreview(targetPath, FILE_READ_CHAR_LIMIT * 2);
    const lines = preview.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= maxHits) {
        return;
      }
      if (lines[index].includes(query)) {
        matches.push({
          path: normalizeRelativePath(relative(rootDir, targetPath)),
          line: index + 1,
          column: lines[index].indexOf(query) + 1,
          text: lines[index].trim()
        });
      }
    }
    return;
  }

  let entries = await readdir(targetPath, { withFileTypes: true });
  entries = entries.filter((entry) => !IGNORED_NAMES.has(entry.name));
  for (const entry of entries) {
    if (matches.length >= maxHits) {
      return;
    }
    await searchTextFallback(rootDir, join(targetPath, entry.name), query, matches, maxHits);
  }
}

function formatSearchResult(query, matches, maxHits) {
  if (matches.length === 0) {
    return {
      summary: `No matches found for "${query}".`,
      matches
    };
  }

  const lines = matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.text}`);
  const summary = [
    `Found ${matches.length}${matches.length >= maxHits ? "+" : ""} matches for "${query}":`,
    "```text",
    lines.join("\n"),
    "```"
  ].join("\n");

  return {
    summary,
    matches
  };
}

async function readTextPreview(filePath, charLimit) {
  const raw = await readFile(filePath);
  if (looksBinary(raw)) {
    return {
      text: `[binary file omitted: ${normalizeRelativePath(filePath)}]`,
      truncated: false
    };
  }

  const content = raw.toString("utf8");
  return {
    text: truncateText(content, charLimit),
    truncated: content.length > charLimit
  };
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  for (const value of sample) {
    if (value === 0) {
      return true;
    }
  }
  return false;
}

function resolveWorkspacePath(rootDir, requestedPath) {
  const target = resolve(rootDir, requestedPath);
  const relativePath = relative(rootDir, target);
  if (relativePath.startsWith("..") || relativePath === ".." || relativePath.includes(`${sep}..${sep}`)) {
    throw new Error(`Path escapes workspace root: ${requestedPath}`);
  }
  return target;
}

async function resolveWorkspacePathForWrite(rootDir, requestedPath) {
  const target = resolveWorkspacePath(rootDir, requestedPath);
  const realParent = await findNearestExistingParent(dirname(target));
  const relativeParent = relative(rootDir, realParent);
  if (relativeParent.startsWith("..") || relativeParent === "..") {
    throw new Error(`Write path escapes workspace root: ${requestedPath}`);
  }
  return target;
}

async function findNearestExistingParent(startPath) {
  let currentPath = startPath;

  while (true) {
    try {
      return await realpath(currentPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        throw new Error(`No existing parent directory found for ${startPath}`);
      }
      currentPath = parentPath;
    }
  }
}

function normalizeRelativePath(pathValue) {
  if (!pathValue || pathValue === ".") {
    return ".";
  }
  return pathValue.split(sep).join("/");
}

function truncateText(text, limit) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n...[truncated]`;
}

function appendLimited(current, nextChunk, limit) {
  const combined = current + nextChunk;
  if (combined.length <= limit) {
    return combined;
  }
  return `${combined.slice(0, limit)}\n...[truncated]`;
}

function isMissingFileError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function runSubprocess(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env
    });

    let stdoutText = "";
    let stderrText = "";
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise(value);
    };

    child.stdout.on("data", (chunk) => {
      stdoutText = appendLimited(stdoutText, String(chunk), PREVIEW_CHAR_LIMIT);
    });
    child.stderr.on("data", (chunk) => {
      stderrText = appendLimited(stderrText, String(chunk), PREVIEW_CHAR_LIMIT);
    });
    child.on("error", (error) => {
      if (error && typeof error === "object" && "code" in error) {
        finish({
          exitCode: 1,
          stdout: stdoutText,
          stderr: stderrText,
          errorCode: error.code
        });
        return;
      }
      rejectPromise(error);
    });
    child.on("close", (code) => {
      const result = {
        exitCode: code ?? 0,
        stdout: stdoutText,
        stderr: stderrText,
        errorCode: null
      };
      if (options.rejectOnNonZero !== false && result.exitCode !== 0) {
        rejectPromise(new Error(result.stderr || result.stdout || `${command} exited with ${result.exitCode}`));
        return;
      }
      finish(result);
    });
  });
}
