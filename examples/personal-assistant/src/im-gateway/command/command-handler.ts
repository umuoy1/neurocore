import type { AgentSession, CycleTraceRecord, SessionCheckpoint } from "@neurocore/protocol";
import type { OpenAICompatibleProviderHealthReport } from "@neurocore/sdk-node";
import type { PersonalMemoryStore } from "../../memory/personal-memory-store.js";
import { memorySourceFromMessage } from "../../memory/personal-memory-store.js";
import type { ConversationRouting } from "../conversation/conversation-router.js";
import type { SessionRoute } from "../types.js";
import type { NotificationDispatcher } from "../notification/notification-dispatcher.js";
import type { UnifiedMessage } from "../types.js";
import type { AgentSkillRecord, AgentSkillRegistry } from "../../skills/agent-skill-registry.js";
import type { PairingManager } from "../conversation/pairing.js";

export type CommandRiskLevel = "none" | "low" | "medium" | "high";

export interface CommandSchema {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  risk_level: CommandRiskLevel;
  parameters: Array<{
    name: string;
    required: boolean;
    description: string;
  }>;
}

export interface CommandHandlerModelInfo {
  provider?: string;
  model?: string;
  apiUrl?: string;
  defaultProviderId?: string;
  providers?: CommandHandlerModelProviderInfo[];
  healthCheck?: (providerId?: string) => Promise<OpenAICompatibleProviderHealthReport>;
}

export interface CommandHandlerModelProviderInfo {
  id: string;
  label?: string;
  provider: string;
  model: string;
  apiUrl: string;
  fallbackProviderIds?: string[];
}

export interface CommandHandlerOptions {
  router: ConversationRouting;
  dispatcher: NotificationDispatcher;
  memoryStore?: PersonalMemoryStore;
  skillRegistry?: AgentSkillRegistry;
  pairingManager?: PairingManager;
  resolveUserId?: (message: UnifiedMessage) => string;
  model?: CommandHandlerModelInfo;
}

interface CommandExecutionContext {
  message: UnifiedMessage;
  args: string;
  command: string;
}

interface CommandDefinition extends CommandSchema {
  execute(ctx: CommandExecutionContext): Promise<void>;
}

export class CommandHandler {
  private readonly commands: CommandDefinition[];
  private readonly commandByName = new Map<string, CommandDefinition>();

  public constructor(private readonly options: CommandHandlerOptions) {
    this.commands = this.createCommandDefinitions();
    for (const command of this.commands) {
      this.commandByName.set(command.name, command);
      for (const alias of command.aliases) {
        this.commandByName.set(alias, command);
      }
    }
  }

  public listCommandSchemas(): CommandSchema[] {
    return this.commands.map(({ execute: _execute, ...schema }) => schema);
  }

  public async tryHandle(message: UnifiedMessage): Promise<boolean> {
    const text = extractText(message);
    if (!text?.startsWith("/")) {
      return false;
    }

    const trimmed = text.trim();
    const rawCommand = trimmed.split(/\s+/, 1)[0];
    const command = rawCommand.toLowerCase();
    const args = trimmed.slice(rawCommand.length).trim();
    const definition = this.commandByName.get(command);
    if (!definition) {
      await this.reply(message, formatCommandError({
        code: "unknown_command",
        command,
        message: `Unknown command: ${command}`,
        available: this.commands.map((item) => formatCommandRisk(item))
      }));
      return true;
    }

    await definition.execute({ message, args, command });
    return true;
  }

  private createCommandDefinitions(): CommandDefinition[] {
    return [
      {
        name: "/new",
        aliases: ["/reset"],
        description: "Start a fresh conversation for the current chat.",
        usage: "/new",
        risk_level: "low",
        parameters: [],
        execute: ({ message, command }) => command === "/reset" ? this.reset(message) : this.newConversation(message)
      },
      {
        name: "/status",
        aliases: [],
        description: "Show the current mapped session status.",
        usage: "/status",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.status(message)
      },
      {
        name: "/retry",
        aliases: [],
        description: "Replay the latest user turn in the current chat.",
        usage: "/retry",
        risk_level: "low",
        parameters: [],
        execute: ({ message }) => this.retry(message)
      },
      {
        name: "/undo",
        aliases: [],
        description: "Checkpoint and detach the latest exchange from the current chat route.",
        usage: "/undo",
        risk_level: "medium",
        parameters: [],
        execute: ({ message }) => this.undo(message)
      },
      {
        name: "/personality",
        aliases: ["/persona"],
        description: "Show, set or reset the current session personality override.",
        usage: "/personality [reset | instruction]",
        risk_level: "low",
        parameters: [
          {
            name: "instruction",
            required: false,
            description: "Optional personality instruction for the current session."
          }
        ],
        execute: ({ message, args }) => this.personality(message, args)
      },
      {
        name: "/insights",
        aliases: [],
        description: "Show session usage, trace and tool insights.",
        usage: "/insights",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.insights(message)
      },
      {
        name: "/trace",
        aliases: [],
        description: "Show or toggle trace visibility for the current session.",
        usage: "/trace [on | off | last]",
        risk_level: "low",
        parameters: [
          {
            name: "mode",
            required: false,
            description: "Optional on, off or last."
          }
        ],
        execute: ({ message, args }) => this.trace(message, args)
      },
      {
        name: "/stop",
        aliases: [],
        description: "Abort the current mapped session and clear the chat route.",
        usage: "/stop",
        risk_level: "medium",
        parameters: [],
        execute: ({ message }) => this.stop(message)
      },
      {
        name: "/model",
        aliases: [],
        description: "Show, switch, reset or health-check the current session model provider.",
        usage: "/model [use <provider_id> | reset | health [provider_id] | audit]",
        risk_level: "none",
        parameters: [
          {
            name: "operation",
            required: false,
            description: "Optional use, reset, health or audit operation."
          }
        ],
        execute: ({ message, args }) => this.model(message, args)
      },
      {
        name: "/usage",
        aliases: [],
        description: "Show token, cycle, tool and context budget usage for the current session.",
        usage: "/usage",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.usage(message)
      },
      {
        name: "/compact",
        aliases: [],
        description: "Checkpoint the current session as a manual context compaction boundary.",
        usage: "/compact [instructions]",
        risk_level: "low",
        parameters: [
          {
            name: "instructions",
            required: false,
            description: "Optional compaction guidance to preserve in the response."
          }
        ],
        execute: ({ message, args }) => this.compact(message, args)
      },
      {
        name: "/history",
        aliases: [],
        description: "List recent session routes for the current user.",
        usage: "/history",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.history(message)
      },
      {
        name: "/pair",
        aliases: [],
        description: "Create or consume a pairing code for this sender.",
        usage: "/pair <code> | /pair create [canonical_user_id]",
        risk_level: "medium",
        parameters: [{ name: "code", required: false, description: "Pairing code, or create to mint a code from a trusted channel." }],
        execute: ({ message, args }) => this.pair(message, args)
      },
      {
        name: "/unpair",
        aliases: ["/revoke"],
        description: "Revoke this sender pairing.",
        usage: "/unpair",
        risk_level: "medium",
        parameters: [],
        execute: ({ message }) => this.unpair(message)
      },
      {
        name: "/sethome",
        aliases: [],
        description: "Set this chat as the home channel for the current user.",
        usage: "/sethome",
        risk_level: "low",
        parameters: [],
        execute: ({ message }) => this.setHome(message)
      },
      {
        name: "/remember",
        aliases: [],
        description: "Store an explicit personal memory.",
        usage: "/remember <fact or preference>",
        risk_level: "low",
        parameters: [{ name: "content", required: true, description: "Fact or preference to remember." }],
        execute: ({ message, args }) => this.remember(message, args)
      },
      {
        name: "/memories",
        aliases: ["/memory"],
        description: "List active personal memories.",
        usage: "/memories",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.listMemories(message)
      },
      {
        name: "/forget",
        aliases: [],
        description: "Tombstone active personal memories by id, text match or all.",
        usage: "/forget <memory_id | text | all>",
        risk_level: "low",
        parameters: [{ name: "target", required: true, description: "Memory id, text query or all." }],
        execute: ({ message, args }) => this.forget(message, args)
      },
      {
        name: "/correct",
        aliases: [],
        description: "Correct a memory and tombstone the stale fact when matched.",
        usage: "/correct <memory_id | old text> => <new fact or preference>",
        risk_level: "low",
        parameters: [{ name: "correction", required: true, description: "Old target and replacement content." }],
        execute: ({ message, args }) => this.correct(message, args)
      },
      {
        name: "/skills",
        aliases: [],
        description: "List or inspect skills.",
        usage: "/skills [search <query> | run <skill_id> [input] | audit]",
        risk_level: "none",
        parameters: [
          {
            name: "subcommand",
            required: false,
            description: "Optional search, run or audit operation."
          }
        ],
        execute: ({ message, args }) => this.skills(message, args)
      }
    ];
  }

  private async reply(message: UnifiedMessage, text: string): Promise<void> {
    await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
      type: "text",
      text
    });
  }

  private async newConversation(message: UnifiedMessage): Promise<void> {
    this.options.router.clearRoute(message);
    await this.reply(message, "Started a new conversation. Your next message will create a fresh session.");
  }

  private async reset(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (existing) {
      try {
        this.options.router.connect(existing.session_id).checkpoint();
      } catch {}
      this.options.router.clearRoute(message);
    }
    await this.reply(message, "Conversation reset. Previous state was checkpointed when possible.");
  }

  private async status(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    await this.reply(message, formatSessionStatus(handle.getSession()));
  }

  private async retry(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    const latestInput = findLatestUserInput(handle.getTraceRecords());
    if (!latestInput) {
      await this.reply(message, "No previous user turn is available to retry.");
      return;
    }

    try {
      const result = await handle.runText(latestInput.content, {
        ...(latestInput.metadata ?? {}),
        personal_assistant_command: "retry",
        retry_of_cycle_id: latestInput.cycle_id
      });
      await this.reply(message, [
        "Retried latest user turn.",
        `source_cycle_id: ${latestInput.cycle_id ?? "n/a"}`,
        result.outputText ?? "Retry completed without textual output."
      ].join("\n"));
    } catch (error) {
      await this.reply(message, error instanceof Error ? error.message : String(error));
    }
  }

  private async undo(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    let checkpoint: SessionCheckpoint | undefined;
    try {
      checkpoint = handle.checkpoint();
    } catch {}
    this.options.router.clearRoute(message);
    await this.reply(message, [
      "Undid the latest chat route.",
      `session_id: ${existing.session_id}`,
      `checkpoint_id: ${checkpoint?.checkpoint_id ?? "unavailable"}`,
      "The next message will start a fresh session from this chat."
    ].join("\n"));
  }

  private async personality(message: UnifiedMessage, instruction: string): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const session = this.options.router.connect(existing.session_id).getSession();
    if (!session) {
      await this.reply(message, "Session is not available.");
      return;
    }

    const metadata = ensureSessionMetadata(session);
    const trimmed = instruction.trim();
    if (!trimmed) {
      await this.reply(message, `Personality: ${typeof metadata.personality === "string" ? metadata.personality : "default"}`);
      return;
    }
    if (trimmed === "reset" || trimmed === "clear") {
      delete metadata.personality;
      await this.reply(message, "Personality override reset.");
      return;
    }

    metadata.personality = trimmed;
    await this.reply(message, `Personality override set: ${trimmed}`);
  }

  private async insights(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    const session = handle.getSession();
    const traces = handle.getTraceRecords();
    const events = handle.getEvents();
    const tools = traces.filter((trace) => Boolean(trace.selected_action?.tool_name));
    const failures = traces.filter((trace) => trace.observation?.status === "failure" || trace.action_execution?.status === "failed");
    const last = traces.at(-1);
    await this.reply(message, [
      "Insights:",
      `session_id: ${existing.session_id}`,
      `state: ${session?.state ?? "unknown"}`,
      `cycles: ${session?.budget_state.cycle_used ?? traces.length}/${session?.budget_state.cycle_limit ?? "?"}`,
      `trace_count: ${traces.length}`,
      `event_count: ${events.length}`,
      `tool_call_count: ${tools.length}`,
      `failure_count: ${failures.length}`,
      `last_action: ${last?.selected_action?.action_type ?? "n/a"}`,
      `last_trace_id: ${last?.trace.trace_id ?? "n/a"}`
    ].join("\n"));
  }

  private async trace(message: UnifiedMessage, args: string): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    const session = handle.getSession();
    if (!session) {
      await this.reply(message, "Session is not available.");
      return;
    }

    const mode = args.trim().toLowerCase();
    const metadata = ensureSessionMetadata(session);
    const rootMetadata = session.metadata as Record<string, unknown>;
    const observability = ensureObservabilityMetadata(rootMetadata);
    metadata.observability_config = observability;
    if (mode === "on") {
      observability.trace_enabled = true;
      await this.reply(message, "Trace enabled for this session.");
      return;
    }
    if (mode === "off") {
      observability.trace_enabled = false;
      await this.reply(message, "Trace disabled for this session.");
      return;
    }

    const traces = handle.getTraceRecords();
    const last = traces.at(-1);
    await this.reply(message, [
      "Trace:",
      `enabled: ${observability.trace_enabled !== false}`,
      `trace_count: ${traces.length}`,
      `last_trace_id: ${last?.trace.trace_id ?? "n/a"}`,
      `last_cycle_id: ${last?.trace.cycle_id ?? "n/a"}`,
      `last_action: ${last?.selected_action?.action_type ?? "n/a"}`,
      `last_observation: ${last?.observation?.status ?? "n/a"}`
    ].join("\n"));
  }

  private async stop(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    const session = handle.cancel();
    this.options.router.clearRoute(message);
    await this.reply(message, `Stopped session ${session.session_id}.\nstate: ${session.state}`);
  }

  private async model(message: UnifiedMessage, args: string): Promise<void> {
    const [operation, ...rest] = args.split(/\s+/).filter(Boolean);
    if (operation === "use" || operation === "set") {
      await this.setModelProvider(message, rest[0]);
      return;
    }
    if (operation === "reset" || operation === "clear") {
      await this.resetModelProvider(message);
      return;
    }
    if (operation === "health") {
      await this.modelHealth(message, rest[0]);
      return;
    }
    if (operation === "audit") {
      await this.modelAudit(message);
      return;
    }
    if (operation && this.findModelProvider(operation)) {
      await this.setModelProvider(message, operation);
      return;
    }
    if (operation) {
      await this.reply(message, "Usage: /model [use <provider_id> | reset | health [provider_id] | audit]");
      return;
    }

    const model = this.options.model;
    if (model?.providers && model.providers.length > 0) {
      const existing = this.getCurrentRoute(message);
      const session = existing ? this.options.router.connect(existing.session_id).getSession() : undefined;
      const metadata = session ? ensureSessionMetadata(session) : undefined;
      const sessionProviderId = typeof metadata?.model_provider_id === "string" ? metadata.model_provider_id : undefined;
      const audit = Array.isArray(metadata?.model_audit) ? metadata.model_audit : [];
      const routerMetadata = session?.metadata && typeof session.metadata === "object"
        ? session.metadata.model_provider_router
        : undefined;
      const lastSelected = routerMetadata && typeof routerMetadata === "object" && !Array.isArray(routerMetadata)
        ? (routerMetadata as Record<string, unknown>).last_selected_provider_id
        : undefined;
      await this.reply(message, [
        "Model:",
        `default_provider_id: ${model.defaultProviderId ?? "default"}`,
        `session_provider_id: ${sessionProviderId ?? "default"}`,
        `last_selected_provider_id: ${typeof lastSelected === "string" ? lastSelected : "n/a"}`,
        `audit_count: ${audit.length}`,
        "providers:",
        ...model.providers.map((provider) =>
          `- ${provider.id}: ${provider.provider}/${provider.model} api_url=${provider.apiUrl} fallback=${provider.fallbackProviderIds?.join(",") || "auto"}`
        )
      ].join("\n"));
      return;
    }

    await this.reply(message, [
      "Model:",
      `provider: ${model?.provider ?? "custom-reasoner"}`,
      `model: ${model?.model ?? "custom"}`,
      `api_url: ${model?.apiUrl ?? "n/a"}`
    ].join("\n"));
  }

  private async setModelProvider(message: UnifiedMessage, providerId: string | undefined): Promise<void> {
    if (!providerId) {
      await this.reply(message, "Usage: /model use <provider_id>");
      return;
    }
    const provider = this.findModelProvider(providerId);
    if (!provider) {
      await this.reply(message, `Unknown model provider: ${providerId}`);
      return;
    }
    const session = this.getCurrentSession(message);
    if (!session) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const metadata = ensureSessionMetadata(session);
    const previous = typeof metadata.model_provider_id === "string"
      ? metadata.model_provider_id
      : this.options.model?.defaultProviderId ?? "default";
    metadata.model_provider_id = provider.id;
    appendModelAudit(metadata, {
      at: message.timestamp ?? new Date().toISOString(),
      command: "use",
      platform: message.platform,
      chat_id: message.chat_id,
      sender_id: message.sender_id,
      previous_provider_id: previous,
      next_provider_id: provider.id
    });
    await this.reply(message, [
      "Model provider set for this session.",
      `provider_id: ${provider.id}`,
      `model: ${provider.model}`
    ].join("\n"));
  }

  private async resetModelProvider(message: UnifiedMessage): Promise<void> {
    const session = this.getCurrentSession(message);
    if (!session) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const metadata = ensureSessionMetadata(session);
    const previous = typeof metadata.model_provider_id === "string"
      ? metadata.model_provider_id
      : this.options.model?.defaultProviderId ?? "default";
    delete metadata.model_provider_id;
    appendModelAudit(metadata, {
      at: message.timestamp ?? new Date().toISOString(),
      command: "reset",
      platform: message.platform,
      chat_id: message.chat_id,
      sender_id: message.sender_id,
      previous_provider_id: previous,
      next_provider_id: this.options.model?.defaultProviderId ?? "default"
    });
    await this.reply(message, `Model provider reset to ${this.options.model?.defaultProviderId ?? "default"} for this session.`);
  }

  private async modelHealth(message: UnifiedMessage, providerId: string | undefined): Promise<void> {
    const model = this.options.model;
    if (!model?.healthCheck) {
      await this.reply(message, "Model health check is not configured.");
      return;
    }
    const target = providerId || this.currentSessionModelProviderId(message) || model.defaultProviderId;
    try {
      const report = await model.healthCheck(target);
      await this.reply(message, formatModelHealth(report));
    } catch (error) {
      await this.reply(message, error instanceof Error ? error.message : String(error));
    }
  }

  private async modelAudit(message: UnifiedMessage): Promise<void> {
    const session = this.getCurrentSession(message);
    if (!session) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }
    const metadata = ensureSessionMetadata(session);
    const audit = Array.isArray(metadata.model_audit)
      ? metadata.model_audit.slice(-10)
      : [];
    const routerEvents = session.metadata && typeof session.metadata === "object"
      ? extractRouterModelEvents(session.metadata).slice(-5)
      : [];
    if (audit.length === 0 && routerEvents.length === 0) {
      await this.reply(message, "Model audit is empty for this session.");
      return;
    }
    await this.reply(message, [
      "Model audit:",
      ...audit.map(formatModelAuditEntry),
      ...routerEvents.map(formatRouterModelEvent)
    ].join("\n"));
  }

  private async skills(message: UnifiedMessage, args: string): Promise<void> {
    const registry = this.options.skillRegistry;
    if (!registry) {
      await this.reply(message, "Skills are not configured.");
      return;
    }

    const [subcommand, ...rest] = args.split(/\s+/).filter(Boolean);
    if (!subcommand) {
      await this.reply(message, formatSkillList(registry.listSkills({ platform: message.platform }), message.platform));
      return;
    }

    if (subcommand === "search") {
      const query = rest.join(" ");
      await this.reply(message, formatSkillList(registry.searchSkills(query, { platform: message.platform }), message.platform));
      return;
    }

    if (subcommand === "audit") {
      await this.reply(message, formatSkillAudit(registry.listSkills({ platform: message.platform }), message.platform));
      return;
    }

    if (subcommand === "run") {
      const [skillId, ...inputParts] = rest;
      if (!skillId) {
        await this.reply(message, "Usage: /skills run <skill_id> [input]");
        return;
      }
      try {
        const result = registry.invokeSkill(skillId, inputParts.join(" "), { platform: message.platform });
        await this.reply(message, [
          `Skill invoked: ${result.skill.name}`,
          `risk: ${result.skill.risk_level}`,
          `permissions: ${formatSkillPermissions(result.skill.permissions)}`,
          result.input ? `input: ${result.input}` : undefined
        ].filter(Boolean).join("\n"));
      } catch (error) {
        await this.reply(message, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    await this.reply(message, "Usage: /skills [search <query> | run <skill_id> [input] | audit]");
  }

  private async usage(message: UnifiedMessage): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    await this.reply(message, formatSessionUsage(handle.getSession()));
  }

  private async compact(message: UnifiedMessage, instructions: string): Promise<void> {
    const existing = this.getCurrentRoute(message);
    if (!existing) {
      await this.reply(message, "No active conversation is mapped to this chat.");
      return;
    }

    const handle = this.options.router.connect(existing.session_id);
    let checkpoint: SessionCheckpoint | undefined;
    try {
      checkpoint = handle.checkpoint();
    } catch {}

    await this.reply(message, [
      "Context compacted.",
      `session_id: ${existing.session_id}`,
      `checkpoint_id: ${checkpoint?.checkpoint_id ?? "unavailable"}`,
      `instructions: ${instructions || "none"}`
    ].join("\n"));
  }

  private async history(message: UnifiedMessage): Promise<void> {
    const routes = this.options.router.listRoutesForUser(this.resolveUserId(message));
    if (routes.length === 0) {
      await this.reply(message, "No session history is available for this user.");
      return;
    }

    const summary = routes
      .map((route) => `- ${route.platform}:${route.chat_id} -> ${route.session_id}`)
      .join("\n");
    await this.reply(message, `Recent session routes:\n${summary}`);
  }

  private async pair(message: UnifiedMessage, args: string): Promise<void> {
    const manager = this.options.pairingManager;
    if (!manager) {
      await this.reply(message, "Pairing is not configured.");
      return;
    }

    const trimmed = args.trim();
    if (trimmed.startsWith("create")) {
      const canonicalUserId = trimmed.slice("create".length).trim() || this.resolveUserId(message);
      const code = manager.createPairingCode({
        canonical_user_id: canonicalUserId,
        created_by_platform: message.platform,
        created_by_sender_id: message.sender_id,
        created_by_chat_id: message.chat_id
      });
      await this.reply(message, [
        "Pairing code created.",
        `code: ${code.code}`,
        `canonical_user_id: ${code.canonical_user_id}`,
        `expires_at: ${code.expires_at}`
      ].join("\n"));
      return;
    }

    if (!trimmed) {
      await this.reply(message, "Usage: /pair <code> | /pair create [canonical_user_id]");
      return;
    }

    const result = manager.consumePairingCode(message, trimmed);
    if (!result.ok) {
      await this.reply(message, result.reason);
      return;
    }
    await this.reply(message, `Paired ${message.platform}:${message.sender_id} to ${result.canonical_user_id}.`);
  }

  private async unpair(message: UnifiedMessage): Promise<void> {
    const manager = this.options.pairingManager;
    if (!manager) {
      await this.reply(message, "Pairing is not configured.");
      return;
    }
    const result = manager.revoke(message);
    this.options.router.clearRoute(message);
    if (!result.ok) {
      await this.reply(message, result.reason);
      return;
    }
    await this.reply(message, `Revoked pairing for ${message.platform}:${message.sender_id}.`);
  }

  private async setHome(message: UnifiedMessage): Promise<void> {
    const manager = this.options.pairingManager;
    if (!manager) {
      await this.reply(message, "Pairing is not configured.");
      return;
    }
    const result = manager.setHomeChannel(message);
    if (!result.ok) {
      await this.reply(message, result.reason);
      return;
    }
    await this.reply(message, `Home channel set to ${message.platform}:${message.chat_id} for ${result.canonical_user_id}.`);
  }

  private async remember(message: UnifiedMessage, content: string): Promise<void> {
    if (!this.options.memoryStore) {
      await this.reply(message, "Personal memory is not configured.");
      return;
    }
    if (content.trim().length === 0) {
      await this.reply(message, "Usage: /remember <fact or preference>");
      return;
    }

    const memory = this.options.memoryStore.remember({
      user_id: this.resolveUserId(message),
      content,
      source: memorySourceFromMessage(message),
      created_at: message.timestamp
    });
    await this.reply(message, `Remembered ${memory.memory_id}: ${memory.content}`);
  }

  private async listMemories(message: UnifiedMessage): Promise<void> {
    if (!this.options.memoryStore) {
      await this.reply(message, "Personal memory is not configured.");
      return;
    }

    const memories = this.options.memoryStore.listActive(this.resolveUserId(message));
    if (memories.length === 0) {
      await this.reply(message, "No active personal memories.");
      return;
    }

    await this.reply(
      message,
      memories
        .map((memory) => `${memory.memory_id}: ${memory.content}`)
        .join("\n")
    );
  }

  private async forget(message: UnifiedMessage, target: string): Promise<void> {
    if (!this.options.memoryStore) {
      await this.reply(message, "Personal memory is not configured.");
      return;
    }
    if (target.trim().length === 0) {
      await this.reply(message, "Usage: /forget <memory_id | text | all>");
      return;
    }

    const forgotten = this.options.memoryStore.forget(
      this.resolveUserId(message),
      target,
      message.timestamp
    );
    if (forgotten.length === 0) {
      await this.reply(message, "No matching active memories found.");
      return;
    }

    await this.reply(
      message,
      `Forgot ${forgotten.length} memor${forgotten.length === 1 ? "y" : "ies"}:\n${forgotten
        .map((memory) => `${memory.memory_id}: ${memory.content}`)
        .join("\n")}`
    );
  }

  private async correct(message: UnifiedMessage, args: string): Promise<void> {
    if (!this.options.memoryStore) {
      await this.reply(message, "Personal memory is not configured.");
      return;
    }

    const parsed = parseCorrection(args);
    if (!parsed) {
      await this.reply(message, "Usage: /correct <memory_id | old text> => <new fact or preference>");
      return;
    }

    const result = this.options.memoryStore.correct(
      this.resolveUserId(message),
      parsed.target,
      parsed.content,
      memorySourceFromMessage(message),
      message.timestamp
    );
    const prefix = result.forgotten.length > 0
      ? `Corrected ${result.forgotten.length} memor${result.forgotten.length === 1 ? "y" : "ies"}`
      : "Stored correction without matching an active memory";
    await this.reply(message, `${prefix}. Remembered ${result.memory.memory_id}: ${result.memory.content}`);
  }

  private getCurrentRoute(message: UnifiedMessage): SessionRoute | undefined {
    return this.options.router.listRoutesForUser(this.resolveUserId(message)).find(
      (route) => route.platform === message.platform && route.chat_id === message.chat_id
    );
  }

  private getCurrentSession(message: UnifiedMessage): AgentSession | undefined {
    const existing = this.getCurrentRoute(message);
    return existing ? this.options.router.connect(existing.session_id).getSession() : undefined;
  }

  private resolveUserId(message: UnifiedMessage): string {
    return this.options.resolveUserId?.(message) ?? message.sender_id;
  }

  private findModelProvider(providerId: string): CommandHandlerModelProviderInfo | undefined {
    return this.options.model?.providers?.find((provider) => provider.id === providerId);
  }

  private currentSessionModelProviderId(message: UnifiedMessage): string | undefined {
    const session = this.getCurrentSession(message);
    if (!session) {
      return undefined;
    }
    const metadata = ensureSessionMetadata(session);
    return typeof metadata.model_provider_id === "string" ? metadata.model_provider_id : undefined;
  }
}

function extractText(message: UnifiedMessage): string | undefined {
  if (message.content.type === "text" || message.content.type === "markdown") {
    return message.content.text;
  }
  return undefined;
}

function findLatestUserInput(records: CycleTraceRecord[]): {
  content: string;
  metadata?: Record<string, unknown>;
  cycle_id?: string;
} | undefined {
  for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
    const record = records[recordIndex];
    for (let inputIndex = record.inputs.length - 1; inputIndex >= 0; inputIndex -= 1) {
      const input = record.inputs[inputIndex];
      if (input.content.trim().length > 0) {
        return {
          content: input.content,
          metadata: input.metadata,
          cycle_id: record.trace.cycle_id
        };
      }
    }
  }
  return undefined;
}

function ensureSessionMetadata(session: AgentSession): Record<string, unknown> {
  session.metadata = session.metadata && typeof session.metadata === "object" ? session.metadata : {};
  const namespace = session.metadata.personal_assistant;
  if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) {
    session.metadata.personal_assistant = {};
  }
  return session.metadata.personal_assistant as Record<string, unknown>;
}

function ensureObservabilityMetadata(metadata: Record<string, unknown>): { trace_enabled?: boolean } {
  const existing = metadata.observability_config;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    metadata.observability_config = {};
  }
  return metadata.observability_config as { trace_enabled?: boolean };
}

function appendModelAudit(
  metadata: Record<string, unknown>,
  entry: Record<string, unknown>
): void {
  const audit = Array.isArray(metadata.model_audit) ? metadata.model_audit : [];
  audit.push(entry);
  metadata.model_audit = audit.slice(-50);
}

function formatModelHealth(report: OpenAICompatibleProviderHealthReport): string {
  return [
    "Model health:",
    `provider_id: ${report.provider_id}`,
    `model: ${report.model}`,
    `ok: ${report.ok}`,
    `status: ${report.status ?? "n/a"} ${report.status_text ?? ""}`.trim(),
    `latency_ms: ${report.latency_ms}`,
    `failure_mode: ${report.failure_mode ?? "none"}`,
    `error: ${report.error_message ?? "none"}`
  ].join("\n");
}

function formatModelAuditEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "- invalid audit entry";
  }
  const record = entry as Record<string, unknown>;
  return [
    `- command=${getAuditString(record.command)}`,
    `at=${getAuditString(record.at)}`,
    `from=${getAuditString(record.previous_provider_id)}`,
    `to=${getAuditString(record.next_provider_id)}`,
    `platform=${getAuditString(record.platform)}`
  ].join(" ");
}

function formatRouterModelEvent(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "- invalid router event";
  }
  const record = entry as Record<string, unknown>;
  return [
    `- router_operation=${getAuditString(record.operation)}`,
    `at=${getAuditString(record.at)}`,
    `requested=${getAuditString(record.requested_provider_id)}`,
    `selected=${getAuditString(record.selected_provider_id)}`
  ].join(" ");
}

function extractRouterModelEvents(metadata: Record<string, unknown>): unknown[] {
  const router = metadata.model_provider_router;
  if (!router || typeof router !== "object" || Array.isArray(router)) {
    return [];
  }
  const events = (router as Record<string, unknown>).events;
  return Array.isArray(events) ? events : [];
}

function getAuditString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "n/a";
}

function formatSkillList(skills: AgentSkillRecord[], platform: string): string {
  if (skills.length === 0) {
    return `No skills are available for ${platform}.`;
  }
  return [
    `Skills for ${platform}:`,
    ...skills.map((skill) =>
      `${skill.id}: ${skill.name} (${skill.risk_level}) permissions=${formatSkillPermissions(skill.permissions)}`
    )
  ].join("\n");
}

function formatSkillAudit(skills: AgentSkillRecord[], platform: string): string {
  if (skills.length === 0) {
    return `No skills are available for ${platform}.`;
  }
  return [
    `Skill audit for ${platform}:`,
    ...skills.map((skill) =>
      `${skill.id}: enabled=${skill.enabled}; risk=${skill.risk_level}; channels=${skill.channels.length > 0 ? skill.channels.join(",") : "all"}; permissions=${formatSkillPermissions(skill.permissions)}`
    )
  ].join("\n");
}

function formatSkillPermissions(permissions: string[]): string {
  return permissions.length > 0 ? permissions.join(",") : "none";
}

function parseCorrection(args: string): { target: string; content: string } | undefined {
  const splitIndex = args.indexOf("=>");
  if (splitIndex >= 0) {
    const target = args.slice(0, splitIndex).trim();
    const content = args.slice(splitIndex + 2).trim();
    return target && content ? { target, content } : undefined;
  }

  const firstWhitespace = args.search(/\s/);
  if (firstWhitespace <= 0) {
    return undefined;
  }
  const target = args.slice(0, firstWhitespace).trim();
  const content = args.slice(firstWhitespace).trim();
  return target && content ? { target, content } : undefined;
}

function formatCommandError(input: {
  code: string;
  command: string;
  message: string;
  available: string[];
}): string {
  return [
    "Command error:",
    `code: ${input.code}`,
    `command: ${input.command}`,
    `message: ${input.message}`,
    `available_commands: ${input.available.join(", ")}`
  ].join("\n");
}

function formatCommandRisk(command: CommandSchema): string {
  return `${command.name}(${command.risk_level})`;
}

function formatSessionStatus(session: AgentSession | undefined): string {
  if (!session) {
    return "Session is not available.";
  }

  return [
    `session_id: ${session.session_id}`,
    `state: ${session.state}`,
    `current_cycle_id: ${session.current_cycle_id ?? "n/a"}`,
    `cycle_used: ${session.budget_state.cycle_used ?? 0}/${session.budget_state.cycle_limit ?? "?"}`,
    `tool_call_used: ${session.budget_state.tool_call_used ?? 0}`,
    `last_active_at: ${session.last_active_at ?? "n/a"}`
  ].join("\n");
}

function formatSessionUsage(session: AgentSession | undefined): string {
  if (!session) {
    return "Session is not available.";
  }

  const budget = session.budget_state;
  return [
    "Usage:",
    `session_id: ${session.session_id}`,
    `state: ${session.state}`,
    `cycles: ${budget.cycle_used ?? 0}/${budget.cycle_limit ?? "?"}`,
    `tool_calls: ${budget.tool_call_used ?? 0}/${budget.tool_call_limit ?? "?"}`,
    `tokens: ${budget.token_budget_used ?? 0}/${budget.token_budget_total ?? "?"}`
  ].join("\n");
}
