import { defineAgent, type AgentBuilder } from "@neurocore/sdk-core";
import {
  OpenAICompatibleModelRouterReasoner,
  OpenAICompatibleProviderRegistry,
  OpenAICompatibleReasoner,
  type OpenAICompatibleModelProviderConfig
} from "@neurocore/sdk-node";
import type { Reasoner, Tool } from "@neurocore/protocol";
import { SandboxPolicyProvider } from "@neurocore/policy-core";
import {
  BrowserSessionManager,
  createBrowserSessionTools,
  PlaywrightBrowserSessionProvider
} from "../browser/browser-session-tools.js";
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
import { PairingManager } from "../im-gateway/conversation/pairing.js";
import { SqlitePlatformUserLinkStore } from "../im-gateway/conversation/sqlite-platform-user-link-store.js";
import { SqliteSessionMappingStore } from "../im-gateway/conversation/sqlite-session-mapping-store.js";
import { IMGateway } from "../im-gateway/gateway.js";
import { NotificationDispatcher } from "../im-gateway/notification/notification-dispatcher.js";
import { InMemoryNotificationPolicyStore } from "../im-gateway/notification/notification-policy.js";
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
import { createWorkspaceFileTools } from "../files/workspace-file-tools.js";
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
import {
  createTerminalBackgroundProcessTools,
  TerminalBackgroundProcessManager
} from "../terminal/background-process-tools.js";
import {
  GmailPubSubWebhookAdapter,
  PersonalWebhookIngress
} from "../webhook/webhook-ingress.js";
import type { PersonalAssistantAppConfig } from "./assistant-config.js";
import type { CredentialVault } from "../security/credential-vault.js";
import {
  channelSecretRef,
  createPersonalAssistantCredentialVault,
  leaseChannelSecret,
  resolveModelBearerToken,
  resolveWebSearchConfig
} from "./personal-assistant-credentials.js";

export interface RunningPersonalAssistantApp {
  builder: AgentBuilder;
  gateway: IMGateway;
  commandHandler: CommandHandler;
  proactive?: ProactiveEngine;
  webhookIngress?: PersonalWebhookIngress;
  gmailPubSubWebhook?: GmailPubSubWebhookAdapter;
  close(): Promise<void>;
}

export interface PersonalAssistantAgentOptions {
  personalMemoryStore?: PersonalMemoryStore;
  sessionSearchStore?: SessionSearchStore;
  skillRegistry?: AgentSkillRegistry;
  sandboxManager?: SandboxManager;
  mcpTools?: Tool[];
  credentialVault?: CredentialVault;
  terminalProcessManager?: TerminalBackgroundProcessManager;
  browserSessionManager?: BrowserSessionManager;
}

export function createPersonalAssistantAgent(
  config: PersonalAssistantAppConfig,
  options: PersonalAssistantAgentOptions = {}
): AgentBuilder {
  const credentialVault = options.credentialVault ?? createPersonalAssistantCredentialVault(config);
  const reasoner = resolveReasoner(config, credentialVault);
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
    agent.registerTool(createWebSearchTool(resolveWebSearchConfig(config.connectors.search, credentialVault)));
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

  if (config.files?.enabled && config.files.workspace_root) {
    for (const tool of createWorkspaceFileTools({
      workspaceRoot: config.files.workspace_root,
      maxFileBytes: config.files.max_file_bytes,
      maxSearchResults: config.files.max_search_results
    })) {
      agent.registerTool(tool);
    }
  }

  if (config.terminal?.enabled) {
    const terminalManager = options.terminalProcessManager ?? new TerminalBackgroundProcessManager({
      shell: config.terminal.shell,
      cwd: config.terminal.cwd,
      maxLogBytes: config.terminal.max_log_bytes,
      defaultTimeoutMs: config.terminal.default_timeout_ms
    });
    for (const tool of createTerminalBackgroundProcessTools(terminalManager)) {
      agent.registerTool(tool);
    }
  }

  if (config.browser_profile?.enabled) {
    const browserManager = options.browserSessionManager ?? new BrowserSessionManager({
      profileRoot: config.browser_profile.profile_root,
      userAgent: config.browser_profile.user_agent,
      maxContentChars: config.browser_profile.max_content_chars,
      fetch: config.connectors?.browser?.fetch,
      headless: config.browser_profile.headless,
      provider: config.browser_profile.provider === "playwright"
        ? new PlaywrightBrowserSessionProvider()
        : undefined
    });
    for (const tool of createBrowserSessionTools(browserManager)) {
      agent.registerTool(tool);
    }
  }

  return agent;
}

export async function startPersonalAssistantApp(
  config: PersonalAssistantAppConfig
): Promise<RunningPersonalAssistantApp> {
  const memoryStore = new SqlitePersonalMemoryStore({ filename: config.db_path });
  const sessionSearchStore = new SqliteSessionSearchStore({ filename: config.db_path });
  const skillRegistry = createAgentSkillRegistryFromConfig(config.skills);
  const credentialVault = createPersonalAssistantCredentialVault(config);
  const runtimeFactory = new AssistantRuntimeFactory({
    dbPath: config.db_path,
    buildAgent: () => createPersonalAssistantAgent(config, { personalMemoryStore: memoryStore, sessionSearchStore, skillRegistry, credentialVault })
  });
  const builder = runtimeFactory.getBuilder();

  const mappingStore = new SqliteSessionMappingStore({ filename: config.db_path });
  const userLinkStore = new SqlitePlatformUserLinkStore({ filename: config.db_path });
  const pairingManager = new PairingManager({
    store: userLinkStore,
    requirePairingFor: config.identity?.require_pairing === false
      ? []
      : config.identity?.require_pairing_platforms,
    codeTtlMs: config.identity?.pairing_code_ttl_ms
  });
  const approvalBindingStore = new SqliteApprovalBindingStore({ filename: config.db_path });
  const modelRegistry = createOpenAIProviderRegistry(config, credentialVault);
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
    mappingStore,
    notificationPolicyStore: createNotificationPolicyStore(config)
  });
  const commandHandler = new CommandHandler({
    router,
    dispatcher,
    memoryStore,
    skillRegistry,
    pairingManager,
    resolveUserId,
    model: modelRegistry
      ? {
          defaultProviderId: modelRegistry.defaultProviderId,
          providers: modelRegistry.listProviderSummaries(),
          healthCheck: (providerId) => modelRegistry.healthCheck(providerId)
        }
      : config.openai
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
    pairingManager,
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
        app_secret: leaseChannelSecret(
          credentialVault,
          config.feishu.app_secret_ref ?? channelSecretRef("feishu", "app_secret"),
          "channel:feishu",
          config.feishu.app_secret
        ) ?? "",
        ws_url: config.feishu.ws_url ?? ""
      }
    });
  }

  if (config.telegram?.enabled && config.telegram.bot_token) {
    gateway.registerAdapter(new TelegramAdapter(), {
      auth: compactAuth({
        bot_token: leaseChannelSecret(
          credentialVault,
          config.telegram.bot_token_ref ?? channelSecretRef("telegram", "bot_token"),
          "channel:telegram",
          config.telegram.bot_token
        ),
        api_base_url: config.telegram.api_base_url,
        webhook_secret: leaseChannelSecret(
          credentialVault,
          config.telegram.webhook_secret_ref ?? channelSecretRef("telegram", "webhook_secret"),
          "channel:telegram",
          config.telegram.webhook_secret
        )
      }),
      allowed_senders: config.telegram.allowed_senders
    });
  }

  if (config.slack?.enabled && config.slack.bot_token) {
    gateway.registerAdapter(new SlackAdapter(), {
      auth: compactAuth({
        bot_token: leaseChannelSecret(
          credentialVault,
          config.slack.bot_token_ref ?? channelSecretRef("slack", "bot_token"),
          "channel:slack",
          config.slack.bot_token
        ),
        signing_secret: leaseChannelSecret(
          credentialVault,
          config.slack.signing_secret_ref ?? channelSecretRef("slack", "signing_secret"),
          "channel:slack",
          config.slack.signing_secret
        ),
        api_base_url: config.slack.api_base_url
      }),
      allowed_senders: config.slack.allowed_senders
    });
  }

  if (config.discord?.enabled && config.discord.bot_token) {
    gateway.registerAdapter(new DiscordAdapter(), {
      auth: compactAuth({
        bot_token: leaseChannelSecret(
          credentialVault,
          config.discord.bot_token_ref ?? channelSecretRef("discord", "bot_token"),
          "channel:discord",
          config.discord.bot_token
        ),
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

  const webhookIngress = config.webhooks?.enabled && config.webhooks.routes
    ? new PersonalWebhookIngress({
        routes: config.webhooks.routes,
        handleMessage: (message) => gateway.handleMessage(message),
        taskLedger: proactive?.taskLedger
      })
    : undefined;
  const gmailPubSubWebhook = config.webhooks?.gmail_pubsub?.enabled && config.webhooks.gmail_pubsub.token
    ? new GmailPubSubWebhookAdapter({
        token: config.webhooks.gmail_pubsub.token,
        handleMessage: (message) => gateway.handleMessage(message),
        platform: config.webhooks.gmail_pubsub.platform,
        chat_id: config.webhooks.gmail_pubsub.chat_id,
        sender_id: config.webhooks.gmail_pubsub.sender_id
      })
    : undefined;

  return {
    builder,
    gateway,
    commandHandler,
    proactive,
    webhookIngress,
    gmailPubSubWebhook,
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
  config: PersonalAssistantAppConfig,
  credentialVault?: CredentialVault
): Reasoner {
  if (config.reasoner) {
    return config.reasoner;
  }

  const registry = createOpenAIProviderRegistry(config, credentialVault);
  if (registry) {
    return new OpenAICompatibleModelRouterReasoner({
      registry
    });
  }

  if (!config.openai) {
    throw new Error(
      "Personal assistant requires either a custom reasoner or OPENAI_* configuration."
    );
  }

  return new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    apiUrl: config.openai.apiUrl,
    bearerToken: resolveModelBearerToken(credentialVault, config.openai, "default"),
    model: config.openai.model,
    timeoutMs: config.openai.timeoutMs,
    jsonTimeoutMs: config.openai.jsonTimeoutMs,
    streamTimeoutMs: config.openai.streamTimeoutMs,
    headers: config.openai.headers,
    extraBody: config.openai.extraBody
  });
}

function createNotificationPolicyStore(config: PersonalAssistantAppConfig): InMemoryNotificationPolicyStore | undefined {
  if (!config.notifications?.default_policy) {
    return undefined;
  }
  const store = new InMemoryNotificationPolicyStore();
  store.setPolicy("default", config.notifications.default_policy);
  return store;
}

function createOpenAIProviderRegistry(
  config: PersonalAssistantAppConfig,
  credentialVault?: CredentialVault
): OpenAICompatibleProviderRegistry | undefined {
  const providers = config.models?.providers.map((provider) => toOpenAIModelProviderConfig(provider, credentialVault))
    ?? (config.openai
      ? [{
          id: "default",
          provider: "openai-compatible" as const,
          apiUrl: config.openai.apiUrl,
          bearerToken: resolveModelBearerToken(credentialVault, config.openai, "default"),
          model: config.openai.model,
          timeoutMs: config.openai.timeoutMs,
          jsonTimeoutMs: config.openai.jsonTimeoutMs,
          streamTimeoutMs: config.openai.streamTimeoutMs,
          headers: config.openai.headers,
          extraBody: config.openai.extraBody
        }]
      : []);

  if (providers.length === 0) {
    return undefined;
  }

  return new OpenAICompatibleProviderRegistry({
    defaultProviderId: config.models?.default_provider_id ?? providers[0]?.id,
    providers
  });
}

function toOpenAIModelProviderConfig(
  provider: NonNullable<PersonalAssistantAppConfig["models"]>["providers"][number],
  credentialVault?: CredentialVault
): OpenAICompatibleModelProviderConfig {
  return {
    id: provider.id,
    label: provider.label,
    provider: "openai-compatible",
    apiUrl: provider.apiUrl,
    bearerToken: resolveModelBearerToken(credentialVault, provider, provider.id),
    model: provider.model,
    timeoutMs: provider.timeoutMs,
    jsonTimeoutMs: provider.jsonTimeoutMs,
    streamTimeoutMs: provider.streamTimeoutMs,
    headers: provider.headers,
    extraBody: provider.extraBody,
    fallbackProviderIds: provider.fallback_provider_ids
  };
}

function compactAuth(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
