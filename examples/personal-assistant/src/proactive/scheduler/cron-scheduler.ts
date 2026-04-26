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
    this.entries.set(entry.id, {
      ...entry,
      mode: entry.mode ?? (entry.run_at ? "one_shot" : "recurring")
    });
  }

  public unregister(entryId: string): void {
    this.entries.delete(entryId);
    this.lastTriggeredMinute.delete(entryId);
  }

  public list(): ScheduleEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  public get(entryId: string): ScheduleEntry | undefined {
    const entry = this.entries.get(entryId);
    return entry ? { ...entry } : undefined;
  }

  public pause(entryId: string): ScheduleEntry | undefined {
    return this.setEnabled(entryId, false);
  }

  public resume(entryId: string): ScheduleEntry | undefined {
    return this.setEnabled(entryId, true);
  }

  public remove(entryId: string): boolean {
    const exists = this.entries.has(entryId);
    this.unregister(entryId);
    return exists;
  }

  public async runNow(entryId: string): Promise<boolean> {
    const entry = this.entries.get(entryId);
    if (!entry) {
      return false;
    }
    await this.trigger(entry, new Date());
    return true;
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
      if (!matchesSchedule(entry, now)) {
        continue;
      }
      if (this.lastTriggeredMinute.get(entry.id) === currentMinute) {
        continue;
      }

      await this.trigger(entry, now);
    }
  }

  private setEnabled(entryId: string, enabled: boolean): ScheduleEntry | undefined {
    const entry = this.entries.get(entryId);
    if (!entry) {
      return undefined;
    }
    const next = { ...entry, enabled };
    this.entries.set(entryId, next);
    return { ...next };
  }

  private async trigger(entry: ScheduleEntry, now: Date): Promise<void> {
    this.lastTriggeredMinute.set(entry.id, now.toISOString().slice(0, 16));
    await this.options.onTriggered({ ...entry });
    if (entry.mode === "one_shot" || entry.run_at) {
      this.setEnabled(entry.id, false);
    }
  }
}

function matchesSchedule(entry: ScheduleEntry, date: Date): boolean {
  if (entry.mode === "one_shot" || entry.run_at) {
    if (!entry.run_at) {
      return matchesCron(entry.cron, date);
    }
    return Date.parse(entry.run_at) <= date.getTime();
  }
  return matchesCron(entry.cron, date);
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
