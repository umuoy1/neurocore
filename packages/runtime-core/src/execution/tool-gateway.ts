import type {
  ActionExecution,
  CandidateAction,
  Observation,
  Tool,
  ToolContext,
  ToolExecutionPolicy,
  ToolResult
} from "@neurocore/protocol";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";

export interface ToolGatewayExecuteOptions {
  defaultExecution?: ToolExecutionPolicy;
}

type ToolFailureType = "invalid_action" | "unknown_tool" | "timeout" | "invoke_error";

interface ToolAttemptFailure {
  attempt: number;
  error_type: ToolFailureType;
  message: string;
  retryable: boolean;
  started_at: string;
  ended_at: string;
  latency_ms?: number;
}

class ToolInvocationError extends Error {
  public constructor(
    public readonly errorType: ToolFailureType,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ToolInvocationError";
  }
}

export class ToolGateway {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  public list(): Tool[] {
    return [...this.tools.values()];
  }

  public async execute(
    action: CandidateAction,
    ctx: ToolContext,
    options?: ToolGatewayExecuteOptions
  ): Promise<{ execution: ActionExecution; observation: Observation }> {
    const startedAt = nowIso();

    if (action.action_type !== "call_tool" || !action.tool_name) {
      return this.buildFailureOutcome({
        action,
        ctx,
        startedAt,
        endedAt: nowIso(),
        failures: [
          createImmediateFailure(
            "invalid_action",
            `Action ${action.action_id} is not a valid tool invocation.`
          )
        ],
        executionPolicy: resolveExecutionPolicy(options?.defaultExecution)
      });
    }

    const tool = this.tools.get(action.tool_name);
    if (!tool) {
      return this.buildFailureOutcome({
        action,
        ctx,
        startedAt,
        endedAt: nowIso(),
        failures: [
          createImmediateFailure("unknown_tool", `Unknown tool: ${action.tool_name}`)
        ],
        executionPolicy: resolveExecutionPolicy(options?.defaultExecution)
      });
    }

    const executionPolicy = resolveExecutionPolicy(options?.defaultExecution, tool.execution);
    const maxAttempts = (executionPolicy.max_retries ?? 0) + 1;
    const failures: ToolAttemptFailure[] = [];

    if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
      const validationErrors = validateArgs(action.tool_args ?? {}, tool.inputSchema);
      if (validationErrors.length > 0) {
        return this.buildFailureOutcome({
          action,
          ctx,
          startedAt,
          endedAt: nowIso(),
          failures: [createImmediateFailure("invalid_action", `Tool argument validation failed: ${validationErrors.join("; ")}`)],
          executionPolicy
        });
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAt = nowIso();
      debugLog("tool", "Executing tool action", {
        sessionId: ctx.session_id,
        cycleId: ctx.cycle_id,
        toolName: tool.name,
        actionId: action.action_id,
        attempt,
        maxAttempts,
        timeoutMs: executionPolicy.timeout_ms ?? null,
        argKeys: Object.keys(action.tool_args ?? {})
      });

      try {
        const result = await this.invokeTool(tool, action.tool_args ?? {}, ctx, attempt, executionPolicy);
        const endedAt = nowIso();
        debugLog("tool", "Tool execution completed", {
          sessionId: ctx.session_id,
          cycleId: ctx.cycle_id,
          toolName: tool.name,
          actionId: action.action_id,
          attempt,
          retryCount: attempt - 1,
          summaryPreview: result.summary.slice(0, 160)
        });

        return {
          execution: {
            execution_id: generateId("exe"),
            session_id: ctx.session_id,
            cycle_id: ctx.cycle_id,
            action_id: action.action_id,
            status: "succeeded",
            started_at: startedAt,
            ended_at: endedAt,
            executor: "tool_gateway",
            result_ref: `${tool.name}:success`,
            metrics: {
              latency_ms: computeLatencyMs(startedAt, endedAt),
              attempt_count: attempt,
              retry_count: attempt - 1,
              timeout_ms: executionPolicy.timeout_ms
            }
          },
          observation: {
            observation_id: generateId("obs"),
            session_id: ctx.session_id,
            cycle_id: ctx.cycle_id,
            source_action_id: action.action_id,
            source_type: "tool",
            status: "success",
            summary: result.summary,
            structured_payload: {
              ...(result.payload ?? {}),
              tool_name: tool.name,
              tool_args: action.tool_args ?? {},
              __execution: {
                status: "succeeded",
                attempt_count: attempt,
                retry_count: attempt - 1,
                max_attempts: maxAttempts,
                timeout_ms: executionPolicy.timeout_ms,
                failures: failures.map(formatFailure)
              }
            },
            created_at: endedAt
          }
        };
      } catch (error) {
        const endedAt = nowIso();
        const failure = normalizeFailure(error, {
          attempt,
          startedAt: attemptStartedAt,
          endedAt,
          retryOnTimeout: executionPolicy.retry_on_timeout ?? true
        });
        failures.push(failure);

        const willRetry = failure.retryable && attempt < maxAttempts;
        debugLog("tool", willRetry ? "Tool execution failed, retry scheduled" : "Tool execution failed", {
          sessionId: ctx.session_id,
          cycleId: ctx.cycle_id,
          toolName: tool.name,
          actionId: action.action_id,
          attempt,
          maxAttempts,
          errorType: failure.error_type,
          retryable: failure.retryable,
          willRetry,
          message: failure.message
        });

        if (!willRetry) {
          return this.buildFailureOutcome({
            action,
            ctx,
            startedAt,
            endedAt,
            failures,
            executionPolicy,
            toolName: tool.name
          });
        }

        const baseDelay = executionPolicy.retry_backoff_ms ?? 0;
        if (baseDelay > 0) {
          const expDelay = baseDelay * Math.pow(2, attempt - 1);
          const jitter = Math.random() * baseDelay * 0.5;
          await sleep(expDelay + jitter);
        }
      }
    }

    return this.buildFailureOutcome({
      action,
      ctx,
      startedAt,
      endedAt: nowIso(),
      failures,
      executionPolicy,
      toolName: action.tool_name
    });
  }

  private async invokeTool(
    tool: Tool,
    input: Record<string, unknown>,
    ctx: ToolContext,
    attempt: number,
    executionPolicy: ToolExecutionPolicy
  ): Promise<ToolResult> {
    const timeoutMs = executionPolicy.timeout_ms;
    if (!timeoutMs || timeoutMs <= 0) {
      return tool.invoke(input, { ...ctx, attempt });
    }

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        tool.invoke(input, {
          ...ctx,
          attempt,
          signal: controller.signal
        }),
        new Promise<ToolResult>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(
              new ToolInvocationError(
                "timeout",
                `Tool ${tool.name} timed out after ${timeoutMs}ms.`,
                executionPolicy.retry_on_timeout ?? true
              )
            );
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ToolInvocationError(
          "timeout",
          `Tool ${tool.name} timed out after ${timeoutMs}ms.`,
          executionPolicy.retry_on_timeout ?? true
        );
      }

      if (error instanceof ToolInvocationError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new ToolInvocationError("invoke_error", error.message, true);
      }

      throw new ToolInvocationError(
        "invoke_error",
        "Tool invocation failed with a non-Error exception.",
        true
      );
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private buildFailureOutcome(input: {
    action: CandidateAction;
    ctx: ToolContext;
    startedAt: string;
    endedAt: string;
    failures: ToolAttemptFailure[];
    executionPolicy: ToolExecutionPolicy;
    toolName?: string;
  }): { execution: ActionExecution; observation: Observation } {
    const lastFailure = input.failures.at(-1) ?? createImmediateFailure("invoke_error", "Unknown tool failure.");
    const toolName = input.toolName ?? input.action.tool_name ?? "unknown_tool";
    const attemptCount = input.failures.length;
    const retryCount = Math.max(0, attemptCount - 1);
    const summary = buildFailureSummary(toolName, attemptCount, lastFailure);

    return {
      execution: {
        execution_id: generateId("exe"),
        session_id: input.ctx.session_id,
        cycle_id: input.ctx.cycle_id,
        action_id: input.action.action_id,
        status: "failed",
        started_at: input.startedAt,
        ended_at: input.endedAt,
        executor: "tool_gateway",
        error_ref: `${lastFailure.error_type}:${lastFailure.message}`,
        metrics: {
          latency_ms: computeLatencyMs(input.startedAt, input.endedAt),
          attempt_count: attemptCount,
          retry_count: retryCount,
          timeout_ms: input.executionPolicy.timeout_ms
        }
      },
      observation: {
        observation_id: generateId("obs"),
        session_id: input.ctx.session_id,
        cycle_id: input.ctx.cycle_id,
        source_action_id: input.action.action_id,
        source_type: "tool",
        status: "failure",
        summary,
        structured_payload: {
          tool_name: toolName,
          tool_args: input.action.tool_args ?? {},
          __execution: {
            status: "failed",
            attempt_count: attemptCount,
            retry_count: retryCount,
            max_attempts: (input.executionPolicy.max_retries ?? 0) + 1,
            timeout_ms: input.executionPolicy.timeout_ms,
            final_error: {
              type: lastFailure.error_type,
              message: lastFailure.message
            },
            failures: input.failures.map(formatFailure)
          }
        },
        created_at: input.endedAt
      }
    };
  }
}

function resolveExecutionPolicy(
  defaults?: ToolExecutionPolicy,
  overrides?: ToolExecutionPolicy
): ToolExecutionPolicy {
  return {
    ...defaults,
    ...overrides
  };
}

function normalizeFailure(
  error: unknown,
  input: {
    attempt: number;
    startedAt: string;
    endedAt: string;
    retryOnTimeout: boolean;
  }
): ToolAttemptFailure {
  const latencyMs = computeLatencyMs(input.startedAt, input.endedAt);

  if (error instanceof ToolInvocationError) {
    return {
      attempt: input.attempt,
      error_type: error.errorType,
      message: error.message,
      retryable: error.errorType === "timeout" ? input.retryOnTimeout && error.retryable : error.retryable,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      latency_ms: latencyMs
    };
  }

  if (error instanceof Error) {
    return {
      attempt: input.attempt,
      error_type: "invoke_error",
      message: error.message,
      retryable: true,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      latency_ms: latencyMs
    };
  }

  return {
    attempt: input.attempt,
    error_type: "invoke_error",
    message: "Tool invocation failed with a non-Error exception.",
    retryable: true,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    latency_ms: latencyMs
  };
}

function buildFailureSummary(
  toolName: string,
  attemptCount: number,
  failure: ToolAttemptFailure
): string {
  const detail =
    failure.error_type === "timeout" ? `timed out` : `failed`;
  return `Tool ${toolName} ${detail} after ${attemptCount} attempt(s): ${failure.message}`;
}

function createImmediateFailure(
  errorType: ToolFailureType,
  message: string
): ToolAttemptFailure {
  const timestamp = nowIso();
  return {
    attempt: 1,
    error_type: errorType,
    message,
    retryable: false,
    started_at: timestamp,
    ended_at: timestamp,
    latency_ms: 0
  };
}

function formatFailure(failure: ToolAttemptFailure): Record<string, unknown> {
  return {
    attempt: failure.attempt,
    error_type: failure.error_type,
    message: failure.message,
    retryable: failure.retryable,
    started_at: failure.started_at,
    ended_at: failure.ended_at,
    latency_ms: failure.latency_ms
  };
}

function computeLatencyMs(startedAt: string, endedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return undefined;
  }
  return Math.max(0, end - start);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function validateArgs(args: Record<string, unknown>, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const required = schema.required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (!(key in args)) {
        errors.push(`Missing required property: ${key}`);
      }
    }
  }
  const properties = schema.properties;
  if (properties && typeof properties === "object") {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in args && propSchema && typeof propSchema === "object") {
        const type = (propSchema as Record<string, unknown>).type;
        if (type === "number" && typeof args[key] !== "number") {
          errors.push(`Property ${key} should be number, got ${typeof args[key]}`);
        }
        if (type === "string" && typeof args[key] !== "string") {
          errors.push(`Property ${key} should be string, got ${typeof args[key]}`);
        }
        if (type === "boolean" && typeof args[key] !== "boolean") {
          errors.push(`Property ${key} should be boolean, got ${typeof args[key]}`);
        }
      }
    }
  }
  return errors;
}
