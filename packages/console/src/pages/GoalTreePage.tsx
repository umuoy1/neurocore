import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router";
import { useGoalsStore } from "../stores/goals.store";
import { useSessionsStore } from "../stores/sessions.store";
import type { Goal, GoalStatus } from "../api/types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-500",
  completed: "bg-emerald-500",
  pending: "bg-zinc-400",
  blocked: "bg-red-500",
  waiting_input: "bg-amber-500",
  failed: "bg-red-700",
  cancelled: "bg-zinc-500",
};

const STATUS_TEXT: Record<string, string> = {
  active: "text-blue-400",
  completed: "text-emerald-400",
  pending: "text-zinc-400",
  blocked: "text-red-400",
  waiting_input: "text-amber-400",
  failed: "text-red-500",
  cancelled: "text-zinc-500 line-through",
};

const ALL_STATUSES: GoalStatus[] = ["pending", "active", "blocked", "waiting_input", "completed", "failed", "cancelled"];

export function GoalTreePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { goals, selectedGoalId, setGoals, selectGoal, buildTree } = useGoalsStore();
  const { currentSession, fetchSessionDetail } = useSessionsStore();
  const [filter, setFilter] = useState<GoalStatus | "">("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;
    fetchSessionDetail(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (currentSession?.goals) {
      setGoals(currentSession.goals);
      const parentIds = currentSession.goals.filter((g) => g.parent_goal_id).map((g) => g.parent_goal_id!);
      setExpanded(new Set(parentIds));
    }
  }, [currentSession?.goals]);

  const tree = useMemo(() => buildTree(goals), [goals, buildTree]);

  const selectedGoal = goals.find((g) => g.goal_id === selectedGoalId) ?? null;

  const filteredGoals = useMemo(() => {
    if (!filter && !search) return goals;
    return goals.filter((g) => {
      if (filter && g.status !== filter) return false;
      if (search && !g.title.toLowerCase().includes(search.toLowerCase()) && !g.goal_id.includes(search)) return false;
      return true;
    });
  }, [goals, filter, search]);

  const filteredIds = new Set(filteredGoals.map((g) => g.goal_id));
  const ancestorIds = useMemo(() => {
    const ancestors = new Set<string>();
    for (const g of goals) {
      if (filteredIds.has(g.goal_id)) {
        let cur = g.parent_goal_id;
        while (cur) {
          ancestors.add(cur);
          const parent = goals.find((p) => p.goal_id === cur);
          cur = parent?.parent_goal_id;
        }
      }
    }
    return ancestors;
  }, [goals, filteredIds]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (goal: Goal, depth: number) => {
    const children = tree.get(goal.goal_id) ?? [];
    const isVisible = filteredIds.has(goal.goal_id) || ancestorIds.has(goal.goal_id);
    if (!isVisible) return null;
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(goal.goal_id);
    const isSelected = goal.goal_id === selectedGoalId;

    return (
      <div key={goal.goal_id}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer ${
            isSelected ? "bg-zinc-800" : "hover:bg-zinc-800/50"
          }`}
          style={{ paddingLeft: `${depth * 24 + 8}px` }}
          onClick={() => selectGoal(goal.goal_id)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(goal.goal_id); }}
              className="text-zinc-600 hover:text-zinc-400 w-4 text-center text-xs"
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[goal.status] ?? "bg-zinc-500"}`} />
          <span className={`text-xs truncate flex-1 ${STATUS_TEXT[goal.status] ?? "text-zinc-400"}`}>
            {goal.title}
          </span>
          <span className="text-[10px] text-zinc-600">p{goal.priority}</span>
          {goal.progress != null && (
            <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden shrink-0">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${goal.progress}%` }} />
            </div>
          )}
          <span className="text-[10px] text-zinc-600 w-8 text-right">{goal.progress ?? 0}%</span>
        </div>
        {hasChildren && isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const roots = tree.get(undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/sessions/${sessionId}`} className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Back to Session
        </Link>
        <h2 className="text-lg font-semibold text-zinc-200">Goal Tree</h2>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as GoalStatus | "")}
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search goals..."
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 flex-1 max-w-xs"
        />
        <button
          onClick={() => setExpanded(new Set(goals.filter((g) => g.parent_goal_id).map((g) => g.parent_goal_id!)))}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Expand All
        </button>
        <button onClick={() => setExpanded(new Set())} className="text-xs text-zinc-500 hover:text-zinc-300">
          Collapse All
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 max-h-[400px] overflow-y-auto">
        {roots.length === 0 ? (
          <div className="text-zinc-600 text-xs py-4 text-center">No goals</div>
        ) : (
          roots.map((root) => renderNode(root, 0))
        )}
      </div>

      {selectedGoal && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-zinc-200">{selectedGoal.title}</h3>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_TEXT[selectedGoal.status] ?? "text-zinc-400"} bg-zinc-800`}>
              {selectedGoal.status}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] text-zinc-400 bg-zinc-800">
              {selectedGoal.goal_type}
            </span>
          </div>
          {selectedGoal.description && (
            <p className="text-xs text-zinc-400">{selectedGoal.description}</p>
          )}
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-zinc-500">Priority</span>
              <div className="text-zinc-300">{selectedGoal.priority}</div>
            </div>
            <div>
              <span className="text-zinc-500">Progress</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${selectedGoal.progress ?? 0}%` }} />
                </div>
                <span className="text-zinc-300">{selectedGoal.progress ?? 0}%</span>
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Owner</span>
              <div className="text-zinc-300">{selectedGoal.owner ?? "-"}</div>
            </div>
            <div>
              <span className="text-zinc-500">Created</span>
              <div className="text-zinc-300">{selectedGoal.created_at ? new Date(selectedGoal.created_at).toLocaleString() : "-"}</div>
            </div>
          </div>
          {selectedGoal.dependencies && selectedGoal.dependencies.length > 0 && (
            <div className="text-xs">
              <span className="text-zinc-500">Dependencies: </span>
              {selectedGoal.dependencies.map((dep) => (
                <span key={dep} className="text-blue-400 mr-2 cursor-pointer" onClick={() => selectGoal(dep)}>
                  {dep.slice(0, 8)}
                </span>
              ))}
            </div>
          )}
          {selectedGoal.acceptance_criteria && selectedGoal.acceptance_criteria.length > 0 && (
            <div>
              <span className="text-xs text-zinc-500">Acceptance Criteria:</span>
              <ul className="mt-1 space-y-0.5">
                {selectedGoal.acceptance_criteria.map((ac) => (
                  <li key={ac.id} className="text-xs text-zinc-400 flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded border border-zinc-600" />
                    {ac.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
