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

type ToolFailureType =
  | "invalid_action"
  | "unknown_tool"
  | "timeout"
  | "invoke_transient_error"
  | "invoke_permanent_error"
  | "rate_limited"
  | "circuit_open";

interface ToolRateLimitWindow {
  window_ms: number;
  max_calls: number;
}

interface ToolAttemptFailure {
  attempt: number;
  error_type: ToolFailureType;
  message: string;
  retryable: boolean;
  started_at: string;
  ended_at: string;
  latency_ms?: number;
}

interface ToolCircuitState {
  state: "closed" | "open" | "half_open";
  consecutive_failures: number;
  opened_until?: number;
}

interface ToolCacheEntry {
  namespace: string;
  result: ToolResult;
  cached_at: string;
  expires_at: number;
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
  private readonly rateLimitHits = new Map<string, number[]>();
  private readonly circuitStates = new Map<string, ToolCircuitState>();
  private readonly resultCache = new Map<string, ToolCacheEntry>();

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
    const cachedResult = this.getCachedResult(action, tool.name, executionPolicy);
    if (cachedResult) {
      return this.buildCachedOutcome(action, ctx, cachedResult);
    }
    const circuitFailure = this.checkCircuitBreaker(tool.name, executionPolicy);
    if (circuitFailure) {
      return this.buildFailureOutcome({
        action,
        ctx,
        startedAt,
        endedAt: nowIso(),
        failures: [circuitFailure],
        executionPolicy,
        toolName: tool.name
      });
    }
    const rateLimitFailure = this.checkRateLimit(tool.name, ctx, executionPolicy);
    if (rateLimitFailure) {
      return this.buildFailureOutcome({
        action,
        ctx,
        startedAt,
        endedAt: nowIso(),
        failures: [rateLimitFailure],
        executionPolicy,
        toolName: tool.name
      });
    }
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
        this.resetCircuitBreaker(tool.name);
        this.cacheResult(action, tool.name, result, executionPolicy);
        const invalidatedNamespaces = this.invalidateCacheNamespaces(executionPolicy);

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
            mime_type: result.mime_type,
            content_parts: result.content_parts ? structuredClone(result.content_parts) : undefined,
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
                failures: failures.map(formatFailure),
                cache_invalidated_namespaces:
                  invalidatedNamespaces.length > 0 ? invalidatedNamespaces : undefined
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
          this.recordCircuitFailure(tool.name, failure, executionPolicy);
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
    try {
      if (!timeoutMs || timeoutMs <= 0) {
        return await tool.invoke(input, { ...ctx, attempt });
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
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    } catch (error) {
      if (timeoutMs && timeoutMs > 0 && error instanceof ToolInvocationError && error.errorType === "timeout") {
        throw new ToolInvocationError(
          "timeout",
          `Tool ${tool.name} timed out after ${timeoutMs}ms.`,
          executionPolicy.retry_on_timeout ?? true
        );
      }

      if (error instanceof ToolInvocationError) {
        throw error;
      }

      const classification = classifyToolError(error);
      throw new ToolInvocationError(
        classification.errorType,
        classification.message,
        classification.retryable
      );
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
    const lastFailure =
      input.failures.at(-1) ?? createImmediateFailure("invoke_transient_error", "Unknown tool failure.");
    const toolName = input.toolName ?? input.action.tool_name ?? "unknown_tool";
    const attemptCount = input.failures.length;
    const retryCount = Math.max(0, attemptCount - 1);
    const summary = buildFailureSummary(toolName, attemptCount, lastFailure);
    const circuitState = this.circuitStates.get(toolName);

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
            circuit_breaker: circuitState
              ? {
                  state: circuitState.state,
                  consecutive_failures: circuitState.consecutive_failures,
                  opened_until:
                    typeof circuitState.opened_until === "number"
                      ? new Date(circuitState.opened_until).toISOString()
                      : undefined
                }
              : undefined,
            failures: input.failures.map(formatFailure)
          }
        },
        created_at: input.endedAt
      }
    };
  }

  private checkRateLimit(
    toolName: string,
    ctx: ToolContext,
    executionPolicy: ToolExecutionPolicy
  ): ToolAttemptFailure | undefined {
    const rateLimits = executionPolicy.rate_limits;
    if (!rateLimits) {
      return undefined;
    }

    const tenantLimit = rateLimits.per_tenant;
    if (tenantLimit) {
      const error = this.consumeRateLimit(`tenant:${ctx.tenant_id}`, tenantLimit, `Tenant ${ctx.tenant_id}`);
      if (error) {
        return error;
      }
    }

    const toolLimit = rateLimits.per_tool?.[toolName];
    if (toolLimit) {
      const error = this.consumeRateLimit(`tool:${toolName}`, toolLimit, `Tool ${toolName}`);
      if (error) {
        return error;
      }
    }

    return undefined;
  }

  private consumeRateLimit(key: string, limit: ToolRateLimitWindow, label: string): ToolAttemptFailure | undefined {
    const windowMs = limit.window_ms;
    const maxCalls = limit.max_calls;
    if (!Number.isFinite(windowMs) || !Number.isFinite(maxCalls) || windowMs <= 0 || maxCalls <= 0) {
      return undefined;
    }

    const now = Date.now();
    const windowStart = now - windowMs;
    const current = (this.rateLimitHits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (current.length >= maxCalls) {
      return createImmediateFailure(
        "rate_limited",
        `${label} rate limit exceeded (${current.length}/${maxCalls} in ${windowMs}ms).`
      );
    }
    current.push(now);
    this.rateLimitHits.set(key, current);
    return undefined;
  }

  private checkCircuitBreaker(
    toolName: string,
    executionPolicy: ToolExecutionPolicy
  ): ToolAttemptFailure | undefined {
    const state = this.circuitStates.get(toolName);
    if (!state || state.state !== "open") {
      return undefined;
    }

    const now = Date.now();
    if (typeof state.opened_until === "number" && state.opened_until > now) {
      return createImmediateFailure(
        "circuit_open",
        `Tool ${toolName} circuit breaker is open until ${new Date(state.opened_until).toISOString()}.`
      );
    }

    state.state = "half_open";
    state.opened_until = undefined;
    this.circuitStates.set(toolName, state);
    return undefined;
  }

  private resetCircuitBreaker(toolName: string): void {
    this.circuitStates.set(toolName, {
      state: "closed",
      consecutive_failures: 0
    });
  }

  private recordCircuitFailure(
    toolName: string,
    failure: ToolAttemptFailure,
    executionPolicy: ToolExecutionPolicy
  ): void {
    if (!shouldCountForCircuitBreaker(failure)) {
      return;
    }

    const threshold = executionPolicy.circuit_breaker_failure_threshold ?? 0;
    const openMs = executionPolicy.circuit_breaker_open_ms ?? 0;
    if (threshold <= 0 || openMs <= 0) {
      return;
    }

    const state = this.circuitStates.get(toolName) ?? {
      state: "closed" as const,
      consecutive_failures: 0
    };

    if (state.state === "half_open") {
      state.state = "open";
      state.consecutive_failures = threshold;
      state.opened_until = Date.now() + openMs;
      this.circuitStates.set(toolName, state);
      return;
    }

    state.consecutive_failures += 1;
    if (state.consecutive_failures >= threshold) {
      state.state = "open";
      state.opened_until = Date.now() + openMs;
    } else {
      state.state = "closed";
      state.opened_until = undefined;
    }
    this.circuitStates.set(toolName, state);
  }

  private getCachedResult(
    action: CandidateAction,
    toolName: string,
    executionPolicy: ToolExecutionPolicy
  ): ToolCacheEntry | undefined {
    const cacheKey = toToolCacheKey(
      resolveCacheNamespace(toolName, executionPolicy),
      toolName,
      action.idempotency_key
    );
    if (!cacheKey) {
      return undefined;
    }

    const entry = this.resultCache.get(cacheKey);
    if (!entry) {
      return undefined;
    }

    if (entry.expires_at <= Date.now()) {
      this.resultCache.delete(cacheKey);
      return undefined;
    }

    if (!executionPolicy.cache_ttl_ms || executionPolicy.cache_ttl_ms <= 0) {
      this.resultCache.delete(cacheKey);
      return undefined;
    }

    return entry;
  }

  private cacheResult(
    action: CandidateAction,
    toolName: string,
    result: ToolResult,
    executionPolicy: ToolExecutionPolicy
  ): void {
    const namespace = resolveCacheNamespace(toolName, executionPolicy);
    const cacheKey = toToolCacheKey(namespace, toolName, action.idempotency_key);
    const ttlMs = executionPolicy.cache_ttl_ms;
    if (!cacheKey || !ttlMs || ttlMs <= 0) {
      return;
    }

    this.resultCache.set(cacheKey, {
      namespace,
      result: structuredClone(result),
      cached_at: nowIso(),
      expires_at: Date.now() + ttlMs
    });
  }

  private invalidateCacheNamespaces(executionPolicy: ToolExecutionPolicy): string[] {
    const namespaces = (executionPolicy.invalidate_cache_namespaces ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (namespaces.length === 0) {
      return [];
    }

    const invalidateAll = namespaces.includes("*");
    for (const [cacheKey, entry] of this.resultCache.entries()) {
      if (invalidateAll || namespaces.includes(entry.namespace)) {
        this.resultCache.delete(cacheKey);
      }
    }
    return invalidateAll ? ["*"] : [...new Set(namespaces)];
  }

  private buildCachedOutcome(
    action: CandidateAction,
    ctx: ToolContext,
    entry: ToolCacheEntry
  ): { execution: ActionExecution; observation: Observation } {
    const timestamp = nowIso();
    return {
      execution: {
        execution_id: generateId("exe"),
        session_id: ctx.session_id,
        cycle_id: ctx.cycle_id,
        action_id: action.action_id,
        status: "succeeded",
        started_at: timestamp,
        ended_at: timestamp,
        executor: "tool_gateway",
        result_ref: `${action.tool_name ?? "tool"}:cache_hit`,
        metrics: {
          latency_ms: 0,
          attempt_count: 0,
          retry_count: 0
        }
      },
      observation: {
        observation_id: generateId("obs"),
        session_id: ctx.session_id,
        cycle_id: ctx.cycle_id,
        source_action_id: action.action_id,
        source_type: "tool",
        status: "success",
        summary: entry.result.summary,
        mime_type: entry.result.mime_type,
        content_parts: entry.result.content_parts ? structuredClone(entry.result.content_parts) : undefined,
        structured_payload: {
          ...(entry.result.payload ?? {}),
          tool_name: action.tool_name ?? null,
          tool_args: action.tool_args ?? {},
          __execution: {
            status: "succeeded",
            cache_hit: true,
            cached_at: entry.cached_at
          }
        },
        created_at: timestamp
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

function resolveCacheNamespace(toolName: string, executionPolicy: ToolExecutionPolicy): string {
  const configured = executionPolicy.cache_namespace?.trim();
  return configured && configured.length > 0 ? configured : toolName;
}

function toToolCacheKey(
  namespace: string,
  toolName: string,
  idempotencyKey: string | undefined
): string | undefined {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    return undefined;
  }
  return `${namespace}:${toolName}:${idempotencyKey.trim()}`;
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
      error_type: "invoke_transient_error",
      message: error.message,
      retryable: true,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      latency_ms: latencyMs
    };
  }

  return {
    attempt: input.attempt,
    error_type: "invoke_transient_error",
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
    failure.error_type === "timeout"
      ? "timed out"
      : failure.error_type === "circuit_open"
        ? "circuit is open"
        : failure.error_type === "invoke_permanent_error"
          ? "failed permanently"
          : "failed";
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

function classifyToolError(error: unknown): {
  errorType: ToolFailureType;
  message: string;
  retryable: boolean;
} {
  if (error instanceof Error) {
    const status = readNumericField(error, ["status", "statusCode"]);
    const code = readStringField(error, ["code", "errno"]);
    const transient = readBooleanField(error, ["transient", "isTransient"]);
    const permanent = readBooleanField(error, ["permanent", "isPermanent"]);
    const retryable = readBooleanField(error, ["retryable"]);

    if (permanent === true || transient === false || retryable === false) {
      return {
        errorType: "invoke_permanent_error",
        message: error.message,
        retryable: false
      };
    }

    if (transient === true || isTransientStatus(status) || isTransientCode(code)) {
      return {
        errorType: "invoke_transient_error",
        message: error.message,
        retryable: true
      };
    }

    if (isPermanentStatus(status)) {
      return {
        errorType: "invoke_permanent_error",
        message: error.message,
        retryable: false
      };
    }

    return {
      errorType: "invoke_transient_error",
      message: error.message,
      retryable: true
    };
  }

  return {
    errorType: "invoke_transient_error",
    message: "Tool invocation failed with a non-Error exception.",
    retryable: true
  };
}

function shouldCountForCircuitBreaker(failure: ToolAttemptFailure): boolean {
  return (
    failure.error_type === "timeout" ||
    failure.error_type === "invoke_transient_error" ||
    failure.error_type === "invoke_permanent_error"
  );
}

function isPermanentStatus(status: number | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 409, 423, 425, 429].includes(status);
}

function isTransientStatus(status: number | undefined): boolean {
  return typeof status === "number" && ([408, 409, 423, 425, 429].includes(status) || status >= 500);
}

function isTransientCode(code: string | undefined): boolean {
  return typeof code === "string" && [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ECONNABORTED",
    "EPIPE",
    "EAI_AGAIN",
    "ENOTFOUND"
  ].includes(code);
}

function readNumericField(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function readStringField(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function readBooleanField(value: unknown, keys: string[]): boolean | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return undefined;
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
