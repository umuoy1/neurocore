import { useEffect } from "react";
import { useParams, Link } from "react-router";
import { useWorkspaceStore } from "../stores/workspace.store";
import type { CandidateAction, RiskAssessment, ConfidenceAssessment, BudgetAssessment } from "../api/types";

export function WorkspaceInspectorPage() {
  const { sessionId, cycleId } = useParams<{ sessionId: string; cycleId: string }>();
  const { snapshot, loading, fetchWorkspace } = useWorkspaceStore();

  useEffect(() => {
    if (sessionId && cycleId) fetchWorkspace(sessionId, cycleId);
  }, [sessionId, cycleId]);

  if (loading) {
    return <div className="p-6 text-zinc-500">Loading workspace...</div>;
  }

  if (!snapshot) {
    return <div className="p-6 text-zinc-500">No workspace snapshot available.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/sessions/${sessionId}/traces`} className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Back to Traces
        </Link>
        <h2 className="text-lg font-semibold text-zinc-200">
          Workspace <span className="font-mono text-zinc-400">{cycleId?.slice(0, 12)}</span>
        </h2>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Context Summary</h3>
        <p className="text-xs text-zinc-300">{snapshot.context_summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <RiskPanel risk={snapshot.risk_assessment} />
        <ConfidenceBudgetPanel confidence={snapshot.confidence_assessment} budget={snapshot.budget_assessment} />
      </div>

      {snapshot.active_goals.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Active Goals ({snapshot.active_goals.length})</h3>
          <div className="flex flex-wrap gap-2">
            {snapshot.active_goals.map((g) => {
              const color = STATUS_BG[g.status] ?? "bg-zinc-800";
              return (
                <Link
                  key={g.goal_id}
                  to={`/sessions/${sessionId}/goals`}
                  className={`px-2 py-1 rounded text-xs ${color} text-zinc-300 hover:opacity-80`}
                >
                  {g.title}
                  <span className="ml-1 text-[10px] text-zinc-500">{g.status}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Memory Digest ({snapshot.memory_digest.length})</h3>
          {snapshot.memory_digest.length === 0 ? (
            <div className="text-zinc-600 text-xs">No memory digest</div>
          ) : (
            <div className="space-y-1">
              {snapshot.memory_digest.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${m.relevance * 100}%` }} />
                  </div>
                  <span className="text-zinc-400 w-8 text-right">{m.relevance.toFixed(2)}</span>
                  <span className="text-zinc-300 truncate">{m.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Skill Digest ({snapshot.skill_digest.length})</h3>
          {snapshot.skill_digest.length === 0 ? (
            <div className="text-zinc-600 text-xs">No skill digest</div>
          ) : (
            <div className="space-y-1">
              {snapshot.skill_digest.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${s.relevance * 100}%` }} />
                  </div>
                  <span className="text-zinc-400 w-8 text-right">{s.relevance.toFixed(2)}</span>
                  <span className="text-zinc-300">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {snapshot.candidate_actions.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            Candidate Actions ({snapshot.candidate_actions.length})
          </h3>
          <div className="space-y-2">
            {snapshot.candidate_actions.map((action, i) => {
              const isSelected = action.action_id === snapshot.selected_proposal_id;
              return <ActionCard key={action.action_id} action={action} index={i + 1} selected={isSelected} />;
            })}
          </div>
          {snapshot.decision_reasoning && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <span className="text-[10px] text-zinc-500 uppercase">Decision Reasoning</span>
              <p className="text-xs text-zinc-400 mt-1">{snapshot.decision_reasoning}</p>
            </div>
          )}
        </div>
      )}

      {snapshot.competition_log && (
        <CompetitionPanel log={snapshot.competition_log} />
      )}

      {snapshot.policy_decisions && snapshot.policy_decisions.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Policy Decisions ({snapshot.policy_decisions.length})</h3>
          <div className="space-y-2">
            {snapshot.policy_decisions.map((pd, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                  pd.level === "block" ? "bg-red-500/10 text-red-400" :
                  pd.level === "warn" ? "bg-amber-500/10 text-amber-400" :
                  "bg-blue-500/10 text-blue-400"
                }`}>{pd.level}</span>
                <div className="flex-1">
                  <div className="text-zinc-300">{pd.policy_name}</div>
                  {pd.reason && <div className="text-zinc-500 mt-0.5">{pd.reason}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RiskPanel({ risk }: { risk?: RiskAssessment }) {
  if (!risk) return <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-zinc-600 text-xs">No risk assessment</div>;

  const metrics = [
    { label: "Risk", value: risk.risk },
    { label: "Urgency", value: risk.urgency ?? 0 },
    { label: "Uncertainty", value: risk.uncertainty ?? 0 },
    { label: "Impact", value: risk.impact ?? 0 },
  ];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Risk Assessment</h3>
      <div className="space-y-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 w-20">{m.label}</span>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${m.value < 0.3 ? "bg-emerald-500" : m.value < 0.7 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${m.value * 100}%` }}
              />
            </div>
            <span className="text-zinc-400 w-8 text-right">{m.value.toFixed(2)}</span>
          </div>
        ))}
        {risk.summary && <p className="text-[11px] text-zinc-500 mt-2">{risk.summary}</p>}
      </div>
    </div>
  );
}

function ConfidenceBudgetPanel({ confidence, budget }: { confidence?: ConfidenceAssessment; budget?: BudgetAssessment }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Confidence / Budget</h3>
      {confidence && (
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Confidence</span>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${confidence.confidence > 0.7 ? "bg-emerald-500" : confidence.confidence > 0.4 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${confidence.confidence * 100}%` }}
              />
            </div>
            <span className="text-zinc-400">{confidence.confidence.toFixed(2)}</span>
          </div>
          {confidence.summary && <p className="text-[11px] text-zinc-500 mt-1">{confidence.summary}</p>}
        </div>
      )}
      {budget && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Budget</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${budget.within_budget ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {budget.within_budget ? "Within Limit" : "Over Budget"}
          </span>
        </div>
      )}
      {!confidence && !budget && <div className="text-zinc-600 text-xs">No assessment data</div>}
    </div>
  );
}

function ActionCard({ action, index, selected }: { action: CandidateAction; index: number; selected: boolean }) {
  const seColor = action.side_effect_level === "none" ? "bg-emerald-500/10 text-emerald-400"
    : action.side_effect_level === "low" ? "bg-blue-500/10 text-blue-400"
    : action.side_effect_level === "medium" ? "bg-amber-500/10 text-amber-400"
    : "bg-red-500/10 text-red-400";

  return (
    <div className={`rounded border p-2.5 ${selected ? "border-blue-500/50 bg-blue-500/5" : "border-zinc-800/50"}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-500 w-4">{index}.</span>
        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">{action.action_type}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${seColor}`}>{action.side_effect_level}</span>
        {selected && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400">Selected</span>}
      </div>
      <div className="mt-1 text-xs text-zinc-300">{action.title}</div>
      {action.description && <div className="text-[11px] text-zinc-500 mt-0.5">{action.description}</div>}
      {action.tool_name && (
        <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
          {action.tool_name} {action.tool_args ? JSON.stringify(action.tool_args).slice(0, 80) : ""}
        </div>
      )}
      {action.expected_outcome && (
        <div className="text-[11px] text-zinc-500 mt-0.5">Expected: {action.expected_outcome}</div>
      )}
    </div>
  );
}

function CompetitionPanel({ log }: { log: { entries: { rank: number; module_name: string; source: string; raw_salience: number; source_weight: number; goal_alignment: number; final_score: number; proposal_id: string }[]; conflicts: { proposal_ids: string[]; conflict_type: string; score_gap: number }[]; selection_reasoning: string } }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Competition Log</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800">
            <th className="py-1 text-left font-normal w-8">#</th>
            <th className="py-1 text-left font-normal">Module</th>
            <th className="py-1 text-left font-normal">Source</th>
            <th className="py-1 text-left font-normal">Salience</th>
            <th className="py-1 text-left font-normal">Weight</th>
            <th className="py-1 text-left font-normal">Alignment</th>
            <th className="py-1 text-left font-normal">Final</th>
          </tr>
        </thead>
        <tbody>
          {log.entries.map((e) => (
            <tr key={e.proposal_id} className={`border-b border-zinc-800/50 ${e.rank === 1 ? "bg-blue-500/5" : ""}`}>
              <td className="py-1 text-zinc-400">{e.rank}{e.rank === 1 ? " ★" : ""}</td>
              <td className="py-1 text-zinc-300">{e.module_name}</td>
              <td className="py-1 text-zinc-400">{e.source}</td>
              <td className="py-1 text-zinc-400">{e.raw_salience.toFixed(2)}</td>
              <td className="py-1 text-zinc-400">{e.source_weight.toFixed(2)}</td>
              <td className="py-1 text-zinc-400">{e.goal_alignment.toFixed(2)}</td>
              <td className="py-1 text-zinc-300 font-medium">{e.final_score.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {log.conflicts.length > 0 && (
        <div className="mt-2 space-y-1">
          {log.conflicts.map((c, i) => (
            <div key={i} className="text-[10px] text-amber-400">
              Conflict: {c.conflict_type} (gap: {c.score_gap.toFixed(3)})
            </div>
          ))}
        </div>
      )}
      {log.selection_reasoning && (
        <div className="mt-2 text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">{log.selection_reasoning}</div>
      )}
    </div>
  );
}

const STATUS_BG: Record<string, string> = {
  active: "bg-blue-500/10",
  completed: "bg-emerald-500/10",
  pending: "bg-zinc-800",
  blocked: "bg-red-500/10",
  waiting_input: "bg-amber-500/10",
  failed: "bg-red-500/10",
};
