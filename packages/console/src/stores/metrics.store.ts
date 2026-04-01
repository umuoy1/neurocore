import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { MetricsSnapshot, TimeseriesPoint, LatencyPercentiles } from "../api/types";

interface MetricsState {
  snapshot: MetricsSnapshot | null;
  prevSnapshot: MetricsSnapshot | null;
  timeseries: TimeseriesPoint[];
  latency: LatencyPercentiles | null;
  loading: boolean;
  timeRange: "1h" | "6h" | "24h" | "7d";
  setTimeRange: (range: MetricsState["timeRange"]) => void;
  fetchMetrics: () => Promise<void>;
  fetchTimeseries: () => Promise<void>;
  fetchLatency: () => Promise<void>;
  updateFromWs: (snapshot: Partial<MetricsSnapshot>) => void;
}

const timeRangeMs: Record<string, number> = {
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
};

export const useMetricsStore = create<MetricsState>((set, get) => ({
  snapshot: null,
  prevSnapshot: null,
  timeseries: [],
  latency: null,
  loading: false,
  timeRange: "1h",

  setTimeRange: (range) => {
    set({ timeRange: range });
    get().fetchTimeseries();
    get().fetchLatency();
  },

  fetchMetrics: async () => {
    set({ loading: true });
    try {
      const snapshot = await apiFetch<MetricsSnapshot>("/v1/metrics");
      set((s) => ({ prevSnapshot: s.snapshot, snapshot }));
    } finally {
      set({ loading: false });
    }
  },

  fetchTimeseries: async () => {
    const window = timeRangeMs[get().timeRange];
    const interval = get().timeRange === "1h" ? 60000 : get().timeRange === "6h" ? 300000 : 900000;
    const res = await apiFetch<{ points: TimeseriesPoint[] }>(
      `/v1/metrics/timeseries?metric=cycles_executed&window=${window}&interval=${interval}`
    );
    set({ timeseries: res.points });
  },

  fetchLatency: async () => {
    const window = timeRangeMs[get().timeRange];
    const res = await apiFetch<LatencyPercentiles>(`/v1/metrics/latency?window=${window}`);
    set({ latency: res });
  },

  updateFromWs: (partial) => {
    set((s) => {
      if (!s.snapshot) return s;
      const newSnapshot = { ...s.snapshot, ...partial };
      return { prevSnapshot: s.snapshot, snapshot: newSnapshot };
    });
  },
}));
