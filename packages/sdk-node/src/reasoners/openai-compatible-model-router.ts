import type {
  CandidateAction,
  ModuleContext,
  Proposal,
  Reasoner
} from "@neurocore/protocol";
import type { OpenAICompatibleConfig } from "../config/openai-compatible-config.js";
import { debugLog } from "../debug.js";
import {
  OpenAICompatibleReasoner,
  type OpenAICompatibleReasonerOptions
} from "./openai-compatible-reasoner.js";

export interface OpenAICompatibleModelProviderConfig extends OpenAICompatibleConfig {
  id: string;
  label?: string;
  fallbackProviderIds?: string[];
}

export interface OpenAICompatibleProviderSummary {
  id: string;
  label?: string;
  provider: "openai-compatible";
  model: string;
  apiUrl: string;
  fallbackProviderIds: string[];
}

export interface OpenAICompatibleProviderHealthReport {
  provider_id: string;
  provider: "openai-compatible";
  model: string;
  api_url: string;
  ok: boolean;
  status?: number;
  status_text?: string;
  latency_ms: number;
  failure_mode?: "timeout" | "rate_limit" | "auth" | "server_error" | "bad_response" | "network_error";
  error_message?: string;
}

export interface OpenAICompatibleProviderRegistryOptions {
  defaultProviderId?: string;
  providers: OpenAICompatibleModelProviderConfig[];
  fetch?: typeof fetch;
}

export class OpenAICompatibleProviderRegistry {
  private readonly providers = new Map<string, OpenAICompatibleModelProviderConfig>();
  public readonly defaultProviderId: string;
  private readonly fetchImpl?: typeof fetch;

  public constructor(options: OpenAICompatibleProviderRegistryOptions) {
    if (options.providers.length === 0) {
      throw new Error("At least one model provider is required.");
    }

    for (const provider of options.providers) {
      if (!provider.id.trim()) {
        throw new Error("Model provider id is required.");
      }
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate model provider id: ${provider.id}`);
      }
      this.providers.set(provider.id, { ...provider });
    }

    const defaultProviderId = options.defaultProviderId ?? options.providers[0]?.id;
    if (!defaultProviderId || !this.providers.has(defaultProviderId)) {
      throw new Error(`Unknown default model provider: ${defaultProviderId ?? "n/a"}`);
    }

    this.defaultProviderId = defaultProviderId;
    this.fetchImpl = options.fetch;
  }

  public getProvider(providerId?: string): OpenAICompatibleModelProviderConfig {
    const id = providerId && this.providers.has(providerId) ? providerId : this.defaultProviderId;
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Unknown model provider: ${id}`);
    }
    return { ...provider, headers: provider.headers ? { ...provider.headers } : undefined };
  }

  public listProviderSummaries(): OpenAICompatibleProviderSummary[] {
    return Array.from(this.providers.values()).map((provider) => ({
      id: provider.id,
      label: provider.label,
      provider: provider.provider,
      model: provider.model,
      apiUrl: provider.apiUrl,
      fallbackProviderIds: [...(provider.fallbackProviderIds ?? [])]
    }));
  }

  public resolveFallbackChain(providerId?: string): OpenAICompatibleModelProviderConfig[] {
    const primary = this.getProvider(providerId).id;
    const primaryProvider = this.getProvider(primary);
    const explicitFallbackIds = primaryProvider.fallbackProviderIds ?? [];
    const ids = [
      primary,
      ...explicitFallbackIds,
      ...Array.from(this.providers.keys()).filter((id) => id !== primary && !explicitFallbackIds.includes(id))
    ];
    return ids.map((id) => this.getProvider(id));
  }

  public async healthCheck(providerId?: string): Promise<OpenAICompatibleProviderHealthReport> {
    return probeOpenAICompatibleProviderHealth(this.getProvider(providerId), {
      fetch: this.fetchImpl
    });
  }
}

export interface OpenAICompatibleModelRouterReasonerOptions extends OpenAICompatibleReasonerOptions {
  registry: OpenAICompatibleProviderRegistry;
}

export class OpenAICompatibleModelRouterReasoner implements Reasoner {
  public readonly name = "openai-compatible-model-router";
  private readonly strictReasoners = new Map<string, OpenAICompatibleReasoner>();
  private readonly actionProviderIds = new WeakMap<CandidateAction, string>();
  private readonly directResponses = new WeakMap<CandidateAction, string>();

  public constructor(private readonly options: OpenAICompatibleModelRouterReasonerOptions) {}

  public async plan(ctx: ModuleContext): Promise<Proposal[]> {
    const requestedProviderId = getRequestedProviderId(ctx);
    const failures: OpenAICompatibleProviderAttemptFailure[] = [];
    for (const provider of this.options.registry.resolveFallbackChain(requestedProviderId)) {
      try {
        const proposals = await this.getStrictReasoner(provider).plan(ctx);
        this.recordProviderSelection(ctx, "plan", requestedProviderId, provider.id, failures);
        return proposals.map((proposal) => ({
          ...proposal,
          module_name: this.name
        }));
      } catch (error) {
        failures.push(toAttemptFailure(provider.id, error));
        debugLog("reasoner", "Model provider planning attempt failed", {
          providerId: provider.id,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.recordProviderSelection(ctx, "plan", requestedProviderId, undefined, failures);
    return [this.createLocalFallbackProposal(ctx, failures.at(-1)?.error_message)];
  }

  public async respond(ctx: ModuleContext): Promise<CandidateAction[]> {
    const requestedProviderId = getRequestedProviderId(ctx);
    const failures: OpenAICompatibleProviderAttemptFailure[] = [];
    for (const provider of this.options.registry.resolveFallbackChain(requestedProviderId)) {
      try {
        const actions = await this.getStrictReasoner(provider).respond(ctx);
        for (const action of actions) {
          this.actionProviderIds.set(action, provider.id);
        }
        this.recordProviderSelection(ctx, "respond", requestedProviderId, provider.id, failures);
        return actions;
      } catch (error) {
        failures.push(toAttemptFailure(provider.id, error));
        debugLog("reasoner", "Model provider response attempt failed", {
          providerId: provider.id,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.recordProviderSelection(ctx, "respond", requestedProviderId, undefined, failures);
    const action = this.createLocalFallbackAction(ctx, failures.at(-1)?.error_message);
    this.directResponses.set(action, action.description ?? action.title);
    return [action];
  }

  public async *streamText(ctx: ModuleContext, action: CandidateAction): AsyncIterable<string> {
    const directResponse = this.directResponses.get(action);
    if (directResponse) {
      yield directResponse;
      return;
    }

    const providerId = this.actionProviderIds.get(action) ?? getRequestedProviderId(ctx);
    const failures: OpenAICompatibleProviderAttemptFailure[] = [];
    for (const provider of this.options.registry.resolveFallbackChain(providerId)) {
      let emitted = false;
      try {
        for await (const chunk of this.getStrictReasoner(provider).streamText(ctx, action)) {
          emitted = true;
          yield chunk;
        }
        this.recordProviderSelection(ctx, "stream", providerId, provider.id, failures);
        return;
      } catch (error) {
        if (emitted) {
          throw error;
        }
        failures.push(toAttemptFailure(provider.id, error));
        debugLog("reasoner", "Model provider stream attempt failed", {
          providerId: provider.id,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }
    throw new Error(formatProviderFailures("Model stream request failed for all providers", failures));
  }

  public getRegistry(): OpenAICompatibleProviderRegistry {
    return this.options.registry;
  }

  private getStrictReasoner(provider: OpenAICompatibleModelProviderConfig): OpenAICompatibleReasoner {
    const existing = this.strictReasoners.get(provider.id);
    if (existing) {
      return existing;
    }

    const reasoner = new OpenAICompatibleReasoner(provider, {
      temperature: this.options.temperature,
      max_tokens: this.options.max_tokens,
      maxOutputTokens: this.options.maxOutputTokens,
      fetch: this.options.fetch,
      disableLocalFallback: true
    });
    this.strictReasoners.set(provider.id, reasoner);
    return reasoner;
  }

  private createLocalFallbackProposal(
    ctx: ModuleContext,
    errorMessage: string | undefined
  ): Proposal {
    const goalTitles = ctx.goals.map((goal) => goal.title).filter(Boolean);
    const summary =
      goalTitles.length > 0
        ? `Pursue active goals: ${goalTitles.join("; ")}`
        : `Act according to role: ${ctx.profile.role}`;

    return {
      proposal_id: ctx.services.generateId("prp"),
      schema_version: ctx.profile.schema_version,
      session_id: ctx.session.session_id,
      cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
      module_name: this.name,
      proposal_type: "plan",
      salience_score: 0.55,
      confidence: 0.5,
      risk: 0.15,
      payload: {
        summary,
        provider_error: errorMessage
      },
      explanation: "Fallback local plan after all configured model providers failed."
    };
  }

  private createLocalFallbackAction(
    ctx: ModuleContext,
    errorMessage: string | undefined
  ): CandidateAction {
    const quota = errorMessage ? isProviderQuotaMessage(errorMessage) : false;
    return {
      action_id: ctx.services.generateId("act"),
      action_type: "ask_user",
      title: quota ? "Retry later" : "Retry the request",
      description: quota
        ? "All configured model providers rejected the request because quota or rate limits were exceeded. Retry later or narrow the task."
        : "All configured model providers failed before a valid action could be selected. Retry the request or narrow the task if it keeps happening.",
      expected_outcome: "Collect a request that can be retried safely.",
      side_effect_level: "none"
    };
  }

  private recordProviderSelection(
    ctx: ModuleContext,
    operation: "plan" | "respond" | "stream",
    requestedProviderId: string | undefined,
    selectedProviderId: string | undefined,
    failures: OpenAICompatibleProviderAttemptFailure[]
  ): void {
    const sessionMetadata = ctx.session.metadata && typeof ctx.session.metadata === "object"
      ? ctx.session.metadata
      : {};
    ctx.session.metadata = sessionMetadata;
    const routerMetadata = ensureRecord(sessionMetadata, "model_provider_router");
    routerMetadata.last_operation = operation;
    routerMetadata.last_requested_provider_id = requestedProviderId ?? this.options.registry.defaultProviderId;
    routerMetadata.last_selected_provider_id = selectedProviderId ?? "local-fallback";
    routerMetadata.last_failure_count = failures.length;
    const events = Array.isArray(routerMetadata.events) ? routerMetadata.events : [];
    events.push({
      at: new Date().toISOString(),
      operation,
      requested_provider_id: requestedProviderId ?? this.options.registry.defaultProviderId,
      selected_provider_id: selectedProviderId ?? "local-fallback",
      failures
    });
    routerMetadata.events = events.slice(-50);
  }
}

export async function probeOpenAICompatibleProviderHealth(
  provider: OpenAICompatibleModelProviderConfig,
  options: { fetch?: typeof fetch } = {}
): Promise<OpenAICompatibleProviderHealthReport> {
  const startedAt = Date.now();
  const timeoutMs = provider.jsonTimeoutMs ?? provider.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Model health check timed out after ${timeoutMs}ms.`)),
    timeoutMs
  );
  const url = resolveChatCompletionsUrl(provider.apiUrl);
  const fetchImpl = options.fetch ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.bearerToken}`,
        ...provider.headers
      },
      body: JSON.stringify({
        ...provider.extraBody,
        model: provider.model,
        temperature: 0,
        max_tokens: 1,
        messages: [
          { role: "system", content: "Reply with ok." },
          { role: "user", content: "health" }
        ]
      }),
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        provider_id: provider.id,
        provider: provider.provider,
        model: provider.model,
        api_url: provider.apiUrl,
        ok: false,
        status: response.status,
        status_text: response.statusText,
        latency_ms: latencyMs,
        failure_mode: classifyHttpFailure(response.status),
        error_message: body.slice(0, 300)
      };
    }

    return {
      provider_id: provider.id,
      provider: provider.provider,
      model: provider.model,
      api_url: provider.apiUrl,
      ok: true,
      status: response.status,
      status_text: response.statusText,
      latency_ms: latencyMs
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      provider_id: provider.id,
      provider: provider.provider,
      model: provider.model,
      api_url: provider.apiUrl,
      ok: false,
      latency_ms: latencyMs,
      failure_mode: isTimeoutError(error) ? "timeout" : "network_error",
      error_message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface OpenAICompatibleProviderAttemptFailure {
  provider_id: string;
  failure_mode: OpenAICompatibleProviderHealthReport["failure_mode"];
  error_message: string;
}

function getRequestedProviderId(ctx: ModuleContext): string | undefined {
  const inputMetadata = asRecord(ctx.runtime_state.current_input_metadata);
  const directInputProvider = inputMetadata ? getString(inputMetadata.model_provider_id) : undefined;
  if (directInputProvider) {
    return directInputProvider;
  }

  const namespacedInput = asRecord(inputMetadata?.personal_assistant);
  const namespacedInputProvider = namespacedInput ? getString(namespacedInput.model_provider_id) : undefined;
  if (namespacedInputProvider) {
    return namespacedInputProvider;
  }

  const sessionMetadata = asRecord(ctx.session.metadata);
  const personalAssistant = asRecord(sessionMetadata?.personal_assistant);
  return personalAssistant ? getString(personalAssistant.model_provider_id) : undefined;
}

function toAttemptFailure(
  providerId: string,
  error: unknown
): OpenAICompatibleProviderAttemptFailure {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    provider_id: providerId,
    failure_mode: classifyErrorMessage(errorMessage),
    error_message: errorMessage
  };
}

function formatProviderFailures(
  prefix: string,
  failures: OpenAICompatibleProviderAttemptFailure[]
): string {
  return `${prefix}: ${failures.map((failure) => `${failure.provider_id}=${failure.error_message}`).join("; ")}`;
}

function resolveChatCompletionsUrl(apiUrl: string): string {
  const normalized = apiUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function classifyHttpFailure(status: number): OpenAICompatibleProviderHealthReport["failure_mode"] {
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "bad_response";
}

function classifyErrorMessage(message: string): OpenAICompatibleProviderHealthReport["failure_mode"] {
  const lowered = message.toLowerCase();
  if (lowered.includes("timed out") || lowered.includes("timeout") || lowered.includes("abort")) {
    return "timeout";
  }
  if (lowered.includes("429") || lowered.includes("quota") || lowered.includes("rate limit") || lowered.includes("throttl")) {
    return "rate_limit";
  }
  if (lowered.includes("401") || lowered.includes("403") || lowered.includes("auth")) {
    return "auth";
  }
  if (lowered.includes("500") || lowered.includes("502") || lowered.includes("503") || lowered.includes("504")) {
    return "server_error";
  }
  return "network_error";
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return classifyErrorMessage(error.message) === "timeout" || error.name === "AbortError";
}

function isProviderQuotaMessage(message: string): boolean {
  return classifyErrorMessage(message) === "rate_limit";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}
