export type IMPlatform = "cli" | "feishu" | "web";

export type PersonalChannelKind = "cli" | "im" | "web";

export type PersonalIdentityTrustLevel = "unknown" | "paired" | "trusted";

export interface ChannelCapabilities {
  text: boolean;
  markdown: boolean;
  status: boolean;
  images: boolean;
  files: boolean;
  actions: boolean;
  approval_requests: boolean;
  typing: boolean;
  streaming: boolean;
  edits: boolean;
  threads: boolean;
  reactions: boolean;
  voice: boolean;
}

export interface PersonalChannelContext {
  platform: IMPlatform;
  kind: PersonalChannelKind;
  chat_id: string;
  route_key: string;
  capabilities: ChannelCapabilities;
  thread_id?: string;
  metadata: Record<string, unknown>;
}

export interface PersonalIdentityContext {
  sender_id: string;
  canonical_user_id?: string;
  display_name?: string;
  trust_level: PersonalIdentityTrustLevel;
  metadata: Record<string, unknown>;
}

export type NotificationPriority = "silent" | "normal" | "urgent";

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
  | {
      type: "status";
      text: string;
      phase: string;
      state: "started" | "in_progress" | "completed" | "failed";
      detail?: string;
      session_id?: string;
      cycle_id?: string;
      data?: Record<string, unknown>;
    }
  | { type: "image"; url: string; caption?: string }
  | { type: "file"; url: string; filename: string }
  | { type: "action"; action: string; params?: Record<string, unknown> }
  | {
      type: "approval_request";
      text: string;
      approval_id: string;
      approve_label?: string;
      reject_label?: string;
    };

export interface UnifiedMessage {
  message_id: string;
  platform: IMPlatform;
  chat_id: string;
  sender_id: string;
  timestamp: string;
  content: MessageContent;
  reply_to?: string;
  channel?: PersonalChannelContext;
  identity?: PersonalIdentityContext;
  metadata: Record<string, unknown>;
}

export interface IMAdapterConfig {
  auth: Record<string, string>;
  webhook_url?: string;
  allowed_senders?: string[];
  rate_limit?: { messages_per_minute: number };
  metadata?: Record<string, unknown>;
}

export interface SessionRoute {
  platform: IMPlatform;
  chat_id: string;
  session_id: string;
  sender_id?: string;
  canonical_user_id?: string;
  created_at: string;
  updated_at: string;
  last_active_at: string;
}

export interface ConversationHandoffMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  cycle_id?: string;
  source_id?: string;
}

export interface ConversationHandoff {
  previous_session_id: string;
  reason: "terminal" | "idle";
  summary: string;
  recent_messages: ConversationHandoffMessage[];
  created_at: string;
}

export interface PlatformUserLink {
  platform: IMPlatform;
  sender_id: string;
  canonical_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovalBinding {
  platform: IMPlatform;
  platform_message_id: string;
  session_id: string;
  approval_id: string;
  chat_id: string;
  created_at: string;
  updated_at: string;
}

export interface PushNotificationOptions {
  priority?: NotificationPriority;
  platform?: IMPlatform;
  chat_id?: string;
}

export const IM_PLATFORMS = ["cli", "feishu", "web"] as const;

export function isIMPlatform(value: unknown): value is IMPlatform {
  return value === "cli" || value === "feishu" || value === "web";
}

export function getChannelKind(platform: IMPlatform): PersonalChannelKind {
  if (platform === "cli") {
    return "cli";
  }
  if (platform === "web") {
    return "web";
  }
  return "im";
}

export function getDefaultChannelCapabilities(platform: IMPlatform): ChannelCapabilities {
  switch (platform) {
    case "cli":
      return {
        text: true,
        markdown: true,
        status: true,
        images: false,
        files: false,
        actions: true,
        approval_requests: true,
        typing: false,
        streaming: false,
        edits: false,
        threads: false,
        reactions: false,
        voice: false
      };
    case "web":
      return {
        text: true,
        markdown: true,
        status: true,
        images: true,
        files: true,
        actions: true,
        approval_requests: true,
        typing: true,
        streaming: true,
        edits: true,
        threads: false,
        reactions: false,
        voice: false
      };
    case "feishu":
      return {
        text: true,
        markdown: true,
        status: true,
        images: true,
        files: true,
        actions: true,
        approval_requests: true,
        typing: true,
        streaming: true,
        edits: true,
        threads: true,
        reactions: false,
        voice: false
      };
  }
}
