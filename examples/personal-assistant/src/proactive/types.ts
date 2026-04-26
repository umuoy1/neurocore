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

export interface ScheduleEntry {
  id: string;
  cron: string;
  task_description: string;
  target_user: string;
  target_platform?: IMPlatform;
  enabled: boolean;
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
