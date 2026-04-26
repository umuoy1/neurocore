import type { IMPlatform, NotificationPriority } from "../im-gateway/types.js";

export interface CheckResult {
  triggered: boolean;
  summary: string;
  priority: NotificationPriority;
  target_user: string;
  target_platform?: IMPlatform;
  payload?: Record<string, unknown>;
}

export interface HeartbeatCheck {
  name: string;
  description: string;
  execute(): Promise<CheckResult | CheckResult[]>;
}

export type StandingOrderStatus = "active" | "paused" | "expired";

export interface StandingOrderScope {
  type: "global" | "user" | "channel";
  user_id?: string;
  platform?: IMPlatform;
  chat_id?: string;
}

export interface StandingOrderPermission {
  tools?: string[];
  channels?: IMPlatform[];
  requires_approval?: boolean;
}

export interface StandingOrderRecord {
  order_id: string;
  owner_user_id: string;
  instruction: string;
  scope: StandingOrderScope;
  status: StandingOrderStatus;
  permission: StandingOrderPermission;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  last_applied_at?: string;
  metadata: Record<string, unknown>;
}

export interface CreateStandingOrderInput {
  owner_user_id: string;
  instruction: string;
  scope: StandingOrderScope;
  permission?: StandingOrderPermission;
  expires_at?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface StandingOrderQuery {
  owner_user_id?: string;
  user_id?: string;
  platform?: IMPlatform;
  chat_id?: string;
  now?: string;
  include_paused?: boolean;
}

export interface ScheduleEntry {
  id: string;
  cron: string;
  task_description: string;
  target_user: string;
  target_platform?: IMPlatform;
  enabled: boolean;
  mode?: "recurring" | "one_shot";
  run_at?: string;
}

export interface ProactiveAction {
  type: "notify" | "run_task";
  content: string;
  priority: NotificationPriority;
  target_user: string;
  target_platform?: IMPlatform;
  source: "heartbeat" | "schedule" | "event";
}

export interface EventSource {
  name: string;
  subscribe(handler: (payload: Record<string, unknown>) => void): () => void;
}

export type BackgroundTaskStatus = "created" | "running" | "succeeded" | "failed" | "cancelled";

export interface BackgroundTaskEntry {
  task_id: string;
  source: "heartbeat" | "schedule" | "manual" | "webhook";
  status: BackgroundTaskStatus;
  description: string;
  target_user: string;
  target_platform?: IMPlatform;
  priority?: NotificationPriority;
  session_id?: string;
  approval_id?: string;
  result_text?: string;
  error_message?: string;
  delivery_target?: {
    platform?: IMPlatform;
    priority?: NotificationPriority;
  };
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  delivered_at?: string;
  metadata: Record<string, unknown>;
}
