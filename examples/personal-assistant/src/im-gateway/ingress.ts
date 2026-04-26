import { randomUUID } from "node:crypto";
import type {
  ChannelCapabilities,
  IMPlatform,
  MessageContent,
  PersonalChannelContext,
  PersonalIdentityContext,
  UnifiedMessage
} from "./types.js";
import { getChannelKind, getDefaultChannelCapabilities } from "./types.js";

export interface PersonalIngressMessageInput {
  message_id?: string;
  platform: IMPlatform;
  chat_id?: string;
  sender_id?: string;
  timestamp?: string;
  content: MessageContent | string;
  reply_to?: string;
  metadata?: Record<string, unknown>;
  channel?: Partial<PersonalChannelContext>;
  identity?: Partial<PersonalIdentityContext>;
}

export function normalizePersonalIngressMessage(input: PersonalIngressMessageInput | UnifiedMessage): UnifiedMessage {
  const platform = input.platform;
  const chatId = input.chat_id ?? defaultChatId(platform, input.sender_id);
  const senderId = input.sender_id ?? defaultSenderId(platform, chatId);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const capabilities = normalizeCapabilities(platform, input.channel?.capabilities);
  const channel: PersonalChannelContext = {
    platform,
    kind: input.channel?.kind ?? getChannelKind(platform),
    chat_id: chatId,
    route_key: input.channel?.route_key ?? `${platform}:${chatId}`,
    thread_id: input.channel?.thread_id,
    capabilities,
    metadata: isRecord(input.channel?.metadata) ? input.channel.metadata : {}
  };
  const identity: PersonalIdentityContext = {
    sender_id: senderId,
    canonical_user_id: input.identity?.canonical_user_id,
    display_name: input.identity?.display_name,
    trust_level: input.identity?.trust_level ?? "unknown",
    metadata: isRecord(input.identity?.metadata) ? input.identity.metadata : {}
  };

  return {
    message_id: input.message_id ?? randomUUID(),
    platform,
    chat_id: chatId,
    sender_id: senderId,
    timestamp,
    content: normalizeContent(input.content),
    reply_to: input.reply_to,
    channel,
    identity,
    metadata
  };
}

function normalizeContent(content: MessageContent | string): MessageContent {
  if (typeof content === "string") {
    return { type: "text", text: content };
  }
  return content;
}

function normalizeCapabilities(
  platform: IMPlatform,
  overrides: Partial<ChannelCapabilities> | undefined
): ChannelCapabilities {
  return {
    ...getDefaultChannelCapabilities(platform),
    ...(overrides ?? {})
  };
}

function defaultChatId(platform: IMPlatform, senderId: string | undefined): string {
  if (platform === "cli") {
    return senderId ? `cli:${senderId}` : "cli:local";
  }
  return senderId ?? `${platform}:unknown-chat`;
}

function defaultSenderId(platform: IMPlatform, chatId: string): string {
  if (platform === "cli") {
    return chatId.replace(/^cli:/, "") || "local";
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
