import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { JsonValue, Tool } from "@neurocore/protocol";
import { BackgroundTaskLedger } from "../proactive/background-task-ledger.js";
import type { BackgroundTaskEntry } from "../proactive/types.js";
import { filterSecretEnv } from "../security/credential-vault.js";

export type TerminalProcessStatus = "running" | "exited" | "failed" | "killed" | "timed_out";

export interface TerminalBackgroundProcessManagerOptions {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  maxLogBytes?: number;
  defaultTimeoutMs?: number;
  taskLedger?: BackgroundTaskLedger;
  targetUser?: string;
}

export interface TerminalProcessStartInput {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
  description?: string;
  target_user?: string;
}

export interface TerminalProcessSnapshot {
  process_id: string;
  pid?: number;
  command: string;
  cwd?: string;
  status: TerminalProcessStatus;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  started_at: string;
  ended_at?: string;
  stdout_bytes: number;
  stderr_bytes: number;
  task_id: string;
  background_task?: BackgroundTaskEntry;
}

interface ProcessRecord {
  process_id: string;
  child: ChildProcessWithoutNullStreams;
  command: string;
  cwd?: string;
  status: TerminalProcessStatus;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  started_at: string;
  ended_at?: string;
  stdout: string;
  stderr: string;
  stdout_bytes: number;
  stderr_bytes: number;
  task_id: string;
  timeout?: ReturnType<typeof setTimeout>;
  kill_requested: boolean;
  settled: boolean;
  waiters: Array<(snapshot: TerminalProcessSnapshot) => void>;
}

export class TerminalBackgroundProcessManager {
  public readonly taskLedger: BackgroundTaskLedger;
  private readonly processes = new Map<string, ProcessRecord>();
  private readonly shell: string;
  private readonly maxLogBytes: number;

  public constructor(private readonly options: TerminalBackgroundProcessManagerOptions = {}) {
    this.shell = options.shell ?? "sh";
    this.maxLogBytes = options.maxLogBytes ?? 256_000;
    this.taskLedger = options.taskLedger ?? new BackgroundTaskLedger();
  }

  public start(input: TerminalProcessStartInput): TerminalProcessSnapshot {
    if (!input.command) {
      throw new Error("command is required.");
    }
    const processId = `tpr_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const cwd = input.cwd ?? this.options.cwd;
    const child = spawn(this.shell, ["-lc", input.command], {
      cwd,
      env: filterSecretEnv({
        PATH: process.env.PATH ?? "",
        ...(this.options.env ?? {}),
        ...(input.env ?? {})
      }),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const task = this.taskLedger.create({
      source: "manual",
      description: input.description ?? `Terminal process: ${input.command}`,
      target_user: input.target_user ?? this.options.targetUser ?? "terminal",
      metadata: {
        terminal_process: true,
        process_id: processId,
        pid: child.pid,
        command: input.command,
        cwd
      }
    });
    this.taskLedger.markRunning(task.task_id, `process:${processId}`, startedAt);
    const record: ProcessRecord = {
      process_id: processId,
      child,
      command: input.command,
      cwd,
      status: "running",
      exit_code: null,
      signal: null,
      timed_out: false,
      started_at: startedAt,
      stdout: "",
      stderr: "",
      stdout_bytes: 0,
      stderr_bytes: 0,
      task_id: task.task_id,
      kill_requested: false,
      settled: false,
      waiters: []
    };
    this.processes.set(processId, record);
    child.stdout.on("data", (chunk: Buffer) => this.appendLog(record, "stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => this.appendLog(record, "stderr", chunk));
    child.on("error", (error) => this.finish(record, "failed", -1, null, error));
    child.on("close", (code, signal) => {
      const status = record.timed_out
        ? "timed_out"
        : record.kill_requested
          ? "killed"
          : code === 0
            ? "exited"
            : "failed";
      this.finish(record, status, code, signal);
    });
    const timeoutMs = input.timeout_ms ?? this.options.defaultTimeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      record.timeout = setTimeout(() => {
        record.timed_out = true;
        this.terminate(record, "SIGTERM", 1_000);
      }, timeoutMs);
    }
    return this.snapshot(record);
  }

  public poll(processId: string): TerminalProcessSnapshot {
    return this.snapshot(this.require(processId));
  }

  public list(): TerminalProcessSnapshot[] {
    return [...this.processes.values()].map((record) => this.snapshot(record));
  }

  public log(processId: string, input: { stdout_offset?: number; stderr_offset?: number } = {}): Record<string, JsonValue> {
    const record = this.require(processId);
    const stdoutOffset = Math.max(0, input.stdout_offset ?? 0);
    const stderrOffset = Math.max(0, input.stderr_offset ?? 0);
    return {
      ...this.snapshotPayload(record),
      stdout: record.stdout.slice(stdoutOffset),
      stderr: record.stderr.slice(stderrOffset),
      stdout_offset: stdoutOffset,
      stderr_offset: stderrOffset,
      next_stdout_offset: record.stdout.length,
      next_stderr_offset: record.stderr.length
    };
  }

  public write(processId: string, stdin: string): TerminalProcessSnapshot {
    const record = this.requireRunning(processId);
    record.child.stdin.write(stdin);
    this.taskLedger.mergeMetadata(record.task_id, {
      last_stdin_at: new Date().toISOString(),
      stdin_bytes_written: Buffer.byteLength(stdin, "utf8")
    });
    return this.snapshot(record);
  }

  public async wait(processId: string, timeoutMs?: number): Promise<TerminalProcessSnapshot> {
    const record = this.require(processId);
    if (record.status !== "running") {
      return this.snapshot(record);
    }
    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const waiter = (snapshot: TerminalProcessSnapshot) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(snapshot);
      };
      record.waiters.push(waiter);
      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          record.waiters = record.waiters.filter((candidate) => candidate !== waiter);
          resolve(this.snapshot(record));
        }, timeoutMs);
      }
    });
  }

  public async kill(processId: string, signal = "SIGTERM", waitMs = 1_000): Promise<TerminalProcessSnapshot> {
    const record = this.require(processId);
    if (record.status !== "running") {
      return this.snapshot(record);
    }
    record.kill_requested = true;
    this.terminate(record, signal, waitMs);
    const snapshot = await this.wait(processId, waitMs + 1_000);
    if (snapshot.status === "running") {
      this.terminate(record, "SIGKILL", 1_000);
      return this.wait(processId, 1_500);
    }
    return snapshot;
  }

  private require(processId: string): ProcessRecord {
    const record = this.processes.get(processId);
    if (!record) {
      throw new Error(`Unknown terminal process: ${processId}`);
    }
    return record;
  }

  private requireRunning(processId: string): ProcessRecord {
    const record = this.require(processId);
    if (record.status !== "running") {
      throw new Error(`Terminal process ${processId} is not running.`);
    }
    return record;
  }

  private terminate(record: ProcessRecord, signal: string, forceAfterMs: number): void {
    if (record.status !== "running") {
      return;
    }
    record.kill_requested = true;
    sendSignal(record, signal);
    setTimeout(() => {
      if (record.status === "running") {
        sendSignal(record, "SIGKILL");
      }
    }, forceAfterMs).unref?.();
  }

  private appendLog(record: ProcessRecord, stream: "stdout" | "stderr", chunk: Buffer): void {
    const text = chunk.toString("utf8");
    if (stream === "stdout") {
      record.stdout_bytes += Buffer.byteLength(text, "utf8");
      record.stdout = truncateLeft(`${record.stdout}${text}`, this.maxLogBytes);
      return;
    }
    record.stderr_bytes += Buffer.byteLength(text, "utf8");
    record.stderr = truncateLeft(`${record.stderr}${text}`, this.maxLogBytes);
  }

  private finish(
    record: ProcessRecord,
    status: TerminalProcessStatus,
    code: number | null,
    signal: string | null,
    error?: unknown
  ): void {
    if (record.settled) {
      return;
    }
    record.settled = true;
    record.status = status;
    record.exit_code = code;
    record.signal = signal;
    record.ended_at = new Date().toISOString();
    if (record.timeout) {
      clearTimeout(record.timeout);
    }
    if (status === "exited") {
      this.taskLedger.markSucceeded(record.task_id, {
        result_text: summarizeTerminalRecord(record),
        completed_at: record.ended_at
      });
    } else if (status === "killed") {
      this.taskLedger.cancel(record.task_id, record.ended_at);
    } else {
      this.taskLedger.markFailed(
        record.task_id,
        error ?? `Terminal process ${record.process_id} ${status} exit_code=${code} signal=${signal}`,
        record.ended_at
      );
    }
    const snapshot = this.snapshot(record);
    for (const waiter of record.waiters.splice(0)) {
      waiter(snapshot);
    }
  }

  private snapshot(record: ProcessRecord): TerminalProcessSnapshot {
    return {
      process_id: record.process_id,
      pid: record.child.pid,
      command: record.command,
      cwd: record.cwd,
      status: record.status,
      exit_code: record.exit_code,
      signal: record.signal,
      timed_out: record.timed_out,
      started_at: record.started_at,
      ended_at: record.ended_at,
      stdout_bytes: record.stdout_bytes,
      stderr_bytes: record.stderr_bytes,
      task_id: record.task_id,
      background_task: this.taskLedger.get(record.task_id)
    };
  }

  private snapshotPayload(record: ProcessRecord): Record<string, JsonValue> {
    const snapshot = this.snapshot(record);
    return snapshot as unknown as Record<string, JsonValue>;
  }
}

export function createTerminalBackgroundProcessTools(manager: TerminalBackgroundProcessManager): Tool[] {
  return [
    createStartTool(manager),
    createPollTool(manager),
    createLogTool(manager),
    createWriteTool(manager),
    createWaitTool(manager),
    createKillTool(manager)
  ];
}

function createStartTool(manager: TerminalBackgroundProcessManager): Tool {
  return {
    name: "terminal_process_start",
    description: "Start a governed terminal command as a background process.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        env: { type: "object" },
        timeout_ms: { type: "number" },
        description: { type: "string" },
        target_user: { type: "string" }
      },
      required: ["command"]
    },
    async invoke(input) {
      const snapshot = manager.start({
        command: readRequiredString(input.command, "command"),
        cwd: readOptionalString(input.cwd),
        env: readOptionalStringRecord(input.env),
        timeout_ms: readOptionalNumber(input.timeout_ms),
        description: readOptionalString(input.description),
        target_user: readOptionalString(input.target_user)
      });
      return {
        summary: `Started terminal process ${snapshot.process_id} pid=${snapshot.pid} status=${snapshot.status}.`,
        payload: snapshot as unknown as Record<string, JsonValue>
      };
    }
  };
}

function createPollTool(manager: TerminalBackgroundProcessManager): Tool {
  return {
    name: "terminal_process_poll",
    description: "Poll a governed terminal background process.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: { process_id: { type: "string" } },
      required: ["process_id"]
    },
    async invoke(input) {
      const snapshot = manager.poll(readRequiredString(input.process_id, "process_id"));
      return {
        summary: `Terminal process ${snapshot.process_id} status=${snapshot.status}.`,
        payload: snapshot as unknown as Record<string, JsonValue>
      };
    }
  };
}

function createLogTool(manager: TerminalBackgroundProcessManager): Tool {
  return {
    name: "terminal_process_log",
    description: "Read incremental stdout and stderr for a terminal background process.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        process_id: { type: "string" },
        stdout_offset: { type: "number" },
        stderr_offset: { type: "number" }
      },
      required: ["process_id"]
    },
    async invoke(input) {
      const payload = manager.log(readRequiredString(input.process_id, "process_id"), {
        stdout_offset: readOptionalNumber(input.stdout_offset),
        stderr_offset: readOptionalNumber(input.stderr_offset)
      });
      return {
        summary: `Read terminal process ${payload.process_id} logs.`,
        payload
      };
    }
  };
}

function createWriteTool(manager: TerminalBackgroundProcessManager): Tool {
  return {
    name: "terminal_process_write",
    description: "Write stdin to a governed terminal background process.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        process_id: { type: "string" },
        stdin: { type: "string" }
      },
      required: ["process_id", "stdin"]
    },
    async invoke(input) {
      const snapshot = manager.write(
        readRequiredString(input.process_id, "process_id"),
        readRequiredString(input.stdin, "stdin")
      );
      return {
        summary: `Wrote stdin to terminal process ${snapshot.process_id}.`,
        payload: snapshot as unknown as Record<string, JsonValue>
      };
    }
  };
}

function createWaitTool(manager: TerminalBackgroundProcessManager): Tool {
  return {
    name: "terminal_process_wait",
    description: "Wait for a governed terminal background process to finish.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        process_id: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["process_id"]
    },
    async invoke(input) {
      const snapshot = await manager.wait(
        readRequiredString(input.process_id, "process_id"),
        readOptionalNumber(input.timeout_ms)
      );
      return {
        summary: `Waited for terminal process ${snapshot.process_id} status=${snapshot.status}.`,
        payload: snapshot as unknown as Record<string, JsonValue>
      };
    }
  };
}

function createKillTool(manager: TerminalBackgroundProcessManager): Tool {
  return {
    name: "terminal_process_kill",
    description: "Kill a governed terminal background process and mark its task cancelled.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        process_id: { type: "string" },
        signal: { type: "string" },
        wait_ms: { type: "number" }
      },
      required: ["process_id"]
    },
    async invoke(input) {
      const snapshot = await manager.kill(
        readRequiredString(input.process_id, "process_id"),
        readOptionalString(input.signal) ?? "SIGTERM",
        readOptionalNumber(input.wait_ms) ?? 1_000
      );
      return {
        summary: `Killed terminal process ${snapshot.process_id} status=${snapshot.status}.`,
        payload: snapshot as unknown as Record<string, JsonValue>
      };
    }
  };
}

function summarizeTerminalRecord(record: ProcessRecord): string {
  const stdout = record.stdout.trim();
  const stderr = record.stderr.trim();
  return stdout || stderr || `Terminal process ${record.process_id} completed.`;
}

function truncateLeft(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  return Buffer.from(value, "utf8").subarray(-maxBytes).toString("utf8");
}

function sendSignal(record: ProcessRecord, signal: string): void {
  try {
    if (process.platform !== "win32" && record.child.pid) {
      process.kill(-record.child.pid, signal as NodeJS.Signals);
      return;
    }
    record.child.kill(signal as NodeJS.Signals);
  } catch {
    try {
      record.child.kill(signal as NodeJS.Signals);
    } catch {}
  }
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      output[key] = entry;
    }
  }
  return output;
}
