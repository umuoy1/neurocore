export type IMPlatform = "feishu" | "web";

export type NotificationPriority = "silent" | "normal" | "urgent";

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
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
