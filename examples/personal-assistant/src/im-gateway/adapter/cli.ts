import { randomUUID } from "node:crypto";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export type CliAdapterOutputEvent =
  | { type: "send"; chat_id: string; message_id: string; content: MessageContent }
  | { type: "edit"; chat_id: string; message_id: string; content: MessageContent }
  | { type: "typing"; chat_id: string };

export interface CliAdapterOptions {
  output?: (event: CliAdapterOutputEvent) => void | Promise<void>;
}

export class CliAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "cli";

  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private output?: (event: CliAdapterOutputEvent) => void | Promise<void>;
  private userId = "local";
  private chatId = "cli:local";

  public constructor(options: CliAdapterOptions = {}) {
    this.output = options.output;
  }

  public setOutputHandler(handler: (event: CliAdapterOutputEvent) => void | Promise<void>): void {
    this.output = handler;
  }

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    this.userId = config.auth.user_id ?? this.userId;
    this.chatId = config.auth.chat_id ?? `cli:${this.userId}`;
  }

  public async stop(): Promise<void> {
    return;
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const messageId = randomUUID();
    await this.output?.({
      type: "send",
      chat_id: chatId,
      message_id: messageId,
      content
    });
    return { message_id: messageId };
  }

  public async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    await this.output?.({
      type: "edit",
      chat_id: chatId,
      message_id: messageId,
      content
    });
  }

  public async typingIndicator(chatId: string): Promise<void> {
    await this.output?.({
      type: "typing",
      chat_id: chatId
    });
  }

  public async receiveText(text: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.handler?.(normalizePersonalIngressMessage({
      platform: "cli",
      chat_id: this.chatId,
      sender_id: this.userId,
      content: text,
      metadata
    }));
  }
}
