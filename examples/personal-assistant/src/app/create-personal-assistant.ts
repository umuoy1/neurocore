import { defineAgent, type AgentBuilder } from "@neurocore/sdk-core";
import { OpenAICompatibleReasoner } from "@neurocore/sdk-node";
import type { Reasoner } from "@neurocore/protocol";
import { FeishuAdapter } from "../im-gateway/adapter/feishu.js";
import { WebChatAdapter } from "../im-gateway/adapter/web-chat.js";
import { SqliteApprovalBindingStore } from "../im-gateway/approval/sqlite-approval-binding-store.js";
import { CommandHandler } from "../im-gateway/command/command-handler.js";
import { ConversationRouter } from "../im-gateway/conversation/conversation-router.js";
import { SqlitePlatformUserLinkStore } from "../im-gateway/conversation/sqlite-platform-user-link-store.js";
import { SqliteSessionMappingStore } from "../im-gateway/conversation/sqlite-session-mapping-store.js";
import { IMGateway } from "../im-gateway/gateway.js";
import { NotificationDispatcher } from "../im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../im-gateway/runtime/assistant-runtime-factory.js";
import { SqlitePersonalMemoryStore } from "../memory/sqlite-personal-memory-store.js";
import { createWebBrowserTool } from "../connectors/browser/web-browser.js";
import { createCalendarReadTool } from "../connectors/calendar/calendar-read.js";
import { createCalendarWriteTool } from "../connectors/calendar/calendar-write.js";
import { createEmailReadTool } from "../connectors/email/email-read.js";
import { createEmailSendTool } from "../connectors/email/email-send.js";
import { createWebSearchTool } from "../connectors/search/web-search.js";
import { ProactiveEngine } from "../proactive/proactive-engine.js";
import type { PersonalAssistantAppConfig } from "./assistant-config.js";

export interface RunningPersonalAssistantApp {
  builder: AgentBuilder;
  gateway: IMGateway;
  proactive?: ProactiveEngine;
  close(): Promise<void>;
}

export function createPersonalAssistantAgent(config: PersonalAssistantAppConfig): AgentBuilder {
  const reasoner = resolveReasoner(config.reasoner, config.openai);
  const agent = defineAgent({
    id: config.agent?.id ?? "personal-assistant",
    name: config.agent?.name ?? "NeuroCore Assistant",
    role: config.agent?.role ?? "Personal assistant for messaging, search, and lightweight task execution."
  })
    .useReasoner(reasoner)
    .configureMemory({
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "hybrid",
      retrieval_top_k: 8
    })
    .configureRuntime({
      max_cycles: config.agent?.max_cycles ?? 8,
      checkpoint_interval: "cycle",
      auto_approve: config.agent?.auto_approve ?? false
    })
    .configurePolicy({
      blockedTools: config.agent?.blocked_tools,
      requiredApprovalTools: config.agent?.required_approval_tools
    });

  if (config.agent?.token_budget) {
    agent.withTokenBudget(config.agent.token_budget);
  }

  if (config.connectors?.search) {
    agent.registerTool(createWebSearchTool(config.connectors.search));
  }

  agent.registerTool(createWebBrowserTool(config.connectors?.browser));

  if (config.connectors?.email?.reader) {
    agent.registerTool(createEmailReadTool(config.connectors.email.reader));
  }
  if (config.connectors?.email?.sender) {
    agent.registerTool(createEmailSendTool(config.connectors.email.sender));
  }
  if (config.connectors?.calendar?.reader) {
    agent.registerTool(createCalendarReadTool(config.connectors.calendar.reader));
  }
  if (config.connectors?.calendar?.writer) {
    agent.registerTool(createCalendarWriteTool(config.connectors.calendar.writer));
  }

  if (config.agent?.approvers && config.agent.approvers.length > 0) {
    agent.configureApprovalPolicy({
      allowed_approvers: config.agent.approvers
    });
  }

  return agent;
}

export async function startPersonalAssistantApp(
  config: PersonalAssistantAppConfig
): Promise<RunningPersonalAssistantApp> {
  const runtimeFactory = new AssistantRuntimeFactory({
    dbPath: config.db_path,
    buildAgent: () => createPersonalAssistantAgent(config)
  });
  const builder = runtimeFactory.getBuilder();

  const mappingStore = new SqliteSessionMappingStore({ filename: config.db_path });
  const userLinkStore = new SqlitePlatformUserLinkStore({ filename: config.db_path });
  const approvalBindingStore = new SqliteApprovalBindingStore({ filename: config.db_path });
  const memoryStore = new SqlitePersonalMemoryStore({ filename: config.db_path });
  const resolveUserId = (message: { platform: "feishu" | "web"; sender_id: string }) =>
    userLinkStore.resolveCanonicalUserId(message.platform, message.sender_id) ?? message.sender_id;
  const router = new ConversationRouter({
    builder,
    tenantId: config.tenant_id,
    mappingStore,
    userLinkStore,
    idleTimeoutMs: config.idle_timeout_ms
  });

  let gatewayRef: IMGateway | undefined;
  const dispatcher = new NotificationDispatcher({
    getAdapter: (platform) => gatewayRef?.getAdapter(platform),
    mappingStore
  });
  const commandHandler = new CommandHandler({
    router,
    dispatcher,
    memoryStore,
    resolveUserId
  });

  const gateway = new IMGateway({
    builder,
    router,
    dispatcher,
    approvalBindingStore,
    commandHandler,
    memoryStore,
    resolveUserId
  });
  gatewayRef = gateway;

  if (config.web_chat?.enabled !== false) {
    gateway.registerAdapter(new WebChatAdapter(), {
      auth: {
        host: config.web_chat?.host ?? "127.0.0.1",
        port: String(config.web_chat?.port ?? 3301),
        path: config.web_chat?.path ?? "/chat"
      }
    });
  }

  if (config.feishu?.enabled && config.feishu.app_id && config.feishu.app_secret) {
    gateway.registerAdapter(new FeishuAdapter(), {
      auth: {
        app_id: config.feishu.app_id,
        app_secret: config.feishu.app_secret,
        ws_url: config.feishu.ws_url ?? ""
      }
    });
  }

  await gateway.start();

  let proactive: ProactiveEngine | undefined;
  if (config.proactive?.enabled) {
    proactive = new ProactiveEngine({
      agent: builder,
      gateway,
      tenantId: config.tenant_id
    });

    if (config.proactive.checks && config.proactive.checks.length > 0) {
      proactive.registerHeartbeat(
        config.proactive.checks,
        config.proactive.heartbeat_interval_ms
      );
    }
    for (const schedule of config.proactive.schedules ?? []) {
      proactive.registerSchedule(schedule);
    }
    await proactive.start();
  }

  return {
    builder,
    gateway,
    proactive,
    async close() {
      await proactive?.stop();
      await gateway.stop();
      memoryStore.close();
    }
  };
}

function resolveReasoner(
  reasoner: Reasoner | undefined,
  openai: PersonalAssistantAppConfig["openai"]
): Reasoner {
  if (reasoner) {
    return reasoner;
  }

  if (!openai) {
    throw new Error(
      "Personal assistant requires either a custom reasoner or OPENAI_* configuration."
    );
  }

  return new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    apiUrl: openai.apiUrl,
    bearerToken: openai.bearerToken,
    model: openai.model,
    timeoutMs: openai.timeoutMs,
    headers: openai.headers
  });
}
