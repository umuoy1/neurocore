export interface HeartbeatEntry {
  interval_ms: number;
  last_seen: number;
  miss_count: number;
}

export class HeartbeatMonitor {
  private readonly tracked = new Map<string, HeartbeatEntry>();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  public onMiss: ((instanceId: string, missCount: number) => void) | null = null;
  public onTimeout: ((instanceId: string) => void) | null = null;
  public onRecovery: ((instanceId: string) => void) | null = null;

  track(instanceId: string, intervalMs: number): void {
    this.tracked.set(instanceId, {
      interval_ms: intervalMs,
      last_seen: Date.now(),
      miss_count: 0
    });
  }

  untrack(instanceId: string): void {
    this.tracked.delete(instanceId);
  }

  touch(instanceId: string): void {
    const entry = this.tracked.get(instanceId);
    if (!entry) return;
    const wasUnreachable = entry.miss_count >= 1;
    entry.last_seen = Date.now();
    entry.miss_count = 0;
    if (wasUnreachable && this.onRecovery) {
      this.onRecovery(instanceId);
    }
  }

  start(checkFrequencyMs = 5000): void {
    this.stop();
    this.checkTimer = setInterval(() => this.check(), checkFrequencyMs);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  check(): void {
    const now = Date.now();
    for (const [instanceId, entry] of this.tracked) {
      const elapsed = now - entry.last_seen;
      if (elapsed > entry.interval_ms) {
        entry.miss_count++;
        if (entry.miss_count === 1 && this.onMiss) {
          this.onMiss(instanceId, entry.miss_count);
        }
        if (entry.miss_count >= 3 && this.onTimeout) {
          this.onTimeout(instanceId);
        }
      }
    }
  }

  getEntry(instanceId: string): HeartbeatEntry | undefined {
    return this.tracked.get(instanceId);
  }
}
