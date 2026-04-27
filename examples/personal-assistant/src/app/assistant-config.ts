import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { OpenAICompatibleConfig } from "@neurocore/sdk-node";
import type { Reasoner } from "@neurocore/protocol";
import type { CreateStandingOrderInput, HeartbeatCheck, ScheduleEntry } from "../proactive/types.js";
import type { ServiceConnectorConfig } from "../connectors/types.js";
import type { PersonalMcpServerConfig } from "../mcp/personal-mcp-client.js";
import type { PersonalAssistantSandboxConfig, SandboxTarget } from "../sandbox/sandbox-provider.js";
import type { IMPlatform } from "../im-gateway/types.js";

export interface PersonalAssistantAppConfig {
  db_path: string;
  tenant_id: string;
  idle_timeout_ms?: number;
  reasoner?: Reasoner;
  openai?: {
    apiUrl: string;
    bearerToken: string;
    model: string;
    timeoutMs?: number;
    jsonTimeoutMs?: number;
    streamTimeoutMs?: number;
    headers?: Record<string, string>;
    extraBody?: Record<string, unknown>;
  };
  agent?: {
    id?: string;
    name?: string;
    role?: string;
    token_budget?: number;
    max_cycles?: number;
    auto_approve?: boolean;
    approvers?: string[];
    blocked_tools?: string[];
    required_approval_tools?: string[];
  };
  identity?: {
    require_pairing?: boolean;
    require_pairing_platforms?: IMPlatform[];
    pairing_code_ttl_ms?: number;
  };
  connectors?: ServiceConnectorConfig;
  cli?: {
    enabled?: boolean;
    user_id?: string;
    chat_id?: string;
  };
  web_chat?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    path?: string;
  };
  feishu?: {
    enabled?: boolean;
    app_id?: string;
    app_secret?: string;
    ws_url?: string;
  };
  telegram?: {
    enabled?: boolean;
    bot_token?: string;
    api_base_url?: string;
    webhook_secret?: string;
    allowed_senders?: string[];
  };
  slack?: {
    enabled?: boolean;
    bot_token?: string;
    signing_secret?: string;
    api_base_url?: string;
    allowed_senders?: string[];
  };
  discord?: {
    enabled?: boolean;
    bot_token?: string;
    api_base_url?: string;
    allowed_senders?: string[];
  };
  skills?: {
    enabled?: boolean;
    directories?: string[];
  };
  mcp?: {
    enabled?: boolean;
    servers?: PersonalMcpServerConfig[];
  };
  sandbox?: PersonalAssistantSandboxConfig;
  proactive?: {
    enabled?: boolean;
    heartbeat_interval_ms?: number;
    checks?: HeartbeatCheck[];
    schedules?: ScheduleEntry[];
    standing_orders?: CreateStandingOrderInput[];
  };
}

const ROOT_CONFIG_DIR = ".neurocore";
const DEFAULT_JSON_TIMEOUT_MS = 45_000;
const PERSONAL_ASSISTANT_CONFIG_DIR = join(ROOT_CONFIG_DIR, ".personal-assistant");
const ROOT_LLM_CONFIG_PATH = join(ROOT_CONFIG_DIR, "llm.local.json");
const PERSONAL_ASSISTANT_APP_CONFIG_FILES = [
  join(PERSONAL_ASSISTANT_CONFIG_DIR, "app.local.json"),
  join(PERSONAL_ASSISTANT_CONFIG_DIR, "config.local.json"),
  join(PERSONAL_ASSISTANT_CONFIG_DIR, "config.json")
] as const;
const PERSONAL_ASSISTANT_LLM_CONFIG_FILES = [
  join(PERSONAL_ASSISTANT_CONFIG_DIR, "llm.local.json"),
  join(PERSONAL_ASSISTANT_CONFIG_DIR, "openai.local.json")
] as const;

export function createPersonalAssistantConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    cwd?: string;
  } = {}
): PersonalAssistantAppConfig {
  const cwd = options.cwd ?? process.cwd();
  const localConfig = loadLocalPersonalAssistantConfig(cwd);
  const appConfig = localConfig.appConfig;
  const openaiConfig = resolveOpenAIConfig(env, mergeOpenAIConfig(localConfig.llmConfig, appConfig.openai));
  const feishuAppId = env.FEISHU_APP_ID ?? appConfig.feishu?.app_id;
  const feishuAppSecret = env.FEISHU_APP_SECRET ?? appConfig.feishu?.app_secret;
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN ?? appConfig.telegram?.bot_token;
  const slackBotToken = env.SLACK_BOT_TOKEN ?? appConfig.slack?.bot_token;
  const discordBotToken = env.DISCORD_BOT_TOKEN ?? appConfig.discord?.bot_token;

  return {
    db_path: env.PERSONAL_ASSISTANT_DB_PATH ?? appConfig.db_path ?? join(cwd, ROOT_CONFIG_DIR, "personal-assistant.sqlite"),
    tenant_id: env.PERSONAL_ASSISTANT_TENANT_ID ?? appConfig.tenant_id ?? "local",
    idle_timeout_ms: parseOptionalInt(env.PERSONAL_ASSISTANT_IDLE_TIMEOUT_MS) ?? appConfig.idle_timeout_ms,
    reasoner: appConfig.reasoner,
    agent: {
      id: env.PERSONAL_ASSISTANT_AGENT_ID ?? appConfig.agent?.id ?? "personal-assistant",
      name: env.PERSONAL_ASSISTANT_AGENT_NAME ?? appConfig.agent?.name ?? "NeuroCore Assistant",
      role: env.PERSONAL_ASSISTANT_AGENT_ROLE ?? appConfig.agent?.role ?? "Personal assistant for messaging, search, and lightweight task execution.",
      token_budget: parseOptionalInt(env.PERSONAL_ASSISTANT_TOKEN_BUDGET) ?? appConfig.agent?.token_budget,
      max_cycles: parseOptionalInt(env.PERSONAL_ASSISTANT_MAX_CYCLES) ?? appConfig.agent?.max_cycles,
      auto_approve: parseOptionalBoolean(env.PERSONAL_ASSISTANT_AUTO_APPROVE) ?? appConfig.agent?.auto_approve,
      approvers: parseOptionalList(env.PERSONAL_ASSISTANT_APPROVERS) ?? appConfig.agent?.approvers,
      blocked_tools: parseOptionalList(env.PERSONAL_ASSISTANT_BLOCKED_TOOLS) ?? appConfig.agent?.blocked_tools,
      required_approval_tools: parseOptionalList(env.PERSONAL_ASSISTANT_APPROVAL_TOOLS) ?? appConfig.agent?.required_approval_tools
    },
    openai: openaiConfig,
    identity: {
      require_pairing: parseOptionalBoolean(env.PERSONAL_ASSISTANT_REQUIRE_PAIRING) ?? appConfig.identity?.require_pairing,
      require_pairing_platforms: parseOptionalPlatformList(env.PERSONAL_ASSISTANT_REQUIRE_PAIRING_PLATFORMS) ?? appConfig.identity?.require_pairing_platforms,
      pairing_code_ttl_ms: parseOptionalInt(env.PERSONAL_ASSISTANT_PAIRING_CODE_TTL_MS) ?? appConfig.identity?.pairing_code_ttl_ms
    },
    connectors: {
      search: env.BRAVE_SEARCH_API_KEY
        ? {
            apiKey: env.BRAVE_SEARCH_API_KEY
          }
        : appConfig.connectors?.search,
      browser: appConfig.connectors?.browser ?? {},
      email: appConfig.connectors?.email,
      calendar: appConfig.connectors?.calendar
    },
    cli: {
      enabled: parseOptionalBoolean(env.CLI_ENABLED) ?? appConfig.cli?.enabled ?? false,
      user_id: env.CLI_USER_ID ?? appConfig.cli?.user_id,
      chat_id: env.CLI_CHAT_ID ?? appConfig.cli?.chat_id
    },
    web_chat: {
      enabled: parseOptionalBoolean(env.WEB_CHAT_ENABLED) ?? appConfig.web_chat?.enabled ?? true,
      host: env.WEB_CHAT_HOST ?? appConfig.web_chat?.host ?? "127.0.0.1",
      port: parseOptionalInt(env.WEB_CHAT_PORT) ?? appConfig.web_chat?.port ?? 3301,
      path: env.WEB_CHAT_PATH ?? appConfig.web_chat?.path ?? "/chat"
    },
    feishu: {
      enabled: parseOptionalBoolean(env.FEISHU_ENABLED) ?? appConfig.feishu?.enabled ?? Boolean(feishuAppId && feishuAppSecret),
      app_id: feishuAppId,
      app_secret: feishuAppSecret,
      ws_url: env.FEISHU_WS_URL ?? appConfig.feishu?.ws_url
    },
    telegram: {
      enabled: parseOptionalBoolean(env.TELEGRAM_ENABLED) ?? appConfig.telegram?.enabled ?? Boolean(telegramBotToken),
      bot_token: telegramBotToken,
      api_base_url: env.TELEGRAM_API_BASE_URL ?? appConfig.telegram?.api_base_url,
      webhook_secret: env.TELEGRAM_WEBHOOK_SECRET ?? appConfig.telegram?.webhook_secret,
      allowed_senders: parseOptionalList(env.TELEGRAM_ALLOWED_SENDERS) ?? appConfig.telegram?.allowed_senders
    },
    slack: {
      enabled: parseOptionalBoolean(env.SLACK_ENABLED) ?? appConfig.slack?.enabled ?? Boolean(slackBotToken),
      bot_token: slackBotToken,
      signing_secret: env.SLACK_SIGNING_SECRET ?? appConfig.slack?.signing_secret,
      api_base_url: env.SLACK_API_BASE_URL ?? appConfig.slack?.api_base_url,
      allowed_senders: parseOptionalList(env.SLACK_ALLOWED_SENDERS) ?? appConfig.slack?.allowed_senders
    },
    discord: {
      enabled: parseOptionalBoolean(env.DISCORD_ENABLED) ?? appConfig.discord?.enabled ?? Boolean(discordBotToken),
      bot_token: discordBotToken,
      api_base_url: env.DISCORD_API_BASE_URL ?? appConfig.discord?.api_base_url,
      allowed_senders: parseOptionalList(env.DISCORD_ALLOWED_SENDERS) ?? appConfig.discord?.allowed_senders
    },
    skills: {
      enabled: parseOptionalBoolean(env.PERSONAL_ASSISTANT_SKILLS_ENABLED) ?? appConfig.skills?.enabled,
      directories: parseOptionalList(env.PERSONAL_ASSISTANT_SKILL_DIRS) ?? appConfig.skills?.directories
    },
    mcp: appConfig.mcp,
    sandbox: resolveSandboxConfig(env, appConfig.sandbox),
    proactive: appConfig.proactive
  };
}

function loadLocalPersonalAssistantConfig(cwd: string): {
  appConfig: Partial<PersonalAssistantAppConfig>;
  llmConfig?: PersonalAssistantAppConfig["openai"];
} {
  const appConfig = readFirstJsonObject<Partial<PersonalAssistantAppConfig>>(cwd, PERSONAL_ASSISTANT_APP_CONFIG_FILES) ?? {};
  const llmConfig = readFirstOpenAICompatibleConfig(cwd, [
    ...PERSONAL_ASSISTANT_LLM_CONFIG_FILES,
    ROOT_LLM_CONFIG_PATH
  ]);

  return {
    appConfig,
    llmConfig
  };
}

function resolveOpenAIConfig(
  env: NodeJS.ProcessEnv,
  fallback: PersonalAssistantAppConfig["openai"]
): PersonalAssistantAppConfig["openai"] | undefined {
  const apiUrl = env.OPENAI_BASE_URL ?? fallback?.apiUrl;
  const bearerToken = env.OPENAI_API_KEY ?? fallback?.bearerToken;
  const model = env.OPENAI_MODEL ?? fallback?.model;
  const timeoutMs = parseOptionalInt(env.OPENAI_TIMEOUT_MS) ?? fallback?.timeoutMs;

  if (!apiUrl || !bearerToken || !model) {
    return undefined;
  }

  return {
    apiUrl,
    bearerToken,
    model,
    timeoutMs,
    jsonTimeoutMs:
      parseOptionalInt(env.OPENAI_JSON_TIMEOUT_MS) ??
      fallback?.jsonTimeoutMs ??
      deriveJsonTimeoutMs(timeoutMs),
    streamTimeoutMs: parseOptionalInt(env.OPENAI_STREAM_TIMEOUT_MS) ?? fallback?.streamTimeoutMs ?? timeoutMs,
    headers: fallback?.headers,
    extraBody: fallback?.extraBody
  };
}

function mergeOpenAIConfig(
  base: PersonalAssistantAppConfig["openai"],
  override: PersonalAssistantAppConfig["openai"]
): PersonalAssistantAppConfig["openai"] | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    apiUrl: override?.apiUrl ?? base?.apiUrl ?? "",
    bearerToken: override?.bearerToken ?? base?.bearerToken ?? "",
    model: override?.model ?? base?.model ?? "",
    timeoutMs: override?.timeoutMs ?? base?.timeoutMs,
    jsonTimeoutMs: override?.jsonTimeoutMs ?? base?.jsonTimeoutMs,
    streamTimeoutMs: override?.streamTimeoutMs ?? base?.streamTimeoutMs,
    headers: override?.headers ?? base?.headers,
    extraBody: override?.extraBody ?? base?.extraBody
  };
}

function readFirstJsonObject<T>(cwd: string, relativePaths: readonly string[]): T | undefined {
  for (const relativePath of relativePaths) {
    const resolvedPath = resolve(cwd, relativePath);
    if (!existsSync(resolvedPath)) {
      continue;
    }

    return readJsonObject<T>(resolvedPath);
  }

  return undefined;
}

function readFirstOpenAICompatibleConfig(
  cwd: string,
  relativePaths: readonly string[]
): PersonalAssistantAppConfig["openai"] | undefined {
  for (const relativePath of relativePaths) {
    const resolvedPath = resolve(cwd, relativePath);
    if (!existsSync(resolvedPath)) {
      continue;
    }

    return readOpenAICompatibleConfig(resolvedPath);
  }

  return undefined;
}

function readJsonObject<T>(filePath: string): T {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read personal assistant config at ${filePath}: ${formatErrorMessage(error)}`
    );
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top-level value must be an object");
    }
    return parsed as T;
  } catch (error) {
    throw new Error(
      `Failed to parse personal assistant config at ${filePath}: ${formatErrorMessage(error)}`
    );
  }
}

function readOpenAICompatibleConfig(filePath: string): PersonalAssistantAppConfig["openai"] {
  const parsed = readJsonObject<Partial<OpenAICompatibleConfig> & { provider?: string }>(filePath);

  if (parsed.provider !== "openai-compatible") {
    throw new Error(
      `Invalid model config at ${filePath}: "provider" must be "openai-compatible".`
    );
  }
  if (!parsed.apiUrl) {
    throw new Error(`Invalid model config at ${filePath}: "apiUrl" is required.`);
  }
  if (!parsed.bearerToken) {
    throw new Error(`Invalid model config at ${filePath}: "bearerToken" is required.`);
  }
  if (!parsed.model) {
    throw new Error(`Invalid model config at ${filePath}: "model" is required.`);
  }

  return {
    apiUrl: parsed.apiUrl,
    bearerToken: parsed.bearerToken,
    model: parsed.model,
    timeoutMs: parsed.timeoutMs,
    jsonTimeoutMs: parsed.jsonTimeoutMs,
    streamTimeoutMs: parsed.streamTimeoutMs,
    headers: parsed.headers,
    extraBody: isPlainRecord(parsed.extraBody) ? parsed.extraBody : undefined
  };
}

function deriveJsonTimeoutMs(timeoutMs: number | undefined): number {
  return timeoutMs ? Math.min(timeoutMs, DEFAULT_JSON_TIMEOUT_MS) : DEFAULT_JSON_TIMEOUT_MS;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseOptionalList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseOptionalPlatformList(value: string | undefined): IMPlatform[] | undefined {
  const list = parseOptionalList(value);
  if (!list) {
    return undefined;
  }
  return list.filter(isSupportedPlatform) as IMPlatform[];
}

function isSupportedPlatform(value: string): value is IMPlatform {
  return value === "cli" || value === "discord" || value === "email" || value === "feishu" || value === "slack" || value === "telegram" || value === "web";
}

function resolveSandboxConfig(
  env: NodeJS.ProcessEnv,
  fallback: PersonalAssistantSandboxConfig | undefined
): PersonalAssistantSandboxConfig | undefined {
  const enabled = parseOptionalBoolean(env.PERSONAL_ASSISTANT_SANDBOX_ENABLED) ?? fallback?.enabled;
  if (enabled === undefined && !fallback) {
    return undefined;
  }

  return {
    ...fallback,
    enabled,
    default_target: parseSandboxTarget(env.PERSONAL_ASSISTANT_SANDBOX_TARGET) ?? fallback?.default_target,
    force_tools: parseOptionalList(env.PERSONAL_ASSISTANT_SANDBOX_FORCE_TOOLS) ?? fallback?.force_tools,
    local: {
      ...fallback?.local,
      cwd: env.PERSONAL_ASSISTANT_SANDBOX_LOCAL_CWD ?? fallback?.local?.cwd,
      shell: env.PERSONAL_ASSISTANT_SANDBOX_LOCAL_SHELL ?? fallback?.local?.shell
    },
    docker: {
      ...fallback?.docker,
      image: env.PERSONAL_ASSISTANT_SANDBOX_DOCKER_IMAGE ?? fallback?.docker?.image,
      host_workspace: env.PERSONAL_ASSISTANT_SANDBOX_DOCKER_HOST_WORKSPACE ?? fallback?.docker?.host_workspace,
      container_workspace: env.PERSONAL_ASSISTANT_SANDBOX_DOCKER_CONTAINER_WORKSPACE ?? fallback?.docker?.container_workspace,
      shell: env.PERSONAL_ASSISTANT_SANDBOX_DOCKER_SHELL ?? fallback?.docker?.shell
    },
    ssh: {
      ...fallback?.ssh,
      host: env.PERSONAL_ASSISTANT_SANDBOX_SSH_HOST ?? fallback?.ssh?.host,
      user: env.PERSONAL_ASSISTANT_SANDBOX_SSH_USER ?? fallback?.ssh?.user,
      port: parseOptionalInt(env.PERSONAL_ASSISTANT_SANDBOX_SSH_PORT) ?? fallback?.ssh?.port,
      workspace: env.PERSONAL_ASSISTANT_SANDBOX_SSH_WORKSPACE ?? fallback?.ssh?.workspace
    }
  };
}

function parseSandboxTarget(value: string | undefined): SandboxTarget | undefined {
  if (value === "local" || value === "docker" || value === "ssh") {
    return value;
  }
  return undefined;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
