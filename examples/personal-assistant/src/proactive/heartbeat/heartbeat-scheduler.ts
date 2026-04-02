import type { CheckResult, HeartbeatCheck } from "../types.js";

export interface HeartbeatSchedulerOptions {
  checks: HeartbeatCheck[];
  intervalMs: number;
  onTriggered: (results: CheckResult[]) => Promise<void>;
}

export class HeartbeatScheduler {
  private timer?: ReturnType<typeof setInterval>;

  public constructor(private readonly options: HeartbeatSchedulerOptions) {}

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runChecks();
    }, this.options.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async runChecks(): Promise<CheckResult[]> {
    const settled = await Promise.allSettled(
      this.options.checks.map((check) => check.execute())
    );

    const results = settled.flatMap((entry) => {
      if (entry.status !== "fulfilled") {
        return [];
      }
      return Array.isArray(entry.value) ? entry.value : [entry.value];
    }).filter((entry) => entry.triggered);

    if (results.length > 0) {
      await this.options.onTriggered(results);
    }

    return results;
  }
}
