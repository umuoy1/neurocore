import type { InterAgentMessage } from "../types.js";

export interface MessageHandler {
  (message: InterAgentMessage): Promise<InterAgentMessage | void>;
}

export interface StreamHandler {
  onData(message: InterAgentMessage): void;
  onEnd(): void;
  onError(error: Error): void;
}

export interface InterAgentBus {
  send(message: InterAgentMessage): Promise<InterAgentMessage>;
  publish(topic: string, message: InterAgentMessage): Promise<void>;
  subscribe(topic: string, handler: MessageHandler): () => void;
  openStream(targetInstanceId: string, correlationId: string): Promise<{
    write(data: Record<string, unknown>): void;
    end(): void;
  }>;
  onStream(handler: (correlationId: string, stream: StreamHandler) => void): void;
  close(): Promise<void>;
}
