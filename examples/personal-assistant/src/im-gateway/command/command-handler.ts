import type { AgentSession } from "@neurocore/protocol";
import type { ConversationRouter } from "../conversation/conversation-router.js";
import type { NotificationDispatcher } from "../notification/notification-dispatcher.js";
import type { UnifiedMessage } from "../types.js";

export interface CommandHandlerOptions {
  router: ConversationRouter;
  dispatcher: NotificationDispatcher;
}

export class CommandHandler {
  public constructor(private readonly options: CommandHandlerOptions) {}

  public async tryHandle(message: UnifiedMessage): Promise<boolean> {
    const text = extractText(message);
    if (!text?.startsWith("/")) {
      return false;
    }

    const command = text.trim().split(/\s+/, 1)[0];
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
}

function extractText(message: UnifiedMessage): string | undefined {
  if (message.content.type === "text" || message.content.type === "markdown") {
    return message.content.text;
  }
  return undefined;
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
