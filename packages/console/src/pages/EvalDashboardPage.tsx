import { useEffect, useState } from "react";
import { Link } from "react-router";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useEvalsStore } from "../stores/evals.store";

export function EvalDashboardPage() {
  const { runs, currentRun, fetchRuns, fetchRun, deleteRun } = useEvalsStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => { fetchRuns(); }, []);

  const trendData = runs.slice(-20).map((r) => ({
    name: r.run_id.slice(0, 6),
    passRate: Math.round(r.pass_rate * 100),
    avgScore: Math.round(r.average_score * 100),
  }));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-200">Eval Dashboard</h2>
        {selectedIds.size === 2 && (
          <Link
            to={`/evals/compare?run_a=${[...selectedIds][0]}&run_b=${[...selectedIds][1]}`}
            className="px-3 py-1.5 rounded text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
          >
            Compare Selected
          </Link>
        )}
      </div>

      {trendData.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Pass Rate Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#71717a" }} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={30} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }} />
              <Line type="monotone" dataKey="passRate" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="avgScore" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="h-2 w-4 bg-emerald-500 rounded" />Pass Rate</span>
            <span className="flex items-center gap-1"><span className="h-2 w-4 bg-blue-500 rounded" />Avg Score</span>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-900/50 text-zinc-500 text-left">
              <th className="py-2 px-3 font-medium w-8">
                <span className="text-[10px]">Sel</span>
              </th>
              <th className="py-2 px-3 font-medium">Run ID</th>
              <th className="py-2 px-3 font-medium w-24">Agent</th>
              <th className="py-2 px-3 font-medium w-16 text-right">Cases</th>
              <th className="py-2 px-3 font-medium w-16 text-right">Pass</th>
              <th className="py-2 px-3 font-medium w-20 text-right">Pass Rate</th>
              <th className="py-2 px-3 font-medium w-20 text-right">Avg Score</th>
              <th className="py-2 px-3 font-medium w-28">Started</th>
              <th className="py-2 px-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr><td colSpan={9} className="py-8 text-center text-zinc-600">No eval runs</td></tr>
            ) : runs.map((r) => (
              <tr
                key={r.run_id}
                className={`border-t border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer ${currentRun?.run_id === r.run_id ? "bg-zinc-800/50" : ""}`}
                onClick={() => fetchRun(r.run_id)}
              >
                <td className="py-2 px-3" onClick={(e) => { e.stopPropagation(); toggleSelect(r.run_id); }}>
                  <input type="checkbox" checked={selectedIds.has(r.run_id)} readOnly className="accent-blue-500" />
                </td>
                <td className="py-2 px-3 font-mono text-blue-400">{r.run_id.slice(0, 10)}</td>
                <td className="py-2 px-3 text-zinc-400">{r.agent_id ?? "-"}</td>
                <td className="py-2 px-3 text-right text-zinc-400">{r.case_count}</td>
                <td className="py-2 px-3 text-right text-zinc-400">{r.pass_count}</td>
                <td className="py-2 px-3 text-right">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.pass_rate >= 0.9 ? "bg-emerald-500/10 text-emerald-400" : r.pass_rate >= 0.7 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>
                    {(r.pass_rate * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="py-2 px-3 text-right text-zinc-300">{(r.average_score * 100).toFixed(1)}</td>
                <td className="py-2 px-3 text-zinc-500">{new Date(r.started_at).toLocaleString()}</td>
                <td className="py-2 px-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteRun(r.run_id); }}
                    className="text-zinc-600 hover:text-red-400 text-[10px]"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {currentRun && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            Run Detail: {currentRun.run_id.slice(0, 12)}
          </h3>
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-zinc-500">Cases</span>
              <div className="text-zinc-300">{currentRun.case_count}</div>
            </div>
            <div>
              <span className="text-zinc-500">Passed</span>
              <div className="text-zinc-300">{currentRun.pass_count}/{currentRun.case_count}</div>
            </div>
            <div>
              <span className="text-zinc-500">Pass Rate</span>
              <div className="text-zinc-300">{(currentRun.pass_rate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <span className="text-zinc-500">Duration</span>
              <div className="text-zinc-300">
                {(() => {
                  const endedAt = currentRun.ended_at ?? currentRun.started_at;
                  const ms = new Date(endedAt).getTime() - new Date(currentRun.started_at).getTime();
                  return ms > 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
