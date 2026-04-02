import type { ScheduleEntry } from "../types.js";

export interface CronSchedulerOptions {
  tickIntervalMs?: number;
  onTriggered: (entry: ScheduleEntry) => Promise<void>;
}

export class CronScheduler {
  private readonly entries = new Map<string, ScheduleEntry>();
  private readonly lastTriggeredMinute = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;

  public constructor(private readonly options: CronSchedulerOptions) {}

  public register(entry: ScheduleEntry): void {
    this.entries.set(entry.id, entry);
  }

  public unregister(entryId: string): void {
    this.entries.delete(entryId);
    this.lastTriggeredMinute.delete(entryId);
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.tickIntervalMs ?? 30_000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async tick(now = new Date()): Promise<void> {
    const currentMinute = now.toISOString().slice(0, 16);
    for (const entry of this.entries.values()) {
      if (!entry.enabled) {
        continue;
      }
      if (!matchesCron(entry.cron, now)) {
        continue;
      }
      if (this.lastTriggeredMinute.get(entry.id) === currentMinute) {
        continue;
      }

      this.lastTriggeredMinute.set(entry.id, currentMinute);
      await this.options.onTriggered(entry);
    }
  }
}

function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay()
  ];

  return parts.every((part, index) => matchesField(part, values[index]));
}

function matchesField(field: string, value: number): boolean {
  if (field === "*") {
    return true;
  }
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return Number.isFinite(step) && step > 0 ? value % step === 0 : false;
  }
  if (field.includes(",")) {
    return field.split(",").some((entry) => matchesField(entry, value));
  }
  const parsed = parseInt(field, 10);
  return Number.isFinite(parsed) && parsed === value;
}
