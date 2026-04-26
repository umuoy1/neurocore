import { randomUUID } from "node:crypto";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export class CliAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "cli";

  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private userId = "local";
  private chatId = "cli:local";

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

  public async sendMessage(_chatId: string, _content: MessageContent): Promise<{ message_id: string }> {
    return { message_id: randomUUID() };
  }

  public async editMessage(): Promise<void> {
    return;
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
