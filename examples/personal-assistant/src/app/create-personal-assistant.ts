import { defineAgent, type AgentBuilder } from "@neurocore/sdk-core";
import { OpenAICompatibleReasoner } from "@neurocore/sdk-node";
import type { Reasoner, Tool } from "@neurocore/protocol";
import { SandboxPolicyProvider } from "@neurocore/policy-core";
import { CliAdapter } from "../im-gateway/adapter/cli.js";
import { DiscordAdapter } from "../im-gateway/adapter/discord.js";
import { EmailAdapter } from "../im-gateway/adapter/email.js";
import { FeishuAdapter } from "../im-gateway/adapter/feishu.js";
import { SlackAdapter } from "../im-gateway/adapter/slack.js";
import { TelegramAdapter } from "../im-gateway/adapter/telegram.js";
import { WebChatAdapter } from "../im-gateway/adapter/web-chat.js";
import { SqliteApprovalBindingStore } from "../im-gateway/approval/sqlite-approval-binding-store.js";
import { CommandHandler } from "../im-gateway/command/command-handler.js";
import { ConversationRouter } from "../im-gateway/conversation/conversation-router.js";
import { SqlitePlatformUserLinkStore } from "../im-gateway/conversation/sqlite-platform-user-link-store.js";
import { SqliteSessionMappingStore } from "../im-gateway/conversation/sqlite-session-mapping-store.js";
import { IMGateway } from "../im-gateway/gateway.js";
import { NotificationDispatcher } from "../im-gateway/notification/notification-dispatcher.js";
import { AssistantRuntimeFactory } from "../im-gateway/runtime/assistant-runtime-factory.js";
import type { IMPlatform } from "../im-gateway/types.js";
import { PersonalMemoryRecallProvider } from "../memory/personal-memory-recall-provider.js";
import type { PersonalMemoryStore } from "../memory/personal-memory-store.js";
import { SessionSearchRecallProvider } from "../memory/session-search-recall-provider.js";
import type { SessionSearchStore } from "../memory/session-search-store.js";
import { SqliteSessionSearchStore } from "../memory/session-search-store.js";
import { SqlitePersonalMemoryStore } from "../memory/sqlite-personal-memory-store.js";
import { createWebBrowserTool, createWebFetchTool } from "../connectors/browser/web-browser.js";
import { createCalendarReadTool } from "../connectors/calendar/calendar-read.js";
import { createCalendarWriteTool } from "../connectors/calendar/calendar-write.js";
import { createEmailReadTool } from "../connectors/email/email-read.js";
import { createEmailSendTool } from "../connectors/email/email-send.js";
import { createWebSearchTool } from "../connectors/search/web-search.js";
import { ProactiveEngine } from "../proactive/proactive-engine.js";
import { SqliteStandingOrderStore } from "../proactive/store/sqlite-standing-order-store.js";
import { createAgentSkillRegistryFromConfig, type AgentSkillRegistry } from "../skills/agent-skill-registry.js";
import { createPersonalSkillTools } from "../skills/skill-tools.js";
import {
  createSandboxManagerFromConfig,
  defaultSandboxForceTools,
  defaultSandboxedTools,
  type SandboxManager
} from "../sandbox/sandbox-provider.js";
import { createSandboxTools } from "../sandbox/sandbox-tools.js";
import type { PersonalAssistantAppConfig } from "./assistant-config.js";

export interface RunningPersonalAssistantApp {
  builder: AgentBuilder;
  gateway: IMGateway;
  proactive?: ProactiveEngine;
  close(): Promise<void>;
}

export interface PersonalAssistantAgentOptions {
  personalMemoryStore?: PersonalMemoryStore;
  sessionSearchStore?: SessionSearchStore;
  skillRegistry?: AgentSkillRegistry;
  sandboxManager?: SandboxManager;
  mcpTools?: Tool[];
}

export function createPersonalAssistantAgent(
  config: PersonalAssistantAppConfig,
  options: PersonalAssistantAgentOptions = {}
): AgentBuilder {
  const reasoner = resolveReasoner(config.reasoner, config.openai);
  const skillRegistry = options.skillRegistry ?? createAgentSkillRegistryFromConfig(config.skills);
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
  agent.registerTool(createWebFetchTool(config.connectors?.browser));

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

  const sandboxManager = options.sandboxManager ?? createSandboxManagerFromConfig(config.sandbox);
  if (sandboxManager) {
    for (const tool of createSandboxTools(sandboxManager)) {
      agent.registerTool(tool);
    }
    const forcedTools = config.sandbox?.force_tools ?? defaultSandboxForceTools();
    if (forcedTools.length > 0) {
      agent.registerPolicyProvider(new SandboxPolicyProvider({
        requiredSandboxTools: forcedTools,
        sandboxedTools: defaultSandboxedTools()
      }));
    }
  }

  if (options.personalMemoryStore) {
    agent.registerMemoryProvider(new PersonalMemoryRecallProvider(options.personalMemoryStore));
  }

  if (options.sessionSearchStore) {
    agent.registerMemoryProvider(new SessionSearchRecallProvider(options.sessionSearchStore));
  }

  if (skillRegistry) {
    for (const tool of createPersonalSkillTools(skillRegistry)) {
      agent.registerTool(tool);
    }
  }

  for (const tool of options.mcpTools ?? []) {
    agent.registerTool(tool);
  }

  return agent;
}

export async function startPersonalAssistantApp(
  config: PersonalAssistantAppConfig
): Promise<RunningPersonalAssistantApp> {
  const memoryStore = new SqlitePersonalMemoryStore({ filename: config.db_path });
  const sessionSearchStore = new SqliteSessionSearchStore({ filename: config.db_path });
  const skillRegistry = createAgentSkillRegistryFromConfig(config.skills);
  const runtimeFactory = new AssistantRuntimeFactory({
    dbPath: config.db_path,
    buildAgent: () => createPersonalAssistantAgent(config, { personalMemoryStore: memoryStore, sessionSearchStore, skillRegistry })
  });
  const builder = runtimeFactory.getBuilder();

  const mappingStore = new SqliteSessionMappingStore({ filename: config.db_path });
  const userLinkStore = new SqlitePlatformUserLinkStore({ filename: config.db_path });
  const approvalBindingStore = new SqliteApprovalBindingStore({ filename: config.db_path });
  const resolveUserId = (message: { platform: IMPlatform; sender_id: string }) =>
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
    skillRegistry,
    resolveUserId,
    model: config.openai
      ? {
          provider: "openai-compatible",
          model: config.openai.model,
          apiUrl: config.openai.apiUrl
        }
      : undefined
  });

  const gateway = new IMGateway({
    builder,
    router,
    dispatcher,
    approvalBindingStore,
    commandHandler,
    memoryStore,
    sessionSearchStore,
    resolveUserId
  });
  gatewayRef = gateway;

  if (config.cli?.enabled) {
    gateway.registerAdapter(new CliAdapter(), {
      auth: compactAuth({
        user_id: config.cli.user_id,
        chat_id: config.cli.chat_id
      })
    });
  }

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

  if (config.telegram?.enabled && config.telegram.bot_token) {
    gateway.registerAdapter(new TelegramAdapter(), {
      auth: compactAuth({
        bot_token: config.telegram.bot_token,
        api_base_url: config.telegram.api_base_url,
        webhook_secret: config.telegram.webhook_secret
      }),
      allowed_senders: config.telegram.allowed_senders
    });
  }

  if (config.slack?.enabled && config.slack.bot_token) {
    gateway.registerAdapter(new SlackAdapter(), {
      auth: compactAuth({
        bot_token: config.slack.bot_token,
        signing_secret: config.slack.signing_secret,
        api_base_url: config.slack.api_base_url
      }),
      allowed_senders: config.slack.allowed_senders
    });
  }

  if (config.discord?.enabled && config.discord.bot_token) {
    gateway.registerAdapter(new DiscordAdapter(), {
      auth: compactAuth({
        bot_token: config.discord.bot_token,
        api_base_url: config.discord.api_base_url
      }),
      allowed_senders: config.discord.allowed_senders
    });
  }

  if (config.connectors?.email?.sender) {
    gateway.registerAdapter(new EmailAdapter({ sender: config.connectors.email.sender }), {
      auth: {},
      allowed_senders: []
    });
  }

  await gateway.start();

  let proactive: ProactiveEngine | undefined;
  let standingOrderStore: SqliteStandingOrderStore | undefined;
  if (config.proactive?.enabled) {
    standingOrderStore = new SqliteStandingOrderStore({ filename: config.db_path });
    proactive = new ProactiveEngine({
      agent: builder,
      gateway,
      tenantId: config.tenant_id,
      standingOrderStore
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
    for (const order of config.proactive.standing_orders ?? []) {
      proactive.registerStandingOrder(order);
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
      sessionSearchStore.close();
      standingOrderStore?.close();
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

function compactAuth(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
