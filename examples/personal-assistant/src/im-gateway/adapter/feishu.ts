import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import { formatMediaDeliveryText } from "../media/media-attachments.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

interface FeishuTokenResponse {
  app_access_token?: string;
  expire?: number;
  msg?: string;
}

export class FeishuAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "feishu";

  private config?: IMAdapterConfig;
  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private accessToken?: { value: string; expiresAt: number };
  private socket?: WebSocket;

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    this.config = config;
    await this.ensureAccessToken();

    const wsUrl = config.auth.ws_url;
    if (!wsUrl) {
      return;
    }

    this.socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${(await this.ensureAccessToken()).value}`
      }
    });

    this.socket.on("message", (raw) => {
      const parsed = this.safeJsonParse(raw.toString());
      if (!parsed) {
        return;
      }

      const eventType = this.pickEventType(parsed);
      if (eventType === "im.message.receive_v1") {
        const message = this.normalizeMessage(parsed);
        if (message) {
          this.handler?.(message);
        }
        return;
      }

      if (eventType === "card.action.trigger") {
        const actionMessage = this.normalizeCardAction(parsed);
        if (actionMessage) {
          this.handler?.(actionMessage);
        }
      }
    });
  }

  public async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
      this.socket.close();
      this.socket = undefined;
    });
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const token = await this.ensureAccessToken();
    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: this.toFeishuMessageType(content),
        content: JSON.stringify(this.toFeishuContent(content))
      })
    });

    if (!response.ok) {
      throw new Error(`Feishu sendMessage failed with status ${response.status}.`);
    }

    const body = (await response.json()) as { data?: { message_id?: string } };
    return {
      message_id: body.data?.message_id ?? randomUUID()
    };
  }

  public async editMessage(_chatId: string, messageId: string, content: MessageContent): Promise<void> {
    const token = await this.ensureAccessToken();
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        content: JSON.stringify(this.toFeishuContent(content))
      })
    });

    if (!response.ok) {
      throw new Error(`Feishu editMessage failed with status ${response.status}.`);
    }
  }

  public async typingIndicator(): Promise<void> {
    return;
  }

  private async ensureAccessToken(): Promise<{ value: string; expiresAt: number }> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 10_000) {
      return this.accessToken;
    }

    if (!this.config?.auth.app_id || !this.config.auth.app_secret) {
      throw new Error("Feishu adapter requires auth.app_id and auth.app_secret.");
    }

    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        app_id: this.config.auth.app_id,
        app_secret: this.config.auth.app_secret
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to acquire Feishu access token: ${response.status}`);
    }

    const payload = (await response.json()) as FeishuTokenResponse;
    if (!payload.app_access_token) {
      throw new Error(`Feishu token response did not include app_access_token: ${payload.msg ?? "unknown error"}`);
    }

    this.accessToken = {
      value: payload.app_access_token,
      expiresAt: now + ((payload.expire ?? 7200) * 1000)
    };
    return this.accessToken;
  }

  private normalizeMessage(payload: Record<string, unknown>): UnifiedMessage | null {
    const event = pickRecord(payload, "event") ?? pickRecord(payload, "data");
    const message = pickRecord(event, "message");
    if (!message) {
      return null;
    }

    const sender = pickRecord(event, "sender");
    const senderId = pickRecord(sender, "sender_id");
    const contentText = this.extractTextContent(asString(message.content));
    return normalizePersonalIngressMessage({
      message_id: asString(message.message_id) ?? randomUUID(),
      platform: "feishu",
      chat_id: asString(message.chat_id) ?? "",
      sender_id: asString(senderId?.open_id) ?? asString(senderId?.user_id) ?? "unknown",
      timestamp: new Date().toISOString(),
      content: { type: "text", text: contentText ?? "" },
      metadata: payload,
      channel: {
        thread_id: asString(message.thread_id) ?? asString(message.root_id),
        metadata: {
          tenant_key: asString(sender?.tenant_key)
        }
      },
      identity: {
        trust_level: "paired",
        metadata: {
          user_id: asString(senderId?.user_id),
          open_id: asString(senderId?.open_id),
          union_id: asString(senderId?.union_id)
        }
      }
    });
  }

  private normalizeCardAction(payload: Record<string, unknown>): UnifiedMessage | null {
    const event = pickRecord(payload, "event") ?? pickRecord(payload, "data");
    const openMessageId = asString(event?.open_message_id);
    const chatId = asString(event?.open_chat_id) ?? asString(event?.chat_id) ?? "";
    const operator = pickRecord(event, "operator");
    const approverId = asString(operator?.open_id) ?? "unknown";
    const action = pickRecord(event, "action");
    const value = pickRecord(action, "value");
    const decision = asString(value?.decision) ?? asString(value?.action);
    const approvalId = asString(value?.approval_id);
    if (!decision) {
      return null;
    }

    return normalizePersonalIngressMessage({
      message_id: randomUUID(),
      platform: "feishu",
      chat_id: chatId,
      sender_id: approverId,
      timestamp: new Date().toISOString(),
      content: {
        type: "action",
        action: decision,
        params: approvalId ? { approval_id: approvalId } : undefined
      },
      reply_to: openMessageId,
      metadata: payload,
      channel: {
        metadata: {}
      },
      identity: {
        trust_level: "paired",
        metadata: {
          open_id: asString(operator?.open_id),
          user_id: asString(operator?.user_id)
        }
      }
    });
  }

  private toFeishuMessageType(content: MessageContent): string {
    switch (content.type) {
      case "markdown":
        return "post";
      case "approval_request":
        return "interactive";
      case "status":
        return "text";
      default:
        return "text";
    }
  }

  private toFeishuContent(content: MessageContent): Record<string, unknown> {
    switch (content.type) {
      case "markdown":
        return {
          zh_cn: {
            title: "NeuroCore Assistant",
            content: [[{ tag: "text", text: content.text }]]
          }
        };
      case "approval_request":
        return {
          config: { wide_screen_mode: true },
          header: {
            title: {
              tag: "plain_text",
              content: "Approval Required"
            }
          },
          elements: [
            {
              tag: "markdown",
              content: content.text
            },
            {
              tag: "action",
              actions: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: content.approve_label ?? "Approve" },
                  type: "primary",
                  value: {
                    decision: "approve",
                    approval_id: content.approval_id
                  }
                },
                {
                  tag: "button",
                  text: { tag: "plain_text", content: content.reject_label ?? "Reject" },
                  value: {
                    decision: "reject",
                    approval_id: content.approval_id
                  }
                }
              ]
            }
          ]
        };
      case "status":
        return {
          text: formatStatusText(content)
        };
      case "image":
      case "file":
      case "audio":
      case "voice":
        return {
          text: formatMediaDeliveryText(content)
        };
      case "text":
      default:
        return {
          text: content.type === "text" ? content.text : JSON.stringify(content)
        };
    }
  }

  private extractTextContent(content: string | undefined): string | undefined {
    if (!content) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed.text === "string") {
        return parsed.text;
      }
    } catch {}
    return content;
  }

  private pickEventType(payload: Record<string, unknown>): string | undefined {
    const header = pickRecord(payload, "header");
    return asString(header?.event_type) ?? asString(payload.type);
  }

  private safeJsonParse(raw: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
    return undefined;
  }
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
