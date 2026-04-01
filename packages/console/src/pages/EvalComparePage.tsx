import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useEvalsStore } from "../stores/evals.store";

export function EvalComparePage() {
  const [searchParams] = useSearchParams();
  const { runs, fetchRuns } = useEvalsStore();
  const [runA, setRunA] = useState<string>(searchParams.get("run_a") ?? "");
  const [runB, setRunB] = useState<string>(searchParams.get("run_b") ?? "");

  useEffect(() => { fetchRuns(); }, []);

  const a = runs.find((r) => r.run_id === runA);
  const b = runs.find((r) => r.run_id === runB);

  const metrics: { key: string; label: string; a: string; b: string; delta: string }[] = [];
  if (a && b) {
    const prA = a.pass_rate * 100;
    const prB = b.pass_rate * 100;
    metrics.push(
      { key: "pr", label: "Pass Rate", a: `${prA.toFixed(1)}%`, b: `${prB.toFixed(1)}%`, delta: `${prB > prA ? "+" : ""}${(prB - prA).toFixed(1)}%` },
      { key: "sc", label: "Avg Score", a: (a.average_score * 100).toFixed(1), b: (b.average_score * 100).toFixed(1), delta: `${(b.average_score - a.average_score) > 0 ? "+" : ""}${((b.average_score - a.average_score) * 100).toFixed(1)}` },
      { key: "cc", label: "Case Count", a: String(a.case_count), b: String(b.case_count), delta: String(b.case_count - a.case_count) },
      { key: "pc", label: "Pass Count", a: String(a.pass_count), b: String(b.pass_count), delta: String(b.pass_count - a.pass_count) },
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-zinc-200">Eval Compare</h2>

      <div className="flex items-center gap-3">
        <select value={runA} onChange={(e) => setRunA(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 flex-1">
          <option value="">Select Run A</option>
          {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.run_id.slice(0, 12)} — {(r.pass_rate * 100).toFixed(1)}%</option>)}
        </select>
        <span className="text-zinc-500 text-xs">vs</span>
        <select value={runB} onChange={(e) => setRunB(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 flex-1">
          <option value="">Select Run B</option>
          {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.run_id.slice(0, 12)} — {(r.pass_rate * 100).toFixed(1)}%</option>)}
        </select>
      </div>

      {a && b ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="py-2 text-left font-normal">Metric</th>
                <th className="py-2 text-right font-normal">Run A</th>
                <th className="py-2 text-right font-normal">Run B</th>
                <th className="py-2 text-right font-normal">Delta</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.key} className="border-b border-zinc-800/50">
                  <td className="py-2 text-zinc-300">{m.label}</td>
                  <td className="py-2 text-right text-zinc-400">{m.a}</td>
                  <td className="py-2 text-right text-zinc-400">{m.b}</td>
                  <td className={`py-2 text-right ${m.delta.startsWith("+") ? "text-emerald-400" : m.delta.startsWith("-") ? "text-red-400" : "text-zinc-500"}`}>
                    {m.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-zinc-600 text-xs py-8 text-center">Select two runs to compare</div>
      )}
    </div>
  );
}
