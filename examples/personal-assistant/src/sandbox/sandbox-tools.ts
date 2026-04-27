import type { JsonValue, Tool } from "@neurocore/protocol";
import type { SandboxCommandResult, SandboxEnvironmentMetadata, SandboxManager, SandboxTarget } from "./sandbox-provider.js";

export function createSandboxTools(manager: SandboxManager): Tool[] {
  return [
    createSandboxShellTool(manager),
    createSandboxFileReadTool(manager),
    createSandboxFileWriteTool(manager),
    createSandboxEnvironmentStatusTool(manager),
    createSandboxEnvironmentHibernateTool(manager),
    createSandboxEnvironmentResumeTool(manager)
  ];
}

export function createSandboxShellTool(manager: SandboxManager): Tool {
  return {
    name: "sandbox_shell",
    description: "Run a shell command through the configured sandbox provider.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        target: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["command"]
    },
    async invoke(input, ctx) {
      const command = readRequiredString(input.command, "command");
      const result = await manager.execute({
        operation: "exec",
        command,
        target: readOptionalTarget(input.target),
        cwd: readOptionalString(input.cwd),
        timeout_ms: readOptionalNumber(input.timeout_ms),
        signal: ctx.signal
      });
      return {
        summary: formatSandboxSummary(result),
        payload: toSandboxPayload(result)
      };
    }
  };
}

export function createSandboxFileReadTool(manager: SandboxManager): Tool {
  return {
    name: "sandbox_file_read",
    description: "Read a file through the configured sandbox provider.",
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        target: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["path"]
    },
    async invoke(input, ctx) {
      const path = readRequiredString(input.path, "path");
      const result = await manager.execute({
        operation: "file_read",
        command: `cat ${quoteShell(path)}`,
        target: readOptionalTarget(input.target),
        cwd: readOptionalString(input.cwd),
        timeout_ms: readOptionalNumber(input.timeout_ms),
        signal: ctx.signal
      });
      return {
        summary: formatSandboxSummary(result),
        payload: {
          ...toSandboxPayload(result),
          path
        }
      };
    }
  };
}

export function createSandboxFileWriteTool(manager: SandboxManager): Tool {
  return {
    name: "sandbox_file_write",
    description: "Write a file through the configured sandbox provider.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        target: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" }
      },
      required: ["path", "content"]
    },
    async invoke(input, ctx) {
      const path = readRequiredString(input.path, "path");
      const content = readRequiredString(input.content, "content");
      const result = await manager.execute({
        operation: "file_write",
        command: `cat > ${quoteShell(path)}`,
        stdin: content,
        target: readOptionalTarget(input.target),
        cwd: readOptionalString(input.cwd),
        timeout_ms: readOptionalNumber(input.timeout_ms),
        signal: ctx.signal
      });
      return {
        summary: formatSandboxSummary(result),
        payload: {
          ...toSandboxPayload(result),
          path,
          bytes_written: Buffer.byteLength(content, "utf8")
        }
      };
    }
  };
}

export function createSandboxEnvironmentStatusTool(manager: SandboxManager): Tool {
  return {
    name: "sandbox_environment_status",
    description: "Inspect sandbox environment lifecycle, checkpoint, restore and cost metadata.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" }
      }
    },
    async invoke(input) {
      const environment = manager.getEnvironmentStatus(readOptionalTarget(input.target));
      return {
        summary: formatEnvironmentSummary(environment),
        payload: {
          environment: toEnvironmentPayload(environment)
        }
      };
    }
  };
}

export function createSandboxEnvironmentHibernateTool(manager: SandboxManager): Tool {
  return {
    name: "sandbox_environment_hibernate",
    description: "Hibernate a sandbox environment and return checkpoint metadata.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" }
      }
    },
    async invoke(input) {
      const environment = manager.hibernateEnvironment(readOptionalTarget(input.target));
      return {
        summary: formatEnvironmentSummary(environment),
        payload: {
          environment: toEnvironmentPayload(environment)
        }
      };
    }
  };
}

export function createSandboxEnvironmentResumeTool(manager: SandboxManager): Tool {
  return {
    name: "sandbox_environment_resume",
    description: "Resume a hibernated sandbox environment and return restore metadata.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" }
      }
    },
    async invoke(input) {
      const environment = manager.resumeEnvironment(readOptionalTarget(input.target));
      return {
        summary: formatEnvironmentSummary(environment),
        payload: {
          environment: toEnvironmentPayload(environment)
        }
      };
    }
  };
}

function toSandboxPayload(result: SandboxCommandResult): Record<string, JsonValue | undefined> {
  const trace: Record<string, JsonValue> = {
    provider_name: result.trace.provider_name,
    target: result.trace.target,
    executable: result.trace.executable,
    args: result.trace.args,
    operation: result.trace.operation
  };
  if (result.trace.cwd) {
    trace.cwd = result.trace.cwd;
  }
  if (result.trace.timeout_ms !== undefined) {
    trace.timeout_ms = result.trace.timeout_ms;
  }

  const sandbox: Record<string, JsonValue> = {
    provider_name: result.provider_name,
    target: result.target,
    operation: result.operation,
    command: result.command,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    started_at: result.started_at,
    ended_at: result.ended_at,
    trace
  };
  if (result.cwd) {
    sandbox.cwd = result.cwd;
  }

  return {
    sandbox,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    environment: result.environment ? toEnvironmentPayload(result.environment) : undefined,
    cost: result.cost ? result.cost as unknown as JsonValue : undefined
  };
}

function formatSandboxSummary(result: SandboxCommandResult): string {
  const output = result.stdout.trim() || result.stderr.trim() || "no output";
  return `SANDBOX_TRACE provider=${result.provider_name} target=${result.target} operation=${result.operation} exit_code=${result.exit_code} timed_out=${result.timed_out}\n${output}`;
}

function formatEnvironmentSummary(environment: SandboxEnvironmentMetadata): string {
  return `SANDBOX_ENV target=${environment.target} backend=${environment.backend} lifecycle=${environment.lifecycle} checkpoint=${environment.checkpoint_id ?? "none"} cost=${environment.estimated_cost_usd}`;
}

function toEnvironmentPayload(environment: SandboxEnvironmentMetadata): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {
    environment_id: environment.environment_id,
    target: environment.target,
    backend: environment.backend,
    lifecycle: environment.lifecycle,
    created_at: environment.created_at,
    updated_at: environment.updated_at,
    restore_count: environment.restore_count,
    estimated_cost_usd: environment.estimated_cost_usd,
    secrets_injected: environment.secrets_injected,
    metadata: toJsonRecord(environment.metadata)
  };
  if (environment.workspace) payload.workspace = environment.workspace;
  if (environment.hibernated_at) payload.hibernated_at = environment.hibernated_at;
  if (environment.resumed_at) payload.resumed_at = environment.resumed_at;
  if (environment.checkpoint_id) payload.checkpoint_id = environment.checkpoint_id;
  if (environment.cost_limit_usd !== undefined) payload.cost_limit_usd = environment.cost_limit_usd;
  return payload;
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

function readOptionalTarget(value: unknown): SandboxTarget | undefined {
  return value === "local" || value === "docker" || value === "ssh" || value === "serverless" ? value : undefined;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toJsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
