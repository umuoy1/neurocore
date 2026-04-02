import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export interface AdapterSendResult {
  message_id: string;
}

export interface IMAdapter {
  readonly platform: IMPlatform;
  start(config: IMAdapterConfig): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: string, content: MessageContent): Promise<AdapterSendResult>;
  editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void>;
  onMessage(handler: (msg: UnifiedMessage) => void): void;
  typingIndicator?(chatId: string): Promise<void>;
}
