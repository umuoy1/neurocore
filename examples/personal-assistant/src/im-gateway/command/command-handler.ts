import type { AgentSession } from "@neurocore/protocol";
import type { PersonalMemoryStore } from "../../memory/personal-memory-store.js";
import { memorySourceFromMessage } from "../../memory/personal-memory-store.js";
import type { ConversationRouter } from "../conversation/conversation-router.js";
import type { NotificationDispatcher } from "../notification/notification-dispatcher.js";
import type { UnifiedMessage } from "../types.js";

export interface CommandHandlerOptions {
  router: ConversationRouter;
  dispatcher: NotificationDispatcher;
  memoryStore?: PersonalMemoryStore;
  resolveUserId?: (message: UnifiedMessage) => string;
}

export class CommandHandler {
  public constructor(private readonly options: CommandHandlerOptions) {}

  public async tryHandle(message: UnifiedMessage): Promise<boolean> {
    const text = extractText(message);
    if (!text?.startsWith("/")) {
      return false;
    }

    const trimmed = text.trim();
    const command = trimmed.split(/\s+/, 1)[0];
    const args = trimmed.slice(command.length).trim();
    switch (command) {
      case "/new":
        this.options.router.clearRoute(message);
        await this.reply(message, "Started a new conversation. Your next message will create a fresh session.");
        return true;
      case "/reset": {
        const existing = this.options.router.listRoutesForUser(message.sender_id).find(
          (route) => route.platform === message.platform && route.chat_id === message.chat_id
        );
        if (existing) {
          try {
            this.options.router.connect(existing.session_id).checkpoint();
          } catch {}
          this.options.router.clearRoute(message);
        }
        await this.reply(message, "Conversation reset. Previous state was checkpointed when possible.");
        return true;
      }
      case "/status": {
        const existing = this.options.router.listRoutesForUser(message.sender_id).find(
          (route) => route.platform === message.platform && route.chat_id === message.chat_id
        );
        if (!existing) {
          await this.reply(message, "No active conversation is mapped to this chat.");
          return true;
        }

        const handle = this.options.router.connect(existing.session_id);
        const session = handle.getSession();
        await this.reply(message, formatSessionStatus(session));
        return true;
      }
      case "/history": {
        const routes = this.options.router.listRoutesForUser(message.sender_id);
        if (routes.length === 0) {
          await this.reply(message, "No session history is available for this user.");
          return true;
        }

        const summary = routes
          .map((route) => `- ${route.platform}:${route.chat_id} -> ${route.session_id}`)
          .join("\n");
        await this.reply(message, `Recent session routes:\n${summary}`);
        return true;
      }
      case "/remember":
        await this.remember(message, args);
        return true;
      case "/memory":
      case "/memories":
        await this.listMemories(message);
        return true;
      case "/forget":
        await this.forget(message, args);
        return true;
      case "/correct":
        await this.correct(message, args);
        return true;
      case "/skills":
        await this.reply(message, "Skill inspection is not wired into the example app yet.");
        return true;
      default:
        await this.reply(message, `Unknown command: ${command}`);
        return true;
    }
  }

  private async reply(message: UnifiedMessage, text: string): Promise<void> {
    await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
      type: "text",
      text
    });
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
