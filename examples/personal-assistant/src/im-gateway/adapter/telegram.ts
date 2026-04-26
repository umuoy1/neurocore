import { randomUUID } from "node:crypto";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import { formatMediaDeliveryText } from "../media/media-attachments.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export interface TelegramAdapterOptions {
  fetch?: typeof fetch;
}

export class TelegramAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "telegram";

  private config?: IMAdapterConfig;
  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: TelegramAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    if (!config.auth.bot_token) {
      throw new Error("Telegram adapter requires auth.bot_token.");
    }
    this.config = config;
  }

  public async stop(): Promise<void> {
    return;
  }

  public async receiveUpdate(update: Record<string, unknown>): Promise<boolean> {
    const message = this.normalizeUpdate(update);
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
    const request = this.toSendRequest(chatId, content);
    const result = await this.callApi<{ message_id?: string | number }>(request.method, request.body);
    return {
      message_id: result?.message_id !== undefined ? String(result.message_id) : randomUUID()
    };
  }

  public async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    const request = this.toEditRequest(chatId, messageId, content);
    await this.callApi(request.method, request.body);
  }

  public async typingIndicator(chatId: string): Promise<void> {
    await this.callApi("sendChatAction", {
      chat_id: chatId,
      action: "typing"
    });
  }

  private normalizeUpdate(update: Record<string, unknown>): UnifiedMessage | null {
    const callbackQuery = pickRecord(update, "callback_query");
    if (callbackQuery) {
      return this.normalizeCallbackQuery(update, callbackQuery);
    }

    const message = pickRecord(update, "message") ?? pickRecord(update, "edited_message");
    if (!message) {
      return null;
    }

    return this.normalizeTextMessage(update, message);
  }

  private normalizeTextMessage(
    update: Record<string, unknown>,
    message: Record<string, unknown>
  ): UnifiedMessage | null {
    const chat = pickRecord(message, "chat");
    const from = pickRecord(message, "from");
    const chatId = stringifyId(chat?.id);
    const senderId = stringifyId(from?.id);
    if (!chatId || !senderId) {
      return null;
    }

    const text = asString(message.text) ?? asString(message.caption) ?? "";
    const displayName = formatDisplayName(from);
    return normalizePersonalIngressMessage({
      message_id: stringifyId(message.message_id) ?? randomUUID(),
      platform: "telegram",
      chat_id: chatId,
      sender_id: senderId,
      timestamp: formatTelegramTimestamp(message.date),
      content: { type: "text", text },
      reply_to: stringifyId(pickRecord(message, "reply_to_message")?.message_id),
      metadata: update,
      channel: {
        metadata: {
          transport: "telegram_bot_api",
          chat_type: asString(chat?.type),
          chat_title: asString(chat?.title),
          update_id: update.update_id
        }
      },
      identity: {
        display_name: displayName,
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          username: asString(from?.username),
          first_name: asString(from?.first_name),
          last_name: asString(from?.last_name),
          language_code: asString(from?.language_code),
          is_bot: typeof from?.is_bot === "boolean" ? from.is_bot : undefined
        }
      }
    });
  }

  private normalizeCallbackQuery(
    update: Record<string, unknown>,
    callbackQuery: Record<string, unknown>
  ): UnifiedMessage | null {
    const from = pickRecord(callbackQuery, "from");
    const message = pickRecord(callbackQuery, "message");
    const chat = pickRecord(message, "chat");
    const senderId = stringifyId(from?.id);
    const chatId = stringifyId(chat?.id) ?? (senderId ? `telegram:${senderId}` : undefined);
    if (!chatId || !senderId) {
      return null;
    }

    const action = parseActionData(asString(callbackQuery.data) ?? "");
    return normalizePersonalIngressMessage({
      message_id: asString(callbackQuery.id) ?? randomUUID(),
      platform: "telegram",
      chat_id: chatId,
      sender_id: senderId,
      timestamp: new Date().toISOString(),
      content: {
        type: "action",
        action: action.action,
        params: action.approval_id ? { approval_id: action.approval_id } : undefined
      },
      reply_to: stringifyId(message?.message_id),
      metadata: update,
      channel: {
        metadata: {
          transport: "telegram_bot_api",
          callback_query_id: asString(callbackQuery.id),
          chat_type: asString(chat?.type)
        }
      },
      identity: {
        display_name: formatDisplayName(from),
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          username: asString(from?.username),
          first_name: asString(from?.first_name),
          last_name: asString(from?.last_name)
        }
      }
    });
  }

  private toSendRequest(chatId: string, content: MessageContent): { method: string; body: Record<string, unknown> } {
    switch (content.type) {
      case "markdown":
        return {
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: content.text,
            parse_mode: "Markdown"
          }
        };
      case "status":
        return {
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: formatStatusText(content)
          }
        };
      case "approval_request":
        return {
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: content.text,
            reply_markup: {
              inline_keyboard: [[
                {
                  text: content.approve_label ?? "Approve",
                  callback_data: `approve:${content.approval_id}`
                },
                {
                  text: content.reject_label ?? "Reject",
                  callback_data: `reject:${content.approval_id}`
                }
              ]]
            }
          }
        };
      case "image":
        return {
          method: "sendPhoto",
          body: {
            chat_id: chatId,
            photo: content.url,
            caption: content.caption
          }
        };
      case "file":
        return {
          method: "sendDocument",
          body: {
            chat_id: chatId,
            document: content.url,
            caption: content.filename
          }
        };
      case "audio":
        return {
          method: "sendAudio",
          body: {
            chat_id: chatId,
            audio: content.url,
            caption: content.transcript ?? content.filename
          }
        };
      case "voice":
        return {
          method: "sendVoice",
          body: {
            chat_id: chatId,
            voice: content.url,
            caption: content.transcript
          }
        };
      case "action":
        return {
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: content.action
          }
        };
      case "text":
      default:
        return {
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: content.type === "text" ? content.text : JSON.stringify(content)
          }
        };
    }
  }

  private toEditRequest(chatId: string, messageId: string, content: MessageContent): { method: string; body: Record<string, unknown> } {
    const text = content.type === "status"
      ? formatStatusText(content)
      : content.type === "markdown" || content.type === "text"
        ? content.text
        : JSON.stringify(content);
    return {
      method: "editMessageText",
      body: {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: content.type === "markdown" ? "Markdown" : undefined
      }
    };
  }

  private async callApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | undefined> {
    const token = this.config?.auth.bot_token;
    if (!token) {
      throw new Error("Telegram adapter is not started.");
    }
    const baseUrl = this.config?.auth.api_base_url ?? "https://api.telegram.org";
    const response = await this.fetchImpl(`${baseUrl}/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(stripUndefined(body))
    });
    if (!response.ok) {
      throw new Error(`Telegram ${method} failed with status ${response.status}.`);
    }
    const payload = await response.json() as { ok?: boolean; result?: T; description?: string };
    if (payload.ok === false) {
      throw new Error(`Telegram ${method} failed: ${payload.description ?? "unknown error"}`);
    }
    return payload.result;
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

function parseActionData(data: string): { action: string; approval_id?: string } {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const action = asString(record.action) ?? "unknown";
      const approvalId = asString(record.approval_id);
      return approvalId ? { action, approval_id: approvalId } : { action };
    }
  } catch {}

  const match = /^(approve|approved|reject|rejected):(.+)$/.exec(data);
  if (match) {
    return {
      action: match[1],
      approval_id: match[2]
    };
  }
  return { action: data || "unknown" };
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

function formatDisplayName(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parts = [asString(value.first_name), asString(value.last_name)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : asString(value.username);
}

function formatTelegramTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return new Date().toISOString();
}

function stringifyId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
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
