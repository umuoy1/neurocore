import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useSessionsStore } from "../stores/sessions.store";
import type { SessionState } from "../api/types";

const STATE_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  completed: "bg-emerald-500",
  waiting: "bg-amber-500",
  failed: "bg-red-500",
  suspended: "bg-zinc-500",
  escalated: "bg-orange-500",
  hydrated: "bg-violet-500",
  created: "bg-zinc-400",
  aborted: "bg-red-400",
};

const STATES: SessionState[] = ["created", "hydrated", "running", "waiting", "suspended", "escalated", "completed", "failed", "aborted"];

export function SessionListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions, total, loading, filters, fetchSessions } = useSessionsStore();
  const [search, setSearch] = useState("");

  const stateFilter = searchParams.get("state") ?? "";

  useEffect(() => {
    const f: Record<string, string> = {};
    if (stateFilter) f.state = stateFilter;
    fetchSessions(f);
  }, [stateFilter]);

  useEffect(() => {
    const id = setInterval(() => fetchSessions(), 10000);
    return () => clearInterval(id);
  }, []);

  const filtered = search
    ? sessions.filter((s) =>
        s.session_id.toLowerCase().includes(search.toLowerCase()) ||
        s.agent_id.toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  const agentIds = [...new Set(sessions.map((s) => s.agent_id))];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-200">Sessions</h2>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={stateFilter}
          onChange={(e) => {
            if (e.target.value) {
              setSearchParams({ state: e.target.value });
            } else {
              setSearchParams({});
            }
          }}
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300"
        >
          <option value="">All States</option>
          {STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={filters.agent_id ?? ""}
          onChange={(e) => fetchSessions({ ...filters, agent_id: e.target.value || undefined })}
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300"
        >
          <option value="">All Agents</option>
          {agentIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search session ID or agent..."
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 flex-1 min-w-[200px]"
        />
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-900/50 text-zinc-500 text-left">
              <th className="py-2 px-3 font-medium w-24">State</th>
              <th className="py-2 px-3 font-medium">Session ID</th>
              <th className="py-2 px-3 font-medium w-28">Agent</th>
              <th className="py-2 px-3 font-medium w-16">Mode</th>
              <th className="py-2 px-3 font-medium w-16 text-right">Cycles</th>
              <th className="py-2 px-3 font-medium w-16 text-right">Ep</th>
              <th className="py-2 px-3 font-medium w-16 text-right">Approval</th>
              <th className="py-2 px-3 font-medium w-24 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-zinc-600">Loading...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-zinc-600">No sessions found</td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr
                  key={s.session_id}
                  className="border-t border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
                  onClick={() => navigate(`/sessions/${s.session_id}`)}
                >
                  <td className="py-2 px-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${STATE_COLORS[s.session.state] ?? "bg-zinc-500"}`} />
                      <span className="text-zinc-300">{s.session.state}</span>
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono text-blue-400">{s.session_id.slice(0, 16)}</td>
                  <td className="py-2 px-3 text-zinc-400">{s.agent_id}</td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">{s.session.session_mode}</span>
                  </td>
                  <td className="py-2 px-3 text-right text-zinc-400">{s.trace_count ?? 0}</td>
                  <td className="py-2 px-3 text-right text-zinc-400">{s.episode_count ?? 0}</td>
                  <td className="py-2 px-3 text-right text-zinc-400">{s.pending_approval ? "1" : "0"}</td>
                  <td className="py-2 px-3 text-right text-zinc-500">{s.created_at ? new Date(s.created_at).toLocaleDateString() : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="text-xs text-zinc-500">
          Showing {filtered.length} of {total} sessions
        </div>
      )}
    </div>
  );
}
