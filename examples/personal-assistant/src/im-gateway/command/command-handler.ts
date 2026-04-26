import type { AgentSession, SessionCheckpoint } from "@neurocore/protocol";
import type { PersonalMemoryStore } from "../../memory/personal-memory-store.js";
import { memorySourceFromMessage } from "../../memory/personal-memory-store.js";
import type { ConversationRouter } from "../conversation/conversation-router.js";
import type { SessionRoute } from "../types.js";
import type { NotificationDispatcher } from "../notification/notification-dispatcher.js";
import type { UnifiedMessage } from "../types.js";

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
}

export interface CommandHandlerOptions {
  router: ConversationRouter;
  dispatcher: NotificationDispatcher;
  memoryStore?: PersonalMemoryStore;
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
        available: this.commands.map((item) => item.name)
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
        description: "Show the current assistant model configuration.",
        usage: "/model",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.model(message)
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
        usage: "/skills",
        risk_level: "none",
        parameters: [],
        execute: ({ message }) => this.reply(message, "Skill inspection is not wired into the example app yet.")
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

  private async model(message: UnifiedMessage): Promise<void> {
    const model = this.options.model;
    await this.reply(message, [
      "Model:",
      `provider: ${model?.provider ?? "custom-reasoner"}`,
      `model: ${model?.model ?? "custom"}`,
      `api_url: ${model?.apiUrl ?? "n/a"}`
    ].join("\n"));
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

  private resolveUserId(message: UnifiedMessage): string {
    return this.options.resolveUserId?.(message) ?? message.sender_id;
  }
}

function extractText(message: UnifiedMessage): string | undefined {
  if (message.content.type === "text" || message.content.type === "markdown") {
    return message.content.text;
  }
  return undefined;
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
