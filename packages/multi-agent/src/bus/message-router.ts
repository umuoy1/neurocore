import type { InterAgentMessage } from "../types.js";
import type { MessageHandler } from "./inter-agent-bus.js";

interface SubscriberEntry {
  id: number;
  handler: MessageHandler;
}

export class MessageRouter {
  constructor(
    private readonly handlers: Map<string, MessageHandler>,
    private readonly topicSubscribers: Map<string, Set<SubscriberEntry>>
  ) {}

  resolveTargets(message: InterAgentMessage): MessageHandler[] {
    if (message.target_agent_id) {
      const handler = this.handlers.get(message.target_agent_id);
      return handler ? [handler] : [];
    }

    if (message.topic) {
      const subs = this.topicSubscribers.get(message.topic);
      return subs ? [...subs].map((s) => s.handler) : [];
    }

    return [];
  }
}
