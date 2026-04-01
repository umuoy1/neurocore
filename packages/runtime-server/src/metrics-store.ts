export interface MetricsSnapshot {
  total_sessions_created: number;
  total_cycles_executed: number;
  active_sessions: number;
  total_eval_runs: number;
  error_count: number;
  average_latency_ms: number;
  eval_pass_rate: number;
  uptime_seconds: number;
  version: string;
  active_sse_connections?: number;
}

export interface TimeseriesPoint {
  timestamp: string;
  value: number;
}

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  by_agent: Record<string, { p50: number; p95: number; p99: number }>;
}

export interface MetricsStore {
  recordCounter(metric: string, delta?: number): void;
  recordHistogram(metric: string, value: number, labels?: Record<string, string>): void;
  recordGauge(metric: string, value: number): void;
  queryTimeseries(metric: string, windowMs: number, intervalMs: number): TimeseriesPoint[];
  getLatencyPercentiles(windowMs: number): LatencyPercentiles;
  getSnapshot(activeSessions: number, uptimeSeconds: number, version: string, sseConnections?: number): MetricsSnapshot;
}

interface HistogramBucket {
  timestamp: number;
  values: number[];
  labels: Record<string, string>;
}

interface CounterBucket {
  timestamp: number;
  value: number;
}

export class InMemoryMetricsStore implements MetricsStore {
  private readonly counters = new Map<string, CounterBucket[]>();
  private readonly histograms = new Map<string, HistogramBucket[]>();
  private readonly gauges = new Map<string, number>();
  private readonly retentionMs: number;
  private readonly intervalMs: number;
  private startedAt: number;

  public constructor(options?: { retentionMs?: number; intervalMs?: number }) {
    this.retentionMs = options?.retentionMs ?? 24 * 60 * 60 * 1000;
    this.intervalMs = options?.intervalMs ?? 60_000;
    this.startedAt = Date.now();
  }

  public recordCounter(metric: string, delta = 1): void {
    const buckets = this.getOrCreateCounterBuckets(metric);
    const bucketTs = this.bucketTs(Date.now());
    const existing = buckets.find((b) => b.timestamp === bucketTs);
    if (existing) {
      existing.value += delta;
    } else {
      buckets.push({ timestamp: bucketTs, value: delta });
    }
    this.pruneOld(buckets);
  }

  public recordHistogram(metric: string, value: number, labels: Record<string, string> = {}): void {
    const buckets = this.getOrCreateHistogramBuckets(metric);
    const bucketTs = this.bucketTs(Date.now());
    const existing = buckets.find((b) => b.timestamp === bucketTs);
    if (existing) {
      existing.values.push(value);
    } else {
      buckets.push({ timestamp: bucketTs, values: [value], labels });
    }
    this.pruneOld(buckets);
  }

  public recordGauge(metric: string, value: number): void {
    this.gauges.set(metric, value);
  }

  public queryTimeseries(metric: string, windowMs: number, intervalMs: number): TimeseriesPoint[] {
    const buckets = this.counters.get(metric) ?? [];
    const now = Date.now();
    const from = now - windowMs;
    const result: TimeseriesPoint[] = [];

    for (let ts = this.bucketTs(from); ts <= now; ts += intervalMs) {
      const bucket = buckets.find((b) => b.timestamp >= ts && b.timestamp < ts + intervalMs);
      result.push({
        timestamp: new Date(ts).toISOString(),
        value: bucket?.value ?? 0,
      });
    }

    return result;
  }

  public getLatencyPercentiles(windowMs: number): LatencyPercentiles {
    const buckets = this.histograms.get("cycle_latency_ms") ?? [];
    const now = Date.now();
    const from = now - windowMs;

    const allValues: number[] = [];
    const byAgentValues = new Map<string, number[]>();

    for (const b of buckets) {
      if (b.timestamp < from) continue;
      allValues.push(...b.values);
      const agent = b.labels?.agent_id;
      if (agent) {
        const arr = byAgentValues.get(agent) ?? [];
        arr.push(...b.values);
        byAgentValues.set(agent, arr);
      }
    }

    const by_agent: Record<string, { p50: number; p95: number; p99: number }> = {};
    for (const [agent, vals] of byAgentValues) {
      by_agent[agent] = computePercentiles(vals);
    }

    return { ...computePercentiles(allValues), by_agent };
  }

  public getSnapshot(activeSessions: number, uptimeSeconds: number, version: string, sseConnections?: number): MetricsSnapshot {
    return {
      total_sessions_created: this.sumCounter("sessions_created"),
      total_cycles_executed: this.sumCounter("cycles_executed"),
      active_sessions: activeSessions,
      total_eval_runs: this.sumCounter("eval_runs"),
      error_count: this.sumCounter("errors"),
      average_latency_ms: this.avgHistogram("cycle_latency_ms"),
      eval_pass_rate: this.gauges.get("eval_pass_rate") ?? 0,
      uptime_seconds: uptimeSeconds,
      active_sse_connections: sseConnections,
      version,
    };
  }

  private sumCounter(metric: string): number {
    return (this.counters.get(metric) ?? []).reduce((s, b) => s + b.value, 0);
  }

  private avgHistogram(metric: string): number {
    const buckets = this.histograms.get(metric) ?? [];
    const all = buckets.flatMap((b) => b.values);
    if (all.length === 0) return 0;
    return all.reduce((s, v) => s + v, 0) / all.length;
  }

  private bucketTs(ts: number): number {
    return Math.floor(ts / this.intervalMs) * this.intervalMs;
  }

  private pruneOld<T extends { timestamp: number }>(buckets: T[]): void {
    const cutoff = Date.now() - this.retentionMs;
    while (buckets.length > 0 && buckets[0].timestamp < cutoff) {
      buckets.shift();
    }
  }

  private getOrCreateCounterBuckets(metric: string): CounterBucket[] {
    let buckets = this.counters.get(metric);
    if (!buckets) {
      buckets = [];
      this.counters.set(metric, buckets);
    }
    return buckets;
  }

  private getOrCreateHistogramBuckets(metric: string): HistogramBucket[] {
    let buckets = this.histograms.get(metric);
    if (!buckets) {
      buckets = [];
      this.histograms.set(metric, buckets);
    }
    return buckets;
  }
}

function computePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
