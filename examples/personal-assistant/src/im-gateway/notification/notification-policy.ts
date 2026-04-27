import type { IMPlatform, NotificationPriority, PushNotificationOptions } from "../types.js";

export interface NotificationQuietHours {
  start: string;
  end: string;
  suppress_priorities?: NotificationPriority[];
}

export interface NotificationRoute {
  platform: IMPlatform;
  chat_id: string;
}

export interface NotificationPolicy {
  quiet_hours?: NotificationQuietHours;
  fallback_channels?: NotificationRoute[];
  dedupe_window_ms?: number;
}

export interface NotificationPolicyStore {
  getPolicy(userId: string): NotificationPolicy | undefined;
  setPolicy(userId: string, policy: NotificationPolicy): void;
}

export type NotificationDeliveryDecision = "deliver" | "suppress" | "dedupe";

export interface NotificationDeliveryPlan {
  decision: NotificationDeliveryDecision;
  reason?: string;
  routes: NotificationRoute[];
  dedupe_key?: string;
  priority: NotificationPriority;
}

export interface NotificationDeliveryPlannerOptions {
  store?: NotificationPolicyStore;
  now?: () => Date;
}

export class InMemoryNotificationPolicyStore implements NotificationPolicyStore {
  private readonly policies = new Map<string, NotificationPolicy>();

  public getPolicy(userId: string): NotificationPolicy | undefined {
    const policy = this.policies.get(userId) ?? this.policies.get("default");
    return policy ? structuredClone(policy) : undefined;
  }

  public setPolicy(userId: string, policy: NotificationPolicy): void {
    this.policies.set(userId, structuredClone(policy));
  }
}

export class NotificationDeliveryPlanner {
  private readonly deliveredAtByDedupeKey = new Map<string, number>();
  private readonly now: () => Date;

  public constructor(private readonly options: NotificationDeliveryPlannerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  public plan(input: {
    user_id: string;
    selected_route: NotificationRoute;
    options?: PushNotificationOptions;
  }): NotificationDeliveryPlan {
    const priority = input.options?.priority ?? "normal";
    const policy = this.options.store?.getPolicy(input.user_id);
    const dedupeKey = input.options?.dedupe_key;
    if (dedupeKey && isDuplicate(this.deliveredAtByDedupeKey.get(dedupeKey), policy?.dedupe_window_ms, this.now())) {
      return {
        decision: "dedupe",
        reason: "duplicate_notification",
        routes: [input.selected_route],
        dedupe_key: dedupeKey,
        priority
      };
    }
    if (!input.options?.quiet_hours_bypass && shouldSuppressForQuietHours(policy?.quiet_hours, priority, this.now())) {
      return {
        decision: "suppress",
        reason: "quiet_hours",
        routes: [input.selected_route],
        dedupe_key: dedupeKey,
        priority
      };
    }
    return {
      decision: "deliver",
      routes: dedupeRoutes([
        input.selected_route,
        ...(input.options?.fallback_routes ?? policy?.fallback_channels ?? [])
      ]),
      dedupe_key: dedupeKey,
      priority
    };
  }

  public recordDelivery(plan: NotificationDeliveryPlan): void {
    if (plan.dedupe_key) {
      this.deliveredAtByDedupeKey.set(plan.dedupe_key, this.now().getTime());
    }
  }
}

function shouldSuppressForQuietHours(
  quietHours: NotificationQuietHours | undefined,
  priority: NotificationPriority,
  now: Date
): boolean {
  if (!quietHours) {
    return false;
  }
  const suppressed = quietHours.suppress_priorities ?? ["silent", "normal"];
  if (!suppressed.includes(priority)) {
    return false;
  }
  const current = minutesOfDay(now);
  const start = parseTime(quietHours.start);
  const end = parseTime(quietHours.end);
  if (start === end) {
    return true;
  }
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function isDuplicate(previousAt: number | undefined, windowMs: number | undefined, now: Date): boolean {
  if (!previousAt || !windowMs || windowMs <= 0) {
    return false;
  }
  return now.getTime() - previousAt < windowMs;
}

function parseTime(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return 0;
  }
  const hours = Math.min(23, Math.max(0, Number.parseInt(match[1], 10)));
  const minutes = Math.min(59, Math.max(0, Number.parseInt(match[2], 10)));
  return hours * 60 + minutes;
}

function minutesOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

function dedupeRoutes(routes: NotificationRoute[]): NotificationRoute[] {
  const seen = new Set<string>();
  const output: NotificationRoute[] = [];
  for (const route of routes) {
    const key = `${route.platform}:${route.chat_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(route);
    }
  }
  return output;
}
