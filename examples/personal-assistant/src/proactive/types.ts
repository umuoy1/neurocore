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
