import type { InterAgentMessage } from "../types.js";
import type { InterAgentBus, MessageHandler, StreamHandler } from "./inter-agent-bus.js";
import { MessageRouter } from "./message-router.js";

interface PendingRequest {
  resolve: (msg: InterAgentMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SubscriberEntry {
  id: number;
  handler: MessageHandler;
}

export class LocalInterAgentBus implements InterAgentBus {
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly topicSubscribers = new Map<string, Set<SubscriberEntry>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly streams = new Map<string, StreamHandler>();
  private readonly router = new MessageRouter(this.handlers, this.topicSubscribers);
  private streamListener: ((correlationId: string, stream: StreamHandler) => void) | null = null;
  private nextSubId = 0;
  private defaultTimeoutMs = 30_000;

  registerHandler(instanceId: string, handler: MessageHandler): void {
    this.handlers.set(instanceId, handler);
  }

  unregisterHandler(instanceId: string): void {
    this.handlers.delete(instanceId);
  }

  async send(message: InterAgentMessage): Promise<InterAgentMessage> {
    if (message.pattern === "response") {
      const pending = this.pendingRequests.get(message.correlation_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.correlation_id);
        pending.resolve(message);
      }
      return message;
    }

    const handler = message.target_agent_id
      ? this.handlers.get(message.target_agent_id)
      : undefined;

    if (!handler) {
      throw new Error(`No handler for agent '${message.target_agent_id}'`);
    }

    return new Promise<InterAgentMessage>((resolve, reject) => {
      const timeoutMs = message.ttl_ms ?? this.defaultTimeoutMs;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.correlation_id);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(message.correlation_id, { resolve, reject, timer });

      handler(message).then((response) => {
        if (response) {
          const pending = this.pendingRequests.get(message.correlation_id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.correlation_id);
            pending.resolve(response);
          }
        }
      }).catch((err) => {
        const pending = this.pendingRequests.get(message.correlation_id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(message.correlation_id);
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async publish(topic: string, message: InterAgentMessage): Promise<void> {
    const subscribers = this.topicSubscribers.get(topic);
    if (!subscribers || subscribers.size === 0) return;

    const promises = [...subscribers].map((sub) =>
      sub.handler(message).catch(() => {})
    );
    await Promise.allSettled(promises);
  }

  subscribe(topic: string, handler: MessageHandler): () => void {
    let subs = this.topicSubscribers.get(topic);
    if (!subs) {
      subs = new Set();
      this.topicSubscribers.set(topic, subs);
    }
    const entry: SubscriberEntry = { id: this.nextSubId++, handler };
    subs.add(entry);
    return () => {
      subs!.delete(entry);
      if (subs!.size === 0) {
        this.topicSubscribers.delete(topic);
      }
    };
  }

  async openStream(targetInstanceId: string, correlationId: string): Promise<{
    write(data: Record<string, unknown>): void;
    end(): void;
  }> {
    const streamHandler = this.streams.get(correlationId);
    return {
      write: (data: Record<string, unknown>) => {
        const msg: InterAgentMessage = {
          message_id: `msg-stream-${Date.now()}`,
          correlation_id: correlationId,
          trace_id: correlationId,
          pattern: "stream_data",
          source_agent_id: "",
          source_instance_id: "",
          target_agent_id: targetInstanceId,
          payload: data,
          created_at: new Date().toISOString()
        };
        streamHandler?.onData(msg);
      },
      end: () => {
        const msg: InterAgentMessage = {
          message_id: `msg-stream-end-${Date.now()}`,
          correlation_id: correlationId,
          trace_id: correlationId,
          pattern: "stream_end",
          source_agent_id: "",
          source_instance_id: "",
          target_agent_id: targetInstanceId,
          payload: {},
          created_at: new Date().toISOString()
        };
        streamHandler?.onData(msg);
        streamHandler?.onEnd();
        this.streams.delete(correlationId);
      }
    };
  }

  onStream(handler: (correlationId: string, stream: StreamHandler) => void): void {
    this.streamListener = handler;
  }

  registerStream(correlationId: string, stream: StreamHandler): void {
    this.streams.set(correlationId, stream);
    if (this.streamListener) {
      this.streamListener(correlationId, stream);
    }
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Bus closed"));
    }
    this.pendingRequests.clear();
    this.handlers.clear();
    this.topicSubscribers.clear();
    this.streams.clear();
  }
}
