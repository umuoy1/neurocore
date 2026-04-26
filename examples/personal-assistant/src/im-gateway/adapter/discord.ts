import { randomUUID } from "node:crypto";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export interface DiscordAdapterOptions {
  fetch?: typeof fetch;
}

export class DiscordAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "discord";

  private config?: IMAdapterConfig;
  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: DiscordAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    if (!config.auth.bot_token) {
      throw new Error("Discord adapter requires auth.bot_token.");
    }
    this.config = config;
  }

  public async stop(): Promise<void> {
    return;
  }

  public async receiveGatewayEvent(payload: Record<string, unknown>): Promise<boolean> {
    const message = this.normalizePayload(payload);
    if (!message) {
      return false;
    }
    if (!this.isAllowedSender(message.sender_id)) {
      return false;
    }
    await this.handler?.(message);
    return true;
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const channelId = await this.resolveTargetChannel(chatId);
    const result = await this.callApi<{ id?: string }>("POST", `/channels/${channelId}/messages`, this.toMessageBody(content));
    return {
      message_id: result?.id ?? randomUUID()
    };
  }

  public async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    const channelId = await this.resolveTargetChannel(chatId);
    await this.callApi("PATCH", `/channels/${channelId}/messages/${messageId}`, this.toMessageBody(content));
  }

  public async typingIndicator(chatId: string): Promise<void> {
    const channelId = await this.resolveTargetChannel(chatId);
    await this.callApi("POST", `/channels/${channelId}/typing`, {});
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    const interaction = this.normalizeInteraction(payload);
    if (interaction) {
      return interaction;
    }

    const event = asString(payload.t) === "MESSAGE_CREATE" && pickRecord(payload, "d")
      ? pickRecord(payload, "d")
      : payload;
    if (!event || asString(event.type) && asString(event.type) !== "message") {
      return null;
    }

    const author = pickRecord(event, "author");
    if (author?.bot === true) {
      return null;
    }

    const channelId = asString(event.channel_id);
    const senderId = asString(author?.id);
    if (!channelId || !senderId) {
      return null;
    }

    const threadId = asString(pickRecord(event, "thread")?.id);
    return normalizePersonalIngressMessage({
      message_id: asString(event.id) ?? randomUUID(),
      platform: "discord",
      chat_id: threadId ?? channelId,
      sender_id: senderId,
      timestamp: asString(event.timestamp) ?? new Date().toISOString(),
      content: {
        type: "markdown",
        text: asString(event.content) ?? ""
      },
      reply_to: asString(pickRecord(event, "message_reference")?.message_id),
      metadata: payload,
      channel: {
        thread_id: threadId,
        metadata: {
          transport: "discord_gateway",
          guild_id: asString(event.guild_id),
          channel_id: channelId,
          thread_id: threadId,
          target_kind: threadId ? "thread" : event.guild_id ? "channel" : "dm"
        }
      },
      identity: {
        display_name: asString(author?.global_name) ?? asString(author?.username),
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          username: asString(author?.username),
          discriminator: asString(author?.discriminator),
          guild_id: asString(event.guild_id)
        }
      }
    });
  }

  private normalizeInteraction(payload: Record<string, unknown>): UnifiedMessage | null {
    const type = typeof payload.type === "number" ? payload.type : undefined;
    if (type !== 3) {
      return null;
    }

    const user = pickRecord(payload, "user") ?? pickRecord(pickRecord(payload, "member"), "user");
    const senderId = asString(user?.id);
    const channelId = asString(payload.channel_id);
    if (!senderId || !channelId) {
      return null;
    }

    const action = parseActionValue(asString(pickRecord(payload, "data")?.custom_id) ?? "");
    const message = pickRecord(payload, "message");
    return normalizePersonalIngressMessage({
      message_id: asString(payload.id) ?? randomUUID(),
      platform: "discord",
      chat_id: channelId,
      sender_id: senderId,
      timestamp: new Date().toISOString(),
      content: {
        type: "action",
        action: action.action,
        params: action.approval_id ? { approval_id: action.approval_id } : undefined
      },
      reply_to: asString(message?.id),
      metadata: payload,
      channel: {
        metadata: {
          transport: "discord_interaction",
          guild_id: asString(payload.guild_id),
          channel_id: channelId
        }
      },
      identity: {
        display_name: asString(user?.global_name) ?? asString(user?.username),
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          username: asString(user?.username),
          guild_id: asString(payload.guild_id)
        }
      }
    });
  }

  private toMessageBody(content: MessageContent): Record<string, unknown> {
    switch (content.type) {
      case "approval_request":
        return {
          content: content.text,
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: content.approve_label ?? "Approve",
                  custom_id: `approve:${content.approval_id}`
                },
                {
                  type: 2,
                  style: 4,
                  label: content.reject_label ?? "Reject",
                  custom_id: `reject:${content.approval_id}`
                }
              ]
            }
          ]
        };
      case "image":
        return {
          content: content.caption ? `${content.caption}\n${content.url}` : content.url
        };
      case "file":
        return {
          content: `${content.filename}\n${content.url}`
        };
      case "status":
        return {
          content: formatStatusText(content)
        };
      case "action":
        return {
          content: content.action
        };
      case "markdown":
      case "text":
      default:
        return {
          content: content.type === "markdown" || content.type === "text" ? content.text : JSON.stringify(content)
        };
    }
  }

  private async resolveTargetChannel(chatId: string): Promise<string> {
    if (!chatId.startsWith("dm:")) {
      return chatId;
    }

    const recipientId = chatId.slice("dm:".length);
    const result = await this.callApi<{ id?: string }>("POST", "/users/@me/channels", {
      recipient_id: recipientId
    });
    if (!result?.id) {
      throw new Error(`Discord DM channel creation did not return an id for ${recipientId}.`);
    }
    return result.id;
  }

  private async callApi<T = unknown>(method: string, path: string, body: Record<string, unknown>): Promise<T | undefined> {
    const token = this.config?.auth.bot_token;
    if (!token) {
      throw new Error("Discord adapter is not started.");
    }

    const baseUrl = this.config?.auth.api_base_url ?? "https://discord.com/api/v10";
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(stripUndefined(body))
    });
    if (!response.ok) {
      throw new Error(`Discord ${method} ${path} failed with status ${response.status}.`);
    }
    if (response.status === 204) {
      return undefined;
    }
    return await response.json() as T;
  }

  private hasSenderAllowlist(): boolean {
    return Boolean(this.config?.allowed_senders && this.config.allowed_senders.length > 0);
  }

  private isAllowedSender(senderId: string): boolean {
    if (!this.hasSenderAllowlist()) {
      return true;
    }
    return this.config?.allowed_senders?.includes(senderId) ?? false;
  }
}

function parseActionValue(value: string): { action: string; approval_id?: string } {
  const match = /^(approve|approved|reject|rejected):(.+)$/.exec(value);
  if (match) {
    return {
      action: match[1],
      approval_id: match[2]
    };
  }
  return { action: value || "unknown" };
}

function formatStatusText(content: Extract<MessageContent, { type: "status" }>): string {
  const headline = `${formatPhaseLabel(content.phase)} · ${formatStateLabel(content.state)}`;
  const lines = [headline, content.text];
  if (content.detail) {
    lines.push(content.detail);
  }
  if (content.data) {
    const dataLines = Object.entries(content.data)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${formatDataValue(value)}`);
    lines.push(...dataLines);
  }
  return lines.join("\n");
}

function formatPhaseLabel(phase: string): string {
  switch (phase) {
    case "memory_retrieval":
      return "Memory";
    case "reasoning":
      return "Reasoning";
    case "tool_execution":
      return "Tool";
    case "response_generation":
      return "Response";
    case "approval":
      return "Approval";
    case "session":
      return "Session";
    default:
      return phase;
  }
}

function formatStateLabel(state: string): string {
  switch (state) {
    case "started":
      return "started";
    case "in_progress":
      return "in progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return state;
  }
}

function formatDataValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function pickRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  return candidate as Record<string, unknown>;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
