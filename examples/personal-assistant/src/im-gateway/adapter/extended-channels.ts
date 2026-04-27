import { randomUUID } from "node:crypto";
import type { IMAdapter } from "./im-adapter.js";
import { normalizePersonalIngressMessage } from "../ingress.js";
import { formatMediaDeliveryText } from "../media/media-attachments.js";
import type { IMAdapterConfig, MessageContent, UnifiedMessage } from "../types.js";

export interface ExtendedChannelAdapterOptions {
  fetch?: typeof fetch;
  now?: () => string;
}

type ExtendedPlatform = "matrix" | "signal" | "teams" | "wechat" | "whatsapp";

interface HttpRequestSpec {
  method: string;
  path?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

abstract class ExtendedChannelAdapter implements IMAdapter {
  public abstract readonly platform: ExtendedPlatform;

  protected config?: IMAdapterConfig;
  protected handler?: (msg: UnifiedMessage) => void | Promise<void>;
  protected readonly fetchImpl: typeof fetch;
  protected readonly now: () => string;

  public constructor(options: ExtendedChannelAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public onMessage(handler: (msg: UnifiedMessage) => void | Promise<void>): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    this.validateConfig(config);
    this.config = config;
  }

  public async stop(): Promise<void> {
    return;
  }

  public async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    if (this.supportsEdit()) {
      await this.callJson(this.buildEditRequest(chatId, messageId, content));
      return;
    }
    await this.sendMessage(chatId, {
      type: "text",
      text: `[edit:${messageId}]\n${formatMessageContent(content)}`
    });
  }

  public async typingIndicator(chatId: string): Promise<void> {
    if (!this.supportsTyping()) {
      return;
    }
    await this.callJson(this.buildTypingRequest(chatId));
  }

  protected async emit(message: UnifiedMessage | null): Promise<boolean> {
    if (!message) {
      return false;
    }
    if (!this.isAllowedSender(message.sender_id)) {
      return false;
    }
    await this.handler?.(message);
    return true;
  }

  protected normalize(input: {
    message_id?: string;
    chat_id: string;
    sender_id: string;
    timestamp?: string;
    content: MessageContent | string;
    reply_to?: string;
    metadata?: Record<string, unknown>;
    attachments?: Array<Record<string, unknown>>;
    transport: string;
    thread_id?: string;
    display_name?: string;
    identity_metadata?: Record<string, unknown>;
    channel_metadata?: Record<string, unknown>;
  }): UnifiedMessage {
    return normalizePersonalIngressMessage({
      message_id: input.message_id ?? randomUUID(),
      platform: this.platform,
      chat_id: input.chat_id,
      sender_id: input.sender_id,
      timestamp: input.timestamp ?? this.now(),
      content: input.content,
      reply_to: input.reply_to,
      metadata: input.metadata ?? {},
      attachments: input.attachments,
      channel: {
        thread_id: input.thread_id,
        metadata: {
          transport: input.transport,
          ...(input.channel_metadata ?? {})
        }
      },
      identity: {
        display_name: input.display_name,
        trust_level: this.hasSenderAllowlist() ? "paired" : "unknown",
        metadata: input.identity_metadata ?? {}
      }
    });
  }

  protected async callJson<T = unknown>(request: HttpRequestSpec): Promise<T | undefined> {
    const response = await this.fetchImpl(request.url ?? `${this.baseUrl()}${request.path ?? ""}`, {
      method: request.method,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(request.headers ?? {})
      },
      body: request.body === undefined ? undefined : JSON.stringify(stripUndefined(request.body))
    });
    if (!response.ok) {
      throw new Error(`${this.platform} request failed with status ${response.status}.`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) as T : undefined;
  }

  protected baseUrl(): string {
    return this.config?.auth.api_base_url ?? this.defaultBaseUrl();
  }

  protected token(...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = this.config?.auth[key];
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  protected hasSenderAllowlist(): boolean {
    return Boolean(this.config?.allowed_senders && this.config.allowed_senders.length > 0);
  }

  protected isAllowedSender(senderId: string): boolean {
    if (!this.hasSenderAllowlist()) {
      return true;
    }
    return this.config?.allowed_senders?.includes(senderId) ?? false;
  }

  protected supportsEdit(): boolean {
    return false;
  }

  protected supportsTyping(): boolean {
    return false;
  }

  protected buildEditRequest(_chatId: string, _messageId: string, _content: MessageContent): HttpRequestSpec {
    throw new Error(`${this.platform} edit is not supported.`);
  }

  protected buildTypingRequest(_chatId: string): HttpRequestSpec {
    throw new Error(`${this.platform} typing is not supported.`);
  }

  protected abstract validateConfig(config: IMAdapterConfig): void;
  protected abstract defaultBaseUrl(): string;
  public abstract sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }>;
}

export class WhatsAppAdapter extends ExtendedChannelAdapter {
  public readonly platform = "whatsapp";

  public async receiveWebhookEvent(payload: Record<string, unknown>): Promise<boolean> {
    return this.emit(this.normalizePayload(payload));
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const result = await this.callJson<{ messages?: Array<{ id?: string }> }>(this.buildSendRequest(chatId, content));
    return { message_id: result?.messages?.[0]?.id ?? randomUUID() };
  }

  protected validateConfig(config: IMAdapterConfig): void {
    if (!config.auth.access_token) {
      throw new Error("WhatsApp adapter requires auth.access_token.");
    }
    if (!config.auth.phone_number_id) {
      throw new Error("WhatsApp adapter requires auth.phone_number_id.");
    }
  }

  protected defaultBaseUrl(): string {
    return "https://graph.facebook.com/v19.0";
  }

  private buildSendRequest(chatId: string, content: MessageContent): HttpRequestSpec {
    return {
      method: "POST",
      path: `/${encodeURIComponent(readAuth(this.config, "phone_number_id"))}/messages`,
      headers: {
        authorization: `Bearer ${readAuth(this.config, "access_token")}`
      },
      body: toWhatsAppBody(chatId, content)
    };
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    const change = firstRecord(firstRecordArray(payload.entry)?.[0]?.changes);
    const value = pickRecord(change, "value") ?? payload;
    const message = firstRecordArray(value.messages)?.[0] ?? payload;
    const senderId = asString(message.from) ?? asString(firstRecordArray(value.contacts)?.[0]?.wa_id);
    if (!senderId) {
      return null;
    }
    const contact = firstRecordArray(value.contacts)?.[0];
    const interactive = pickRecord(message, "interactive");
    const buttonReply = pickRecord(interactive, "button_reply");
    const image = pickRecord(message, "image");
    const document = pickRecord(message, "document");
    const audio = pickRecord(message, "audio");
    const voice = pickRecord(message, "voice");
    const content = buttonReply
      ? actionContent(asString(buttonReply.id) ?? asString(buttonReply.title) ?? "")
      : { type: "text" as const, text: asString(pickRecord(message, "text")?.body) ?? asString(message.text) ?? "" };
    const attachments = [
      image ? mediaInput("image", image, asString(pickRecord(message, "text")?.body)) : undefined,
      document ? mediaInput("file", document, asString(document.caption)) : undefined,
      audio ? mediaInput("audio", audio) : undefined,
      voice ? mediaInput("voice", voice) : undefined
    ].filter((item): item is Record<string, unknown> => Boolean(item));
    return this.normalize({
      message_id: asString(message.id),
      chat_id: senderId,
      sender_id: senderId,
      timestamp: formatSeconds(message.timestamp),
      content,
      metadata: payload,
      attachments,
      transport: "whatsapp_cloud_api",
      display_name: asString(pickRecord(contact, "profile")?.name),
      identity_metadata: {
        wa_id: senderId
      }
    });
  }
}

export class SignalAdapter extends ExtendedChannelAdapter {
  public readonly platform = "signal";

  public async receiveEnvelope(payload: Record<string, unknown>): Promise<boolean> {
    return this.emit(this.normalizePayload(payload));
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const result = await this.callJson<{ timestamp?: string | number; id?: string }>(this.buildSendRequest(chatId, content));
    return { message_id: result?.id ?? (result?.timestamp !== undefined ? String(result.timestamp) : randomUUID()) };
  }

  protected validateConfig(config: IMAdapterConfig): void {
    if (!config.auth.sender) {
      throw new Error("Signal adapter requires auth.sender.");
    }
  }

  protected defaultBaseUrl(): string {
    return "http://127.0.0.1:8080";
  }

  private buildSendRequest(chatId: string, content: MessageContent): HttpRequestSpec {
    const token = this.token("api_token", "access_token", "token");
    return {
      method: "POST",
      path: "/v2/send",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: {
        number: readAuth(this.config, "sender"),
        recipients: [chatId],
        message: formatMessageContent(content),
        attachments: mediaUrls(content)
      }
    };
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    const envelope = pickRecord(payload, "envelope") ?? payload;
    const dataMessage = pickRecord(envelope, "dataMessage") ?? payload;
    const senderId = asString(envelope.source) ?? asString(envelope.sourceNumber) ?? asString(payload.source);
    if (!senderId) {
      return null;
    }
    const text = asString(dataMessage.message) ?? asString(payload.message) ?? "";
    const attachments = arrayRecords(dataMessage.attachments ?? payload.attachments).map((item) =>
      mediaInput(inferMediaKind(asString(item.contentType), asString(item.filename)), {
        ...item,
        url: asString(item.url) ?? asString(item.pointer)
      }, asString(item.caption))
    );
    return this.normalize({
      message_id: String(dataMessage.timestamp ?? envelope.timestamp ?? payload.timestamp ?? randomUUID()),
      chat_id: asString(envelope.groupId) ?? senderId,
      sender_id: senderId,
      timestamp: formatMillis(dataMessage.timestamp ?? envelope.timestamp ?? payload.timestamp),
      content: actionOrText(text),
      reply_to: asString(pickRecord(dataMessage, "quote")?.id),
      metadata: payload,
      attachments,
      transport: "signal_cli_rest"
    });
  }
}

export class WeChatAdapter extends ExtendedChannelAdapter {
  public readonly platform = "wechat";

  public async receiveMessage(payload: Record<string, unknown>): Promise<boolean> {
    return this.emit(this.normalizePayload(payload));
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const result = await this.callJson<{ msgid?: string | number; errcode?: number; errmsg?: string }>(this.buildSendRequest(chatId, content));
    if (result?.errcode && result.errcode !== 0) {
      throw new Error(`WeChat send failed: ${result.errmsg ?? result.errcode}`);
    }
    return { message_id: result?.msgid !== undefined ? String(result.msgid) : randomUUID() };
  }

  protected validateConfig(config: IMAdapterConfig): void {
    if (!config.auth.access_token) {
      throw new Error("WeChat adapter requires auth.access_token.");
    }
  }

  protected defaultBaseUrl(): string {
    return "https://api.weixin.qq.com";
  }

  private buildSendRequest(chatId: string, content: MessageContent): HttpRequestSpec {
    return {
      method: "POST",
      path: `/cgi-bin/message/custom/send?access_token=${encodeURIComponent(readAuth(this.config, "access_token"))}`,
      body: {
        touser: chatId,
        msgtype: "text",
        text: {
          content: formatMessageContent(content)
        }
      }
    };
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    const senderId = asString(payload.FromUserName) ?? asString(payload.from_user_name) ?? asString(payload.sender_id);
    if (!senderId) {
      return null;
    }
    const msgType = asString(payload.MsgType) ?? asString(payload.msg_type);
    const contentText = asString(payload.Content) ?? asString(payload.content) ?? asString(payload.EventKey) ?? "";
    const mediaUrl = asString(payload.PicUrl) ?? asString(payload.MediaUrl) ?? asString(payload.media_url);
    const attachments = mediaUrl
      ? [mediaInput(msgType === "image" ? "image" : msgType === "voice" ? "voice" : "file", { url: mediaUrl, filename: asString(payload.MediaId) }, contentText)]
      : [];
    return this.normalize({
      message_id: asString(payload.MsgId) ?? asString(payload.msg_id),
      chat_id: senderId,
      sender_id: senderId,
      timestamp: formatSeconds(payload.CreateTime),
      content: actionOrText(contentText),
      metadata: payload,
      attachments,
      transport: "wechat_official_account",
      channel_metadata: {
        msg_type: msgType
      }
    });
  }
}

export class MatrixAdapter extends ExtendedChannelAdapter {
  public readonly platform = "matrix";

  public async receiveEvent(payload: Record<string, unknown>): Promise<boolean> {
    return this.emit(this.normalizePayload(payload));
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const result = await this.callJson<{ event_id?: string }>(this.buildSendRequest(chatId, content));
    return { message_id: result?.event_id ?? randomUUID() };
  }

  protected validateConfig(config: IMAdapterConfig): void {
    if (!config.auth.access_token) {
      throw new Error("Matrix adapter requires auth.access_token.");
    }
  }

  protected defaultBaseUrl(): string {
    return "https://matrix-client.matrix.org";
  }

  protected supportsEdit(): boolean {
    return true;
  }

  protected supportsTyping(): boolean {
    return Boolean(this.config?.auth.user_id);
  }

  protected buildEditRequest(chatId: string, messageId: string, content: MessageContent): HttpRequestSpec {
    const txnId = randomUUID();
    const body = formatMessageContent(content);
    return this.authedRequest("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(chatId)}/send/m.room.message/${txnId}`, {
      msgtype: "m.text",
      body,
      "m.relates_to": {
        rel_type: "m.replace",
        event_id: messageId
      },
      "m.new_content": {
        msgtype: "m.text",
        body
      }
    });
  }

  protected buildTypingRequest(chatId: string): HttpRequestSpec {
    return this.authedRequest("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(chatId)}/typing/${encodeURIComponent(readAuth(this.config, "user_id"))}`, {
      typing: true,
      timeout: 3000
    });
  }

  private buildSendRequest(chatId: string, content: MessageContent): HttpRequestSpec {
    const txnId = randomUUID();
    return this.authedRequest("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(chatId)}/send/m.room.message/${txnId}`, toMatrixContent(content));
  }

  private authedRequest(method: string, path: string, body: Record<string, unknown>): HttpRequestSpec {
    return {
      method,
      path,
      headers: {
        authorization: `Bearer ${readAuth(this.config, "access_token")}`
      },
      body
    };
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    if (asString(payload.type) && asString(payload.type) !== "m.room.message") {
      return null;
    }
    const content = pickRecord(payload, "content") ?? {};
    const senderId = asString(payload.sender);
    const roomId = asString(payload.room_id);
    if (!senderId || !roomId) {
      return null;
    }
    return this.normalize({
      message_id: asString(payload.event_id),
      chat_id: roomId,
      sender_id: senderId,
      timestamp: formatMillis(payload.origin_server_ts),
      content: actionOrText(asString(content.body) ?? ""),
      reply_to: asString(pickRecord(content, "m.relates_to")?.event_id),
      metadata: payload,
      transport: "matrix_client_server",
      thread_id: asString(pickRecord(content, "m.relates_to")?.event_id),
      display_name: asString(payload.sender_display_name)
    });
  }
}

export class TeamsAdapter extends ExtendedChannelAdapter {
  public readonly platform = "teams";

  public async receiveActivity(payload: Record<string, unknown>): Promise<boolean> {
    return this.emit(this.normalizePayload(payload));
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const result = await this.callJson<{ id?: string }>(this.buildSendRequest(chatId, content));
    return { message_id: result?.id ?? randomUUID() };
  }

  protected validateConfig(config: IMAdapterConfig): void {
    if (!config.auth.bot_token) {
      throw new Error("Teams adapter requires auth.bot_token.");
    }
  }

  protected defaultBaseUrl(): string {
    return this.config?.auth.service_url ?? "https://smba.trafficmanager.net/amer";
  }

  protected supportsTyping(): boolean {
    return true;
  }

  protected buildTypingRequest(chatId: string): HttpRequestSpec {
    return this.authedRequest("POST", `/v3/conversations/${encodeURIComponent(chatId)}/activities`, {
      type: "typing"
    });
  }

  private buildSendRequest(chatId: string, content: MessageContent): HttpRequestSpec {
    return this.authedRequest("POST", `/v3/conversations/${encodeURIComponent(chatId)}/activities`, toTeamsActivity(content));
  }

  private authedRequest(method: string, path: string, body: Record<string, unknown>): HttpRequestSpec {
    return {
      method,
      path,
      headers: {
        authorization: `Bearer ${readAuth(this.config, "bot_token")}`
      },
      body
    };
  }

  private normalizePayload(payload: Record<string, unknown>): UnifiedMessage | null {
    const type = asString(payload.type);
    const conversation = pickRecord(payload, "conversation");
    const from = pickRecord(payload, "from");
    const senderId = asString(from?.id);
    const chatId = asString(conversation?.id);
    if (!senderId || !chatId) {
      return null;
    }
    const value = pickRecord(payload, "value");
    const action = asString(value?.action) ?? asString(value?.verb) ?? asString(value?.decision);
    return this.normalize({
      message_id: asString(payload.id),
      chat_id: chatId,
      sender_id: senderId,
      timestamp: asString(payload.timestamp),
      content: type === "invoke" && action ? actionContent(action, asString(value?.approval_id)) : actionOrText(asString(payload.text) ?? ""),
      reply_to: asString(payload.replyToId),
      metadata: payload,
      transport: "teams_bot_framework",
      thread_id: asString(conversation?.conversationType),
      display_name: asString(from?.name),
      channel_metadata: {
        service_url: asString(payload.serviceUrl),
        activity_type: type
      }
    });
  }
}

function toWhatsAppBody(chatId: string, content: MessageContent): Record<string, unknown> {
  if (content.type === "approval_request") {
    return {
      messaging_product: "whatsapp",
      to: chatId,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: content.text },
        action: {
          buttons: [
            { type: "reply", reply: { id: `approve:${content.approval_id}`, title: content.approve_label ?? "Approve" } },
            { type: "reply", reply: { id: `reject:${content.approval_id}`, title: content.reject_label ?? "Reject" } }
          ]
        }
      }
    };
  }
  if (content.type === "image") {
    return { messaging_product: "whatsapp", to: chatId, type: "image", image: { link: content.url, caption: content.caption } };
  }
  if (content.type === "file") {
    return { messaging_product: "whatsapp", to: chatId, type: "document", document: { link: content.url, filename: content.filename, caption: content.text_excerpt } };
  }
  if (content.type === "audio" || content.type === "voice") {
    return { messaging_product: "whatsapp", to: chatId, type: "audio", audio: { link: content.url } };
  }
  return {
    messaging_product: "whatsapp",
    to: chatId,
    type: "text",
    text: {
      body: formatMessageContent(content)
    }
  };
}

function toMatrixContent(content: MessageContent): Record<string, unknown> {
  if (content.type === "markdown") {
    return {
      msgtype: "m.text",
      body: content.text,
      format: "org.matrix.custom.html",
      formatted_body: content.text
    };
  }
  return {
    msgtype: "m.text",
    body: formatMessageContent(content)
  };
}

function toTeamsActivity(content: MessageContent): Record<string, unknown> {
  if (content.type === "approval_request") {
    return {
      type: "message",
      text: content.text,
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", text: content.text, wrap: true }],
          actions: [
            { type: "Action.Submit", title: content.approve_label ?? "Approve", data: { action: "approve", approval_id: content.approval_id } },
            { type: "Action.Submit", title: content.reject_label ?? "Reject", data: { action: "reject", approval_id: content.approval_id } }
          ]
        }
      }]
    };
  }
  return {
    type: "message",
    text: formatMessageContent(content)
  };
}

function formatMessageContent(content: MessageContent): string {
  switch (content.type) {
    case "text":
    case "markdown":
      return content.text;
    case "status":
      return [formatStatusLabel(content.phase, content.state), content.text, content.detail, formatData(content.data)].filter(Boolean).join("\n");
    case "approval_request":
      return [
        content.text,
        `${content.approve_label ?? "Approve"}: approve:${content.approval_id}`,
        `${content.reject_label ?? "Reject"}: reject:${content.approval_id}`
      ].join("\n");
    case "image":
    case "file":
    case "audio":
    case "voice":
      return formatMediaDeliveryText(content);
    case "action":
      return content.action;
  }
}

function formatStatusLabel(phase: string, state: string): string {
  return `${phase} · ${state.replaceAll("_", " ")}`;
}

function formatData(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) {
    return undefined;
  }
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

function actionOrText(text: string): MessageContent {
  const match = /^(approve|approved|reject|rejected):(.+)$/i.exec(text.trim());
  if (match) {
    return actionContent(match[1], match[2]);
  }
  return { type: "text", text };
}

function actionContent(action: string, approvalId?: string): MessageContent {
  const match = /^(approve|approved|reject|rejected):(.+)$/i.exec(action);
  const rawAction = match?.[1] ?? action;
  const normalized = rawAction === "approved" ? "approve" : rawAction === "rejected" ? "reject" : rawAction;
  return {
    type: "action",
    action: normalized,
    params: approvalId || match?.[2] ? { approval_id: approvalId ?? match?.[2] } : undefined
  };
}

function mediaUrls(content: MessageContent): string[] | undefined {
  if (content.type === "image" || content.type === "file" || content.type === "audio" || content.type === "voice") {
    return content.url ? [content.url] : undefined;
  }
  return undefined;
}

function mediaInput(kind: string, source: Record<string, unknown>, caption?: string): Record<string, unknown> {
  return {
    kind,
    url: asString(source.url) ?? asString(source.link),
    filename: asString(source.filename),
    mime_type: asString(source.mime_type) ?? asString(source.mimeType) ?? asString(source.contentType),
    caption,
    transcript: asString(source.transcript),
    size_bytes: typeof source.size === "number" ? source.size : undefined,
    duration_ms: typeof source.duration_ms === "number" ? source.duration_ms : undefined,
    metadata: source
  };
}

function inferMediaKind(contentType: string | undefined, filename: string | undefined): string {
  const source = `${contentType ?? ""} ${filename ?? ""}`.toLowerCase();
  if (source.includes("image")) return "image";
  if (source.includes("audio")) return "audio";
  return "file";
}

function readAuth(config: IMAdapterConfig | undefined, key: string): string {
  const value = config?.auth[key];
  if (!value) {
    throw new Error(`Missing ${key}.`);
  }
  return value;
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

function firstRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? value.find(isRecord) : undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function formatSeconds(value: unknown): string | undefined {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : undefined;
  return numeric && Number.isFinite(numeric) ? new Date(numeric * 1000).toISOString() : undefined;
}

function formatMillis(value: unknown): string | undefined {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : undefined;
  return numeric && Number.isFinite(numeric) ? new Date(numeric).toISOString() : undefined;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
