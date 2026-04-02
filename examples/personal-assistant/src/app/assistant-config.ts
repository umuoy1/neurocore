import { join } from "node:path";
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
    approvers?: string[];
    blocked_tools?: string[];
    required_approval_tools?: string[];
  };
  connectors?: ServiceConnectorConfig;
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
  proactive?: {
    enabled?: boolean;
    heartbeat_interval_ms?: number;
    checks?: HeartbeatCheck[];
    schedules?: ScheduleEntry[];
  };
}

export function createPersonalAssistantConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PersonalAssistantAppConfig {
  return {
    db_path: env.PERSONAL_ASSISTANT_DB_PATH ?? join(process.cwd(), ".neurocore", "personal-assistant.sqlite"),
    tenant_id: env.PERSONAL_ASSISTANT_TENANT_ID ?? "local",
    agent: {
      id: env.PERSONAL_ASSISTANT_AGENT_ID ?? "personal-assistant",
      name: env.PERSONAL_ASSISTANT_AGENT_NAME ?? "NeuroCore Assistant",
      role: env.PERSONAL_ASSISTANT_AGENT_ROLE ?? "Personal assistant for messaging, search, and lightweight task execution.",
      token_budget: parseOptionalInt(env.PERSONAL_ASSISTANT_TOKEN_BUDGET),
      max_cycles: parseOptionalInt(env.PERSONAL_ASSISTANT_MAX_CYCLES),
      approvers: env.PERSONAL_ASSISTANT_APPROVERS?.split(",").map((item) => item.trim()).filter(Boolean),
      blocked_tools: env.PERSONAL_ASSISTANT_BLOCKED_TOOLS?.split(",").map((item) => item.trim()).filter(Boolean),
      required_approval_tools: env.PERSONAL_ASSISTANT_APPROVAL_TOOLS?.split(",").map((item) => item.trim()).filter(Boolean)
    },
    openai: env.OPENAI_API_KEY && env.OPENAI_BASE_URL && env.OPENAI_MODEL
      ? {
          apiUrl: env.OPENAI_BASE_URL,
          bearerToken: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL
        }
      : undefined,
    connectors: {
      search: env.BRAVE_SEARCH_API_KEY
        ? {
            apiKey: env.BRAVE_SEARCH_API_KEY
          }
        : undefined,
      browser: {}
    },
    web_chat: {
      enabled: env.WEB_CHAT_ENABLED !== "false",
      host: env.WEB_CHAT_HOST ?? "127.0.0.1",
      port: parseOptionalInt(env.WEB_CHAT_PORT) ?? 3301,
      path: env.WEB_CHAT_PATH ?? "/chat"
    },
    feishu: {
      enabled: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
      ws_url: env.FEISHU_WS_URL
    }
  };
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
