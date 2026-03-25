process.env.NEUROCORE_DEBUG ??= "1";

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { defineAgent } from "@neurocore/sdk-core";
import {
  loadOpenAICompatibleConfig,
  OpenAICompatibleReasoner
} from "@neurocore/sdk-node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sandboxRoot = resolve(__dirname, "cli-sandbox");

const config = await loadOpenAICompatibleConfig();
const reasoner = new OpenAICompatibleReasoner(config);

console.log("[demo-cli] NeuroCore CLI demo");
console.log("[demo-cli] Sandbox root:", sandboxRoot);
console.log("[demo-cli] Model:", config.model);
console.log("[demo-cli] Commands: /help /tools /files /exit");

const agent = defineAgent({
  id: "cli-demo-agent",
  role:
    "CLI assistant that behaves like a lightweight coding terminal agent. You can inspect a fixed read-only sandbox by using the provided tools. Prefer using tools before answering questions about files. Use list_sandbox_files to discover paths, read_sandbox_file to inspect content, and search_sandbox_files to find relevant snippets. Never claim to read files you have not accessed through tools."
})
  .useReasoner(reasoner)
  .registerTool(createListSandboxFilesTool(sandboxRoot))
  .registerTool(createReadSandboxFileTool(sandboxRoot))
  .registerTool(createSearchSandboxFilesTool(sandboxRoot));

const rl = createInterface({ input, output });

try {
  printHelp();
  if (input.isTTY) {
    while (true) {
      const line = (await rl.question("\nneurocore> ")).trim();
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

console.log("[demo-cli] Session closed");

function printHelp() {
  console.log("\n[help]");
  console.log("Ask questions about the fixed sandbox folder, for example:");
  console.log("- 请列出沙箱里有哪些文件");
  console.log("- 阅读 payments 相关文档并总结根因");
  console.log("- 搜索 db-pool-config 出现在哪些文件");
  console.log("- 结合 incidents 和 logs，说明最近一次故障与发布的关系");
}

function printTools() {
  console.log("\n[tools]");
  console.log("- list_sandbox_files(path='.'): list files/directories under the fixed sandbox");
  console.log("- read_sandbox_file(path): read one UTF-8 text file under the sandbox");
  console.log("- search_sandbox_files(query, path='.'): search text snippets under the sandbox");
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
    const tree = await renderSandboxTree(sandboxRoot);
    console.log(tree);
    return true;
  }

  const session = agent.createSession({
    agent_id: "cli-demo-agent",
    tenant_id: "local",
    initial_input: {
      input_id: `inp_${Date.now()}`,
      content: line,
      created_at: new Date().toISOString(),
      metadata: {
        sandboxRoot,
        cliMode: true
      }
    }
  });

  console.log("[demo-cli] Running agent...");
  console.log("[demo-cli] Session created", { sessionId: session.id });
  const result = await session.run();
  const lastStep = result.steps.at(-1);

  console.log(`\nassistant (${result.finalState})`);
  console.log(result.outputText ?? "(no output)");

  if (lastStep?.selectedAction) {
    console.log("\n[selected action]");
    console.log(
      JSON.stringify(
        {
          actionType: lastStep.selectedAction.action_type,
          title: lastStep.selectedAction.title,
          toolName: lastStep.selectedAction.tool_name,
          toolArgs: lastStep.selectedAction.tool_args
        },
        null,
        2
      )
    );
  }

  return true;
}

function createListSandboxFilesTool(rootDir) {
  return {
    name: "list_sandbox_files",
    description:
      "List files and directories under the fixed sandbox root. Use this first to discover readable paths.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      }
    },
    async invoke(inputValue) {
      const requestedPath =
        typeof inputValue.path === "string" && inputValue.path.trim() ? inputValue.path.trim() : ".";
      const target = resolveSandboxPath(rootDir, requestedPath);
      const dirEntries = await readdir(target, { withFileTypes: true });
      const entries = dirEntries
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          path: normalizeRelativePath(relative(rootDir, resolve(target, entry.name)))
        }));

      return {
        summary: entries.length === 0
          ? `No entries found under ${requestedPath}.`
          : `Listed ${entries.length} entries under ${requestedPath}: ${entries.map((entry) => `${entry.type}:${entry.path}`).join(", ")}`,
        payload: {
          root: rootDir,
          requestedPath,
          entries
        }
      };
    }
  };
}

function createReadSandboxFileTool(rootDir) {
  return {
    name: "read_sandbox_file",
    description:
      "Read a UTF-8 text file under the fixed sandbox root. Use after discovering an exact file path.",
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
        throw new Error("read_sandbox_file requires a non-empty path.");
      }

      const requestedPath = inputValue.path.trim();
      const target = resolveSandboxPath(rootDir, requestedPath);
      const targetStat = await stat(target);
      if (!targetStat.isFile()) {
        throw new Error(`Path is not a file: ${requestedPath}`);
      }

      const content = await readFile(target, "utf8");
      const preview = content.length > 4000 ? `${content.slice(0, 4000)}\n...[truncated]` : content;

      return {
        summary: `Read ${normalizeRelativePath(relative(rootDir, target))} (${content.length} chars).`,
        payload: {
          path: normalizeRelativePath(relative(rootDir, target)),
          content: preview,
          truncated: content.length > 4000
        }
      };
    }
  };
}

function createSearchSandboxFilesTool(rootDir) {
  return {
    name: "search_sandbox_files",
    description:
      "Search for a text query under the fixed sandbox root and return matching file snippets.",
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
        throw new Error("search_sandbox_files requires a non-empty query.");
      }

      const query = inputValue.query.trim().toLowerCase();
      const requestedPath =
        typeof inputValue.path === "string" && inputValue.path.trim() ? inputValue.path.trim() : ".";
      const target = resolveSandboxPath(rootDir, requestedPath);
      const files = await collectFiles(target);
      const matches = [];

      for (const filePath of files) {
        const content = await readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(query)) {
            matches.push({
              path: normalizeRelativePath(relative(rootDir, filePath)),
              line: index + 1,
              snippet: line.trim()
            });
          }
        });
      }

      return {
        summary: matches.length === 0
          ? `No matches found for "${inputValue.query}" under ${requestedPath}.`
          : `Found ${matches.length} matches for "${inputValue.query}" under ${requestedPath}.`,
        payload: {
          query: inputValue.query,
          requestedPath,
          matches: matches.slice(0, 20)
        }
      };
    }
  };
}

function resolveSandboxPath(rootDir, requestedPath) {
  const normalizedInput =
    requestedPath === "/" ? "." : requestedPath.replace(/^\/+/, "") || ".";
  const resolved = resolve(rootDir, normalizedInput);
  const relativePath = relative(rootDir, resolved);
  if (relativePath.startsWith("..") || relativePath.includes(`${sep}..`) || relativePath === "") {
    if (resolved !== rootDir) {
      throw new Error(`Path escapes sandbox root: ${requestedPath}`);
    }
  }
  if (!resolved.startsWith(rootDir)) {
    throw new Error(`Path escapes sandbox root: ${requestedPath}`);
  }
  return resolved;
}

function normalizeRelativePath(value) {
  return value.split(sep).join("/");
}

async function collectFiles(startPath) {
  const targetStat = await stat(startPath);
  if (targetStat.isFile()) {
    return [startPath];
  }

  const dirEntries = await readdir(startPath, { withFileTypes: true });
  const files = [];
  for (const entry of dirEntries) {
    const fullPath = resolve(startPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function renderSandboxTree(rootDir) {
  const lines = ["[sandbox tree]"];
  await walk(rootDir, ".");
  return lines.join("\n");

  async function walk(currentPath, label) {
    const currentStat = await stat(currentPath);
    if (currentStat.isFile()) {
      lines.push(`- ${label}`);
      return;
    }

    if (label === ".") {
      lines.push("- ./");
    } else {
      lines.push(`- ${label}/`);
    }

    const dirEntries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of dirEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = resolve(currentPath, entry.name);
      const childLabel = label === "." ? entry.name : `${label}/${entry.name}`;
      await walk(childPath, childLabel);
    }
  }
}
