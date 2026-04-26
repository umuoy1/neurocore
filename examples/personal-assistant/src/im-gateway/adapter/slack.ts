import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export interface SlackAdapterOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export interface SlackReceiveOptions {
  rawBody?: string;
  headers?: Record<string, string | undefined>;
}

export class SlackAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "slack";

  private config?: IMAdapterConfig;
  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  public constructor(options: SlackAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    if (!config.auth.bot_token) {
      throw new Error("Slack adapter requires auth.bot_token.");
    }
    this.config = config;
  }

  public async stop(): Promise<void> {
    return;
  }

  public async receiveEvent(payload: Record<string, unknown>, options: SlackReceiveOptions = {}): Promise<boolean> {
    if (!this.verifySignature(payload, options)) {
      return false;
    }

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
    const target = parseSlackChatId(chatId);
    const request = this.toPostMessageRequest(target, content);
    const result = await this.callApi<{ ts?: string }>("chat.postMessage", request);
    return {
      message_id: result?.ts ?? randomUUID()
    };
  }

  public async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    const target = parseSlackChatId(chatId);
    await this.callApi("chat.update", {
      channel: target.channel,
      ts: messageId,
      text: formatMessageText(content),
      mrkdwn: content.type === "markdown"
    });
  }

  public async typingIndicator(): Promise<void> {
    return;
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    const interaction = this.normalizeInteraction(payload);
    if (interaction) {
      return interaction;
    }

    const event = pickRecord(payload, "event");
    if (!event || asString(event.type) !== "message" || asString(event.subtype) === "bot_message") {
      return null;
    }

    const channel = asString(event.channel);
    const senderId = asString(event.user);
    if (!channel || !senderId) {
      return null;
    }

    const threadTs = asString(event.thread_ts);
    const chatId = formatSlackChatId(channel, threadTs);
    return normalizePersonalIngressMessage({
      message_id: asString(event.client_msg_id) ?? asString(event.ts) ?? randomUUID(),
      platform: "slack",
      chat_id: chatId,
      sender_id: senderId,
      timestamp: formatSlackTimestamp(event.ts),
      content: {
        type: "markdown",
        text: asString(event.text) ?? ""
      },
      metadata: payload,
      channel: {
        thread_id: threadTs,
        metadata: {
          transport: "slack_events_api",
          team_id: asString(payload.team_id),
          event_id: asString(payload.event_id),
          channel,
          thread_ts: threadTs
        }
      },
      identity: {
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          team_id: asString(payload.team_id)
        }
      }
    });
  }

  private normalizeInteraction(payload: Record<string, unknown>): UnifiedMessage | null {
    const type = asString(payload.type);
    if (type !== "block_actions" && type !== "interactive_message") {
      return null;
    }

    const user = pickRecord(payload, "user");
    const channel = pickRecord(payload, "channel");
    const message = pickRecord(payload, "message");
    const senderId = asString(user?.id);
    const channelId = asString(channel?.id);
    if (!senderId || !channelId) {
      return null;
    }

    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    const firstAction = actions.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)) as Record<string, unknown> | undefined;
    const actionData = parseActionValue(asString(firstAction?.value) ?? asString(firstAction?.action_id) ?? "");
    const threadTs = asString(message?.thread_ts) ?? asString(message?.ts);
    return normalizePersonalIngressMessage({
      message_id: asString(payload.callback_id) ?? randomUUID(),
      platform: "slack",
      chat_id: formatSlackChatId(channelId, threadTs),
      sender_id: senderId,
      timestamp: new Date(this.now()).toISOString(),
      content: {
        type: "action",
        action: actionData.action,
        params: actionData.approval_id ? { approval_id: actionData.approval_id } : undefined
      },
      reply_to: asString(message?.ts),
      metadata: payload,
      channel: {
        thread_id: threadTs,
        metadata: {
          transport: "slack_interactivity",
          team_id: asString(pickRecord(payload, "team")?.id),
          channel: channelId,
          thread_ts: threadTs
        }
      },
      identity: {
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          team_id: asString(pickRecord(payload, "team")?.id)
        }
      }
    });
  }

  private toPostMessageRequest(
    target: { channel: string; thread_ts?: string },
    content: MessageContent
  ): Record<string, unknown> {
    const base = {
      channel: target.channel,
      text: formatMessageText(content),
      mrkdwn: content.type === "markdown",
      thread_ts: target.thread_ts
    };

    if (content.type !== "approval_request") {
      return base;
    }

    return {
      ...base,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: content.text
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: content.approve_label ?? "Approve"
              },
              value: `approve:${content.approval_id}`,
              action_id: "approve"
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: content.reject_label ?? "Reject"
              },
              value: `reject:${content.approval_id}`,
              action_id: "reject"
            }
          ]
        }
      ]
    };
  }

  private async callApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | undefined> {
    const token = this.config?.auth.bot_token;
    if (!token) {
      throw new Error("Slack adapter is not started.");
    }

    const baseUrl = this.config?.auth.api_base_url ?? "https://slack.com/api";
    const response = await this.fetchImpl(`${baseUrl}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(stripUndefined(body))
    });
    if (!response.ok) {
      throw new Error(`Slack ${method} failed with status ${response.status}.`);
    }

    const payload = await response.json() as { ok?: boolean; error?: string; ts?: string } & T;
    if (payload.ok === false) {
      throw new Error(`Slack ${method} failed: ${payload.error ?? "unknown error"}`);
    }
    return payload as T;
  }

  private verifySignature(payload: Record<string, unknown>, options: SlackReceiveOptions): boolean {
    const secret = this.config?.auth.signing_secret;
    if (!secret) {
      return true;
    }

    const timestamp = options.headers?.["x-slack-request-timestamp"];
    const signature = options.headers?.["x-slack-signature"];
    const rawBody = options.rawBody ?? JSON.stringify(payload);
    if (!timestamp || !signature) {
      return false;
    }

    const ageMs = Math.abs(this.now() - (Number(timestamp) * 1000));
    if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) {
      return false;
    }

    const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
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

function formatMessageText(content: MessageContent): string {
  switch (content.type) {
    case "text":
    case "markdown":
      return content.text;
    case "status":
      return formatStatusText(content);
    case "approval_request":
      return content.text;
    case "image":
      return content.caption ? `${content.caption}\n${content.url}` : content.url;
    case "file":
      return `${content.filename}\n${content.url}`;
    case "action":
      return content.action;
  }
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

function formatSlackChatId(channel: string, threadTs: string | undefined): string {
  return threadTs ? `${channel}:${threadTs}` : channel;
}

function parseSlackChatId(chatId: string): { channel: string; thread_ts?: string } {
  const [channel, ...rest] = chatId.split(":");
  const threadTs = rest.join(":");
  return threadTs ? { channel, thread_ts: threadTs } : { channel };
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

function formatSlackTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const seconds = Number(value.split(".")[0]);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toISOString();
    }
  }
  return new Date().toISOString();
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
