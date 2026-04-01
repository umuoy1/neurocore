import { useEffect } from "react";
import { useParams, Link } from "react-router";
import { useTracesStore } from "../stores/traces.store";
import type { CycleTraceRecord, CompetitionEntry } from "../api/types";

const PHASE_COLORS = [
  "#06b6d4", "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899",
];
const PHASE_LABELS = ["Perceive", "Propose", "Evaluate", "Decide", "Act", "Learn"];

export function TraceViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { traces, selectedCycleId, selectedCycle, loading, fetchTraces, selectCycle } = useTracesStore();

  useEffect(() => {
    if (sessionId) fetchTraces(sessionId);
  }, [sessionId]);

  if (loading && traces.length === 0) {
    return <div className="p-6 text-zinc-500">Loading traces...</div>;
  }

  const totalLatency = traces.reduce((sum, t) => sum + (t.trace.metrics?.total_latency_ms ?? 0), 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/sessions/${sessionId}`} className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Back to Session
        </Link>
        <h2 className="text-lg font-semibold text-zinc-200">Cycle Traces</h2>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Cycle Timeline</h3>
        {traces.length === 0 ? (
          <div className="text-zinc-600 text-sm py-4 text-center">No traces recorded</div>
        ) : (
          <div className="flex items-end gap-1 h-16">
            {traces.map((t, i) => {
              const latency = t.trace.metrics?.total_latency_ms ?? 0;
              const pct = totalLatency > 0 ? (latency / totalLatency) * 100 : 100 / traces.length;
              const isSelected = t.trace.cycle_id === selectedCycleId;
              const hasError = t.prediction_errors.length > 0;
              return (
                <button
                  key={t.trace.cycle_id}
                  onClick={() => selectCycle(t.trace.cycle_id)}
                  className={`relative rounded-sm transition-all min-w-[24px] ${
                    isSelected
                      ? "bg-blue-500 ring-1 ring-blue-400"
                      : hasError
                      ? "bg-red-500/60 hover:bg-red-500/80"
                      : "bg-blue-500/40 hover:bg-blue-500/60"
                  }`}
                  style={{ width: `${Math.max(pct, 2)}%`, height: "100%" }}
                  title={`Cycle ${i + 1}: ${latency}ms`}
                >
                  <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-zinc-500">
                    {latency > 0 ? `${latency}ms` : "..."}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedCycle && (
        <>
          <PhaseBreakdown record={selectedCycle} />
          <div className="grid grid-cols-2 gap-4">
            <ProposalCompetition record={selectedCycle} />
            <PredictionPanel record={selectedCycle} />
          </div>
          <ActionDetailPanel record={selectedCycle} sessionId={sessionId!} />
        </>
      )}
    </div>
  );
}

function PhaseBreakdown({ record }: { record: CycleTraceRecord }) {
  const phases = computePhases(record);
  const total = phases.reduce((s, p) => s + p.ms, 0) || 1;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
        Cycle {record.trace.cycle_id.slice(0, 8)} — Phase Breakdown
      </h3>
      <div className="flex h-6 rounded overflow-hidden">
        {phases.map((phase, i) => (
          <div
            key={i}
            className="relative group"
            style={{ width: `${(phase.ms / total) * 100}%`, background: PHASE_COLORS[i] }}
            title={`${PHASE_LABELS[i]}: ${phase.ms}ms`}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-[9px] text-white font-medium drop-shadow">{phase.ms}ms</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-2">
        {PHASE_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-1 text-[10px] text-zinc-500">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: PHASE_COLORS[i] }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProposalCompetition({ record }: { record: CycleTraceRecord }) {
  const entries = (record.workspace?.competition_log?.entries ?? []) as CompetitionEntry[];
  const conflicts = (record.workspace?.competition_log?.conflicts ?? []);
  const reasoning = record.workspace?.competition_log?.selection_reasoning;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Proposal Competition</h3>
      {entries.length === 0 ? (
        <div className="text-zinc-600 text-xs py-2">No competition data</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="py-1 text-left font-normal w-8">#</th>
              <th className="py-1 text-left font-normal">Module</th>
              <th className="py-1 text-left font-normal">Source</th>
              <th className="py-1 text-left font-normal w-16">Score</th>
              <th className="py-1 text-left font-normal">Bar</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isWinner = e.rank === 1;
              return (
                <tr key={e.proposal_id} className={`border-b border-zinc-800/50 ${isWinner ? "bg-blue-500/5" : ""}`}>
                  <td className="py-1 text-zinc-400">{e.rank}</td>
                  <td className="py-1 text-zinc-300">{e.module_name}</td>
                  <td className="py-1 text-zinc-400">{e.source}</td>
                  <td className="py-1 text-zinc-300 font-medium">{e.final_score.toFixed(3)}</td>
                  <td className="py-1">
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isWinner ? "bg-blue-500" : "bg-zinc-600"}`}
                        style={{ width: `${e.final_score * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {conflicts.length > 0 && (
        <div className="mt-2 space-y-1">
          {conflicts.map((c, i) => (
            <div key={i} className="text-[10px] text-amber-400">
              Conflict: {c.conflict_type} (gap: {c.score_gap.toFixed(3)})
            </div>
          ))}
        </div>
      )}
      {reasoning && (
        <div className="mt-2 text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">{reasoning}</div>
      )}
    </div>
  );
}

function PredictionPanel({ record }: { record: CycleTraceRecord }) {
  const errors = record.prediction_errors;
  const predictions = record.predictions;
  const observation = record.observation;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Prediction vs Observation</h3>
      {predictions.length === 0 && errors.length === 0 ? (
        <div className="text-zinc-600 text-xs py-2">No prediction data</div>
      ) : (
        <div className="space-y-2">
          {predictions.map((pred) => (
            <div key={pred.prediction_id} className="text-xs space-y-0.5">
              <div className="text-zinc-300">Expected: {pred.expected_outcome}</div>
              {observation && (
                <div className="text-zinc-400">Observed: {observation.summary}</div>
              )}
            </div>
          ))}
          {errors.map((err, i) => {
            const color = err.severity === "high" ? "text-red-400" : err.severity === "medium" ? "text-amber-400" : "text-yellow-400";
            return (
              <div key={i} className={`text-xs ${color} border-l-2 ${err.severity === "high" ? "border-red-500" : "border-amber-500"} pl-2`}>
                [{err.error_type}] severity: {err.severity}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionDetailPanel({ record, sessionId }: { record: CycleTraceRecord; sessionId: string }) {
  const action = record.selected_action;
  const exec = record.action_execution;
  const observation = record.observation;

  if (!action && !exec) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-zinc-600 text-xs">No action executed</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Action Detail</h3>
        {record.trace.cycle_id && (
          <Link
            to={`/sessions/${sessionId}/workspace/${record.trace.cycle_id}`}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            View Full Workspace →
          </Link>
        )}
      </div>
      <div className="grid grid-cols-4 gap-4 text-xs">
        {action && (
          <>
            <div>
              <span className="text-zinc-500">Type</span>
              <div className="text-zinc-300 mt-0.5">{action.action_type}</div>
            </div>
            <div>
              <span className="text-zinc-500">Side Effect</span>
              <div className="text-zinc-300 mt-0.5">{action.side_effect_level}</div>
            </div>
            <div>
              <span className="text-zinc-500">Title</span>
              <div className="text-zinc-300 mt-0.5 truncate">{action.title}</div>
            </div>
            {action.tool_name && (
              <div>
                <span className="text-zinc-500">Tool</span>
                <div className="text-zinc-300 mt-0.5 font-mono">{action.tool_name}</div>
              </div>
            )}
          </>
        )}
        {exec && (
          <>
            <div>
              <span className="text-zinc-500">Status</span>
              <div className={`mt-0.5 ${exec.status === "succeeded" ? "text-emerald-400" : exec.status === "failed" ? "text-red-400" : "text-zinc-300"}`}>
                {exec.status}
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Latency</span>
              <div className="text-zinc-300 mt-0.5">{exec.metrics?.latency_ms ? `${exec.metrics.latency_ms}ms` : "-"}</div>
            </div>
            <div>
              <span className="text-zinc-500">Cost</span>
              <div className="text-zinc-300 mt-0.5">{exec.metrics?.cost ? `$${exec.metrics.cost.toFixed(4)}` : "-"}</div>
            </div>
            <div>
              <span className="text-zinc-500">Tokens</span>
              <div className="text-zinc-300 mt-0.5">
                {exec.metrics?.input_tokens != null ? `${exec.metrics.input_tokens}/${exec.metrics.output_tokens ?? 0}` : "-"}
              </div>
            </div>
          </>
        )}
      </div>
      {observation && (
        <div className="mt-3 pt-3 border-t border-zinc-800 text-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-zinc-500">Observation</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              observation.status === "success" ? "bg-emerald-500/10 text-emerald-400" :
              observation.status === "failure" ? "bg-red-500/10 text-red-400" :
              "bg-zinc-700 text-zinc-400"
            }`}>{observation.status}</span>
            {observation.confidence != null && (
              <span className="text-zinc-500">confidence: {observation.confidence.toFixed(2)}</span>
            )}
          </div>
          <div className="text-zinc-400">{observation.summary}</div>
        </div>
      )}
    </div>
  );
}

function computePhases(record: CycleTraceRecord): { ms: number }[] {
  const base = record.trace.metrics?.total_latency_ms ?? 100;
  const hasExec = !!record.action_execution;
  const hasProposals = record.candidate_actions.length > 0;
  const hasPredictions = record.predictions.length > 0;
  const hasErrors = record.prediction_errors.length > 0;

  const execMs = record.action_execution?.metrics?.latency_ms;
  const execLatency = execMs != null ? execMs : (hasExec ? base * 0.35 : 0);

  const remaining = base - execLatency;
  const weights = [0.1, hasProposals ? 0.2 : 0.1, hasPredictions ? 0.15 : 0.1, 0.1, 0, hasErrors ? 0.1 : 0.05];
  if (!hasExec) weights[4] = 0.35;

  const sumW = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => ({ ms: Math.round((w / sumW) * remaining) }));
}
