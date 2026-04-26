import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { OpenAICompatibleConfig } from "@neurocore/sdk-node";
import type { Reasoner } from "@neurocore/protocol";
import type { HeartbeatCheck, ScheduleEntry } from "../proactive/types.js";
import type { ServiceConnectorConfig } from "../connectors/types.js";

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
    headers?: Record<string, string>;
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
  proactive?: {
    enabled?: boolean;
    heartbeat_interval_ms?: number;
    checks?: HeartbeatCheck[];
    schedules?: ScheduleEntry[];
  };
}

const ROOT_CONFIG_DIR = ".neurocore";
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

  if (!apiUrl || !bearerToken || !model) {
    return undefined;
  }

  return {
    apiUrl,
    bearerToken,
    model,
    timeoutMs: parseOptionalInt(env.OPENAI_TIMEOUT_MS) ?? fallback?.timeoutMs,
    headers: fallback?.headers
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
    headers: override?.headers ?? base?.headers
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
    headers: parsed.headers
  };
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
