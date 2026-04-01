import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { useMetricsStore } from "../stores/metrics.store";
import { apiFetch } from "../api/client";
import type { NeuroCoreEvent } from "../api/types";
import { useWebSocket } from "../hooks/useWebSocket";

const WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/v1/ws`;

const EVENT_COLORS: Record<string, string> = {
  session: "#3b82f6",
  cycle: "#8b5cf6",
  goal: "#f59e0b",
  proposal: "#06b6d4",
  action: "#10b981",
  memory: "#ec4899",
  skill: "#f97316",
  device: "#14b8a6",
  agent: "#6366f1",
  approval: "#ef4444",
};

const SESSION_COLORS: Record<string, string> = {
  running: "#3b82f6",
  completed: "#10b981",
  waiting: "#f59e0b",
  failed: "#ef4444",
  suspended: "#6b7280",
  escalated: "#f97316",
  hydrated: "#8b5cf6",
  created: "#64748b",
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { snapshot, prevSnapshot, timeseries, latency, timeRange, fetchMetrics, fetchTimeseries, fetchLatency, setTimeRange } = useMetricsStore();
  const { connected, subscribe } = useWebSocket(WS_URL);
  const [events, setEvents] = useState<NeuroCoreEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [paused, setPaused] = useState(false);
  const [healthOk, setHealthOk] = useState(true);
  const [sessionDist, setSessionDist] = useState<{ state: string; count: number }[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    fetchMetrics();
    fetchTimeseries();
    fetchLatency();
    const id = setInterval(fetchMetrics, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    apiFetch<{ sessions: { session: { state: string } }[] }>("/v1/sessions")
      .then((res) => {
        const counts: Record<string, number> = {};
        for (const s of res.sessions) {
          const st = s.session.state;
          counts[st] = (counts[st] || 0) + 1;
        }
        setSessionDist(Object.entries(counts).map(([state, count]) => ({ state, count })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/v1/healthz").then((r) => setHealthOk(r.ok)).catch(() => setHealthOk(false));
    const id = setInterval(() => {
      fetch("/v1/healthz").then((r) => setHealthOk(r.ok)).catch(() => setHealthOk(false));
    }, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const unsub = subscribe("metrics", () => { fetchMetrics(); });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    const unsub = subscribe("events", (msg) => {
      if (pausedRef.current) return;
      const ev = msg.payload as NeuroCoreEvent;
      setEvents((prev) => [...prev.slice(-49), ev]);
    });
    return unsub;
  }, [subscribe]);

  if (!snapshot) {
    return <div className="p-6 text-zinc-500">Loading metrics...</div>;
  }

  const delta = (curr: number, prev?: number) => {
    if (prev == null) return null;
    const d = curr - prev;
    if (d === 0) return null;
    const sign = d > 0 ? "+" : "";
    const color = d > 0 ? "text-emerald-400" : "text-red-400";
    return <span className={`text-xs ${color}`}>{sign}{d}</span>;
  };

  const cards: { label: string; value: string; deltaEl: React.ReactNode; onClick?: string; color: string }[] = [
    {
      label: "Active Sessions",
      value: String(snapshot.active_sessions),
      deltaEl: delta(snapshot.active_sessions, prevSnapshot?.active_sessions),
      onClick: "/sessions?state=running",
      color: "border-blue-500/30",
    },
    {
      label: "Total Cycles",
      value: snapshot.total_cycles_executed.toLocaleString(),
      deltaEl: delta(snapshot.total_cycles_executed, prevSnapshot?.total_cycles_executed),
      color: "border-violet-500/30",
    },
    {
      label: "Error Rate",
      value: snapshot.error_count > 0
        ? `${((snapshot.error_count / Math.max(snapshot.total_cycles_executed, 1)) * 100).toFixed(1)}%`
        : "0%",
      deltaEl: prevSnapshot ? delta(
        snapshot.error_count / Math.max(snapshot.total_cycles_executed, 1),
        prevSnapshot.error_count / Math.max(prevSnapshot.total_cycles_executed, 1)
      ) : null,
      onClick: "/sessions?state=failed",
      color: "border-red-500/30",
    },
    {
      label: "Avg Latency",
      value: `${snapshot.average_latency_ms.toFixed(0)}ms`,
      deltaEl: delta(-snapshot.average_latency_ms, prevSnapshot ? -prevSnapshot.average_latency_ms : undefined),
      color: "border-amber-500/30",
    },
    {
      label: "Eval Pass Rate",
      value: `${(snapshot.eval_pass_rate * 100).toFixed(1)}%`,
      deltaEl: delta(
        Math.round(snapshot.eval_pass_rate * 1000),
        prevSnapshot ? Math.round(prevSnapshot.eval_pass_rate * 1000) : undefined
      ),
      onClick: "/evals",
      color: "border-emerald-500/30",
    },
  ];

  const filteredEvents = eventFilter === "all"
    ? events
    : events.filter((e) => e.event_type.startsWith(eventFilter));

  const tsData = timeseries.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: p.value,
  }));

  const latencyData = latency?.agents ?? [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-200">Dashboard</h2>
        <div className="flex gap-1 text-xs">
          {(["1h", "6h", "24h", "7d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-2.5 py-1 rounded ${timeRange === r ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            onClick={() => card.onClick && navigate(card.onClick)}
            className={`rounded-lg border ${card.color} bg-zinc-900 p-4 ${card.onClick ? "cursor-pointer hover:bg-zinc-800/80" : ""}`}
          >
            <div className="text-[11px] text-zinc-500 uppercase tracking-wider">{card.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-zinc-100">{card.value}</span>
              {card.deltaEl}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Cycle Throughput</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={tsData}>
              <defs>
                <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={40} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#a1a1aa" }}
              />
              <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#throughputGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Latency Distribution</h3>
          {latencyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={latencyData}>
                <XAxis dataKey="agent_id" tick={{ fontSize: 10, fill: "#71717a" }} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={40} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "#a1a1aa" }}
                />
                <Bar dataKey="p50" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="p95" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="p99" fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-zinc-600 text-sm">No latency data</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Session Distribution</h3>
          {sessionDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={sessionDist}
                  dataKey="count"
                  nameKey="state"
                  cx="50%"
                  cy="50%"
                  outerRadius={65}
                  innerRadius={35}
                  paddingAngle={2}
                >
                  {sessionDist.map((entry) => (
                    <Cell
                      key={entry.state}
                      fill={SESSION_COLORS[entry.state] ?? "#6b7280"}
                      onClick={() => navigate(`/sessions?state=${entry.state}`)}
                      className="cursor-pointer"
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-zinc-600 text-sm">No sessions</div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {sessionDist.map((s) => (
              <div key={s.state} className="flex items-center gap-1 text-[10px] text-zinc-400">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: SESSION_COLORS[s.state] ?? "#6b7280" }} />
                {s.state} ({s.count})
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Health Status</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <HealthRow label="Runtime" ok={healthOk} />
              <HealthRow label="WebSocket" ok={connected} />
              <HealthRow label="Store" ok={snapshot.active_sessions >= 0} />
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Uptime</span>
                <span className="text-zinc-300">{formatUptime(snapshot.uptime_seconds)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Version</span>
                <span className="text-zinc-300">{snapshot.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">SSE Connections</span>
                <span className="text-zinc-300">{snapshot.active_sse_connections ?? "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Total Sessions</span>
                <span className="text-zinc-300">{snapshot.total_sessions_created}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Live Event Feed</h3>
          <div className="flex items-center gap-2">
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300"
            >
              <option value="all">All Events</option>
              <option value="session">Session</option>
              <option value="cycle">Cycle</option>
              <option value="goal">Goal</option>
              <option value="proposal">Proposal</option>
              <option value="action">Action</option>
              <option value="memory">Memory</option>
              <option value="device">Device</option>
              <option value="agent">Agent</option>
            </select>
            <button
              onClick={() => setPaused(!paused)}
              className={`px-2 py-0.5 rounded text-xs ${paused ? "bg-amber-600/20 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
        <div className="max-h-[260px] overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <div className="text-zinc-600 text-sm py-4 text-center">Waiting for events...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-1 font-normal w-20">Time</th>
                  <th className="text-left py-1 font-normal w-40">Event</th>
                  <th className="text-left py-1 font-normal w-28">Session</th>
                  <th className="text-left py-1 font-normal">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev) => (
                  <tr
                    key={ev.event_id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
                    onClick={() => ev.session_id && navigate(`/sessions/${ev.session_id}`)}
                  >
                    <td className="py-1.5 text-zinc-500 font-mono">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="py-1.5">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          background: `${getEventColor(ev.event_type)}20`,
                          color: getEventColor(ev.event_type),
                        }}
                      >
                        {ev.event_type}
                      </span>
                    </td>
                    <td className="py-1.5 text-zinc-400 font-mono">
                      {ev.session_id ? ev.session_id.slice(0, 12) : "-"}
                    </td>
                    <td className="py-1.5 text-zinc-500 truncate max-w-[300px]">
                      {summarizeEvent(ev)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
      <span className="text-sm text-zinc-300">{label}</span>
      <span className={`text-xs ${ok ? "text-emerald-400" : "text-red-400"}`}>{ok ? "OK" : "Down"}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getEventColor(eventType: string): string {
  const prefix = eventType.split(".")[0] ?? "";
  return EVENT_COLORS[prefix] ?? "#6b7280";
}

function summarizeEvent(ev: NeuroCoreEvent): string {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  if (ev.event_type === "session.state_changed") return `state → ${p.state ?? ""}`;
  if (ev.event_type === "cycle.started") return `cycle ${String(p.cycle_id ?? "").slice(0, 8)}`;
  if (ev.event_type === "cycle.completed") return `cycle ${String(p.cycle_id ?? "").slice(0, 8)} done`;
  if (ev.event_type === "action.executed") return `${p.action_type ?? ""} ${p.status ?? ""}`;
  if (ev.event_type === "goal.status_changed") return `${p.title ?? ""} → ${p.status ?? ""}`;
  return String(p.summary ?? p.message ?? "").slice(0, 60);
}
