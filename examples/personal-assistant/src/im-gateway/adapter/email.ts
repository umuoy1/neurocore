import { randomUUID } from "node:crypto";
import type { EmailSendProvider } from "../../connectors/types.js";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";

export interface EmailAdapterOptions {
  sender?: EmailSendProvider;
  now?: () => string;
}

const UNTRUSTED_EMAIL_REASON = "Inbound email content can contain spoofed, unverified or adversarial instructions.";

export class EmailAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "email";

  private config?: IMAdapterConfig;
  private handler?: (msg: UnifiedMessage) => void | Promise<void>;
  private readonly sender?: EmailSendProvider;
  private readonly now: () => string;

  public constructor(options: EmailAdapterOptions = {}) {
    this.sender = options.sender;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    this.config = config;
  }

  public async stop(): Promise<void> {
    return;
  }

  public async receiveEmailEvent(event: Record<string, unknown>): Promise<boolean> {
    const message = this.normalizeEvent(event);
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
    if (!this.sender) {
      throw new Error("Email adapter requires a sender provider for outbound delivery.");
    }

    const result = await this.sender.send({
      to: parseRecipients(chatId),
      subject: formatSubject(content),
      body: formatBody(content)
    });
    return {
      message_id: result.message_id
    };
  }

  public async editMessage(): Promise<void> {
    return;
  }

  public async typingIndicator(): Promise<void> {
    return;
  }

  private normalizeEvent(event: Record<string, unknown>): UnifiedMessage | null {
    const from = asString(event.from);
    if (!from) {
      return null;
    }

    const subject = asString(event.subject) ?? "(no subject)";
    const date = asString(event.date) ?? this.now();
    const body = asString(event.body_text) ?? asString(event.text) ?? asString(event.body_preview) ?? "";
    const threadId = asString(event.thread_id) ?? asString(event.in_reply_to);
    const messageId = asString(event.message_id) ?? randomUUID();
    return normalizePersonalIngressMessage({
      message_id: messageId,
      platform: "email",
      chat_id: from,
      sender_id: from,
      timestamp: date,
      content: {
        type: "markdown",
        text: formatInboundText(from, subject, date, body)
      },
      reply_to: asString(event.in_reply_to),
      metadata: {
        ...event,
        untrusted_content: true,
        untrusted_reason: UNTRUSTED_EMAIL_REASON
      },
      channel: {
        thread_id: threadId,
        metadata: {
          transport: "email",
          subject,
          message_id: messageId,
          thread_id: threadId,
          untrusted_content: true,
          untrusted_reason: UNTRUSTED_EMAIL_REASON
        }
      },
      identity: {
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: {
          from,
          untrusted_content: true
        }
      }
    });
  }

  private hasSenderAllowlist(): boolean {
    return Boolean(this.config?.allowed_senders && this.config.allowed_senders.length > 0);
  }

  private isAllowedSender(senderId: string): boolean {
    if (!this.hasSenderAllowlist()) {
      return true;
    }
    const normalized = senderId.toLowerCase();
    return this.config?.allowed_senders?.some((allowed) => allowed.toLowerCase() === normalized) ?? false;
  }
}

function formatInboundText(from: string, subject: string, date: string, body: string): string {
  return [
    "UNTRUSTED_EMAIL_CONTENT",
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    "",
    body
  ].join("\n");
}

function parseRecipients(chatId: string): string[] {
  const normalized = chatId.startsWith("email:") ? chatId.slice("email:".length) : chatId;
  return normalized.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatSubject(content: MessageContent): string {
  switch (content.type) {
    case "status":
      return `NeuroCore status: ${content.phase}`;
    case "approval_request":
      return "NeuroCore approval required";
    default:
      return "NeuroCore Assistant";
  }
}

function formatBody(content: MessageContent): string {
  switch (content.type) {
    case "text":
    case "markdown":
      return content.text;
    case "status":
      return formatStatusText(content);
    case "approval_request":
      return [
        content.text,
        "",
        `Approval id: ${content.approval_id}`,
        `${content.approve_label ?? "Approve"} / ${content.reject_label ?? "Reject"}`
      ].join("\n");
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
