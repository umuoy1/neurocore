import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { JsonValue, Tool } from "@neurocore/protocol";

export interface WorkspaceFileToolConfig {
  workspaceRoot: string;
  maxFileBytes?: number;
  maxSearchResults?: number;
}

interface RollbackRecord {
  rollback_id: string;
  path: string;
  absolute_path: string;
  previous_content: string | null;
  next_content: string;
  diff: string;
  created_at: string;
}

export function createWorkspaceFileTools(config: WorkspaceFileToolConfig): Tool[] {
  const store = new WorkspaceFileStore(config);
  return [
    createReadTool(store),
    createListTool(store),
    createSearchTool(store),
    createDiffTool(store),
    createWriteTool(store),
    createEditTool(store),
    createApplyPatchTool(store),
    createRollbackTool(store)
  ];
}

class WorkspaceFileStore {
  private readonly root: string;
  private readonly maxFileBytes: number;
  private readonly maxSearchResults: number;
  private readonly rollbacks = new Map<string, RollbackRecord>();

  public constructor(config: WorkspaceFileToolConfig) {
    this.root = resolve(config.workspaceRoot);
    this.maxFileBytes = config.maxFileBytes ?? 512_000;
    this.maxSearchResults = config.maxSearchResults ?? 20;
    mkdirSync(this.root, { recursive: true });
  }

  public read(path: string): Record<string, JsonValue> {
    const absolutePath = this.resolvePath(path);
    const content = this.readText(absolutePath);
    return {
      artifact_type: "workspace_file",
      operation: "read",
      path: this.relativePath(absolutePath),
      content,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: hashText(content)
    };
  }

  public list(path = "."): Record<string, JsonValue> {
    const absolutePath = this.resolvePath(path);
    const entries = readdirSync(absolutePath, { withFileTypes: true })
      .filter((entry) => entry.name !== ".neurocore-file-rollback")
      .map((entry) => {
        const entryPath = resolve(absolutePath, entry.name);
        const stats = statSync(entryPath);
        return {
          path: this.relativePath(entryPath),
          kind: entry.isDirectory() ? "directory" : "file",
          bytes: entry.isFile() ? stats.size : 0
        };
      });
    return {
      artifact_type: "workspace_file",
      operation: "list",
      path: this.relativePath(absolutePath),
      entries: entries as JsonValue
    };
  }

  public search(query: string): Record<string, JsonValue> {
    const files = this.listFiles(this.root);
    const lowered = query.toLowerCase();
    const matches: Array<Record<string, JsonValue>> = [];
    for (const file of files) {
      if (matches.length >= this.maxSearchResults) {
        break;
      }
      const content = this.readText(file);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(lowered)) {
          matches.push({
            path: this.relativePath(file),
            line: index + 1,
            preview: lines[index]
          });
          break;
        }
      }
    }
    return {
      artifact_type: "workspace_file",
      operation: "search",
      query,
      matches: matches as JsonValue
    };
  }

  public diff(path: string, nextContent: string): Record<string, JsonValue> {
    const absolutePath = this.resolvePath(path);
    const previousContent = existsSync(absolutePath) ? this.readText(absolutePath) : "";
    return {
      artifact_type: "workspace_file",
      operation: "diff",
      path: this.relativePath(absolutePath),
      diff: buildUnifiedDiff(this.relativePath(absolutePath), previousContent, nextContent),
      before_sha256: hashText(previousContent),
      after_sha256: hashText(nextContent)
    };
  }

  public write(path: string, content: string, operation = "write"): Record<string, JsonValue> {
    const absolutePath = this.resolvePath(path);
    this.assertWritableContent(content);
    const previousContent = existsSync(absolutePath) ? this.readText(absolutePath) : null;
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
    return this.recordMutation(operation, absolutePath, previousContent, content);
  }

  public edit(path: string, find: string, replace: string, all: boolean): Record<string, JsonValue> {
    if (!find) {
      throw new Error("find is required.");
    }
    const absolutePath = this.resolvePath(path);
    const previousContent = this.readText(absolutePath);
    if (!previousContent.includes(find)) {
      throw new Error(`Text not found in ${this.relativePath(absolutePath)}.`);
    }
    const nextContent = all
      ? previousContent.split(find).join(replace)
      : previousContent.replace(find, replace);
    this.assertWritableContent(nextContent);
    writeFileSync(absolutePath, nextContent, "utf8");
    return this.recordMutation("edit", absolutePath, previousContent, nextContent);
  }

  public applyPatch(
    path: string,
    replacements: Array<{ find: string; replace: string }>
  ): Record<string, JsonValue> {
    if (replacements.length === 0) {
      throw new Error("replacements are required.");
    }
    const absolutePath = this.resolvePath(path);
    let nextContent = this.readText(absolutePath);
    const previousContent = nextContent;
    for (const replacement of replacements) {
      if (!replacement.find) {
        throw new Error("replacement.find is required.");
      }
      if (!nextContent.includes(replacement.find)) {
        throw new Error(`Patch text not found in ${this.relativePath(absolutePath)}.`);
      }
      nextContent = nextContent.replace(replacement.find, replacement.replace);
    }
    this.assertWritableContent(nextContent);
    writeFileSync(absolutePath, nextContent, "utf8");
    return this.recordMutation("apply_patch", absolutePath, previousContent, nextContent);
  }

  public rollback(rollbackId: string): Record<string, JsonValue> {
    const record = this.rollbacks.get(rollbackId);
    if (!record) {
      throw new Error(`Unknown rollback_id: ${rollbackId}`);
    }
    if (record.previous_content === null) {
      rmSync(record.absolute_path, { force: true });
    } else {
      mkdirSync(dirname(record.absolute_path), { recursive: true });
      writeFileSync(record.absolute_path, record.previous_content, "utf8");
    }
    const currentContent = existsSync(record.absolute_path) ? this.readText(record.absolute_path) : "";
    const diff = buildUnifiedDiff(record.path, record.next_content, currentContent);
    return {
      artifact_type: "workspace_file",
      operation: "rollback",
      path: record.path,
      rollback_id: rollbackId,
      diff,
      restored_sha256: hashText(currentContent)
    };
  }

  private recordMutation(
    operation: string,
    absolutePath: string,
    previousContent: string | null,
    nextContent: string
  ): Record<string, JsonValue> {
    const path = this.relativePath(absolutePath);
    const before = previousContent ?? "";
    const diff = buildUnifiedDiff(path, before, nextContent);
    const rollbackId = `frb_${randomUUID()}`;
    this.rollbacks.set(rollbackId, {
      rollback_id: rollbackId,
      path,
      absolute_path: absolutePath,
      previous_content: previousContent,
      next_content: nextContent,
      diff,
      created_at: new Date().toISOString()
    });
    return {
      artifact_type: "workspace_file",
      operation,
      path,
      rollback_id: rollbackId,
      diff,
      bytes_written: Buffer.byteLength(nextContent, "utf8"),
      before_sha256: hashText(before),
      after_sha256: hashText(nextContent)
    };
  }

  private resolvePath(path: string): string {
    if (!path || path.includes("\0")) {
      throw new Error("path is required.");
    }
    const requested = path.startsWith("/") ? path.slice(1) : path;
    const absolutePath = resolve(this.root, requested);
    if (absolutePath !== this.root && !absolutePath.startsWith(`${this.root}${sep}`)) {
      throw new Error(`Path escapes workspace root: ${path}`);
    }
    return absolutePath;
  }

  private relativePath(absolutePath: string): string {
    return relative(this.root, absolutePath) || ".";
  }

  private readText(absolutePath: string): string {
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`${this.relativePath(absolutePath)} is not a file.`);
    }
    if (stats.size > this.maxFileBytes) {
      throw new Error(`${this.relativePath(absolutePath)} exceeds max file size.`);
    }
    return readFileSync(absolutePath, "utf8");
  }

  private assertWritableContent(content: string): void {
    if (Buffer.byteLength(content, "utf8") > this.maxFileBytes) {
      throw new Error("content exceeds max file size.");
    }
  }

  private listFiles(root: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name === ".neurocore-file-rollback") {
        continue;
      }
      const entryPath = resolve(root, entry.name);
      if (entry.isDirectory()) {
        result.push(...this.listFiles(entryPath));
      } else if (entry.isFile() && statSync(entryPath).size <= this.maxFileBytes) {
        result.push(entryPath);
      }
    }
    return result;
  }
}

function createReadTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_read",
    description: "Read a file inside the governed assistant workspace.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    },
    async invoke(input) {
      const payload = store.read(readRequiredString(input.path, "path"));
      return { summary: `Read workspace file ${payload.path}.`, payload };
    }
  };
}

function createListTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_list",
    description: "List files inside the governed assistant workspace.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } }
    },
    async invoke(input) {
      const payload = store.list(readOptionalString(input.path) ?? ".");
      return { summary: `Listed workspace path ${payload.path}.`, payload };
    }
  };
}

function createSearchTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_search",
    description: "Search text files inside the governed assistant workspace.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    async invoke(input) {
      const payload = store.search(readRequiredString(input.query, "query"));
      return { summary: `Searched workspace for "${payload.query}".`, payload };
    }
  };
}

function createDiffTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_diff",
    description: "Preview a unified diff for proposed workspace file content.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    },
    async invoke(input) {
      const payload = store.diff(
        readRequiredString(input.path, "path"),
        readRequiredString(input.content, "content")
      );
      return { summary: `Diff preview for workspace file ${payload.path}.`, payload };
    }
  };
}

function createWriteTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_write",
    description: "Write a file inside the governed assistant workspace with rollback metadata.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    },
    async invoke(input) {
      const payload = store.write(
        readRequiredString(input.path, "path"),
        readRequiredString(input.content, "content")
      );
      return { summary: `Wrote workspace file ${payload.path}. rollback_id=${payload.rollback_id}`, payload };
    }
  };
}

function createEditTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_edit",
    description: "Replace text inside a governed workspace file with rollback metadata.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        find: { type: "string" },
        replace: { type: "string" },
        all: { type: "boolean" }
      },
      required: ["path", "find", "replace"]
    },
    async invoke(input) {
      const payload = store.edit(
        readRequiredString(input.path, "path"),
        readRequiredString(input.find, "find"),
        readRequiredString(input.replace, "replace"),
        input.all === true
      );
      return { summary: `Edited workspace file ${payload.path}. rollback_id=${payload.rollback_id}`, payload };
    }
  };
}

function createApplyPatchTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_apply_patch",
    description: "Apply ordered text replacements to a governed workspace file with rollback metadata.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        replacements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              find: { type: "string" },
              replace: { type: "string" }
            },
            required: ["find", "replace"]
          }
        }
      },
      required: ["path", "replacements"]
    },
    async invoke(input) {
      const replacements = readReplacements(input.replacements);
      const payload = store.applyPatch(readRequiredString(input.path, "path"), replacements);
      return { summary: `Applied patch to workspace file ${payload.path}. rollback_id=${payload.rollback_id}`, payload };
    }
  };
}

function createRollbackTool(store: WorkspaceFileStore): Tool {
  return {
    name: "workspace_file_rollback",
    description: "Rollback a previous workspace file mutation by rollback id.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: { rollback_id: { type: "string" } },
      required: ["rollback_id"]
    },
    async invoke(input) {
      const payload = store.rollback(readRequiredString(input.rollback_id, "rollback_id"));
      return { summary: `Rolled back workspace file ${payload.path}.`, payload };
    }
  };
}

function buildUnifiedDiff(path: string, before: string, after: string): string {
  if (before === after) {
    return `--- a/${path}\n+++ b/${path}\n`;
  }
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  const table: number[][] = Array.from({ length: beforeLines.length + 1 }, () =>
    Array.from({ length: afterLines.length + 1 }, () => 0)
  );
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      if (beforeLines[i].length > 0) {
        lines.push(` ${beforeLines[i]}`);
      }
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      if (beforeLines[i].length > 0) {
        lines.push(`-${beforeLines[i]}`);
      }
      i += 1;
    } else {
      if (afterLines[j].length > 0) {
        lines.push(`+${afterLines[j]}`);
      }
      j += 1;
    }
  }
  while (i < beforeLines.length) {
    if (beforeLines[i].length > 0) {
      lines.push(`-${beforeLines[i]}`);
    }
    i += 1;
  }
  while (j < afterLines.length) {
    if (afterLines[j].length > 0) {
      lines.push(`+${afterLines[j]}`);
    }
    j += 1;
  }
  return `${lines.join("\n")}\n`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readReplacements(value: unknown): Array<{ find: string; replace: string }> {
  if (!Array.isArray(value)) {
    throw new Error("replacements are required.");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("replacement entries must be objects.");
    }
    const record = entry as Record<string, unknown>;
    return {
      find: readRequiredString(record.find, "find"),
      replace: readRequiredString(record.replace, "replace")
    };
  });
}
