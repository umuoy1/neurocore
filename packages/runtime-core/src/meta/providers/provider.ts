import type {
  ActionMetaSignals,
  CandidateAction,
  EvidenceMetaSignals,
  Goal,
  GovernanceMetaSignals,
  MetaSignalProvenance,
  ModuleContext,
  PolicyDecision,
  Prediction,
  PredictionMetaSignals,
  ReasoningMetaSignals,
  TaskMetaSignals,
  WorkspaceSnapshot
} from "@neurocore/protocol";

export type MetaSignalFamily =
  | "task"
  | "evidence"
  | "reasoning"
  | "prediction"
  | "action"
  | "governance";

export interface MetaSignalInput {
  ctx: ModuleContext;
  workspace: WorkspaceSnapshot;
  actions: CandidateAction[];
  predictions: Prediction[];
  policies: PolicyDecision[];
  predictionErrorRate?: number;
  goals: Goal[];
}

export interface MetaSignalProviderResult<TSignals> {
  signals: TSignals;
  provenance?: MetaSignalProvenance[];
}

export interface MetaSignalProvider<TSignals> {
  name: string;
  family: MetaSignalFamily;
  collect(input: MetaSignalInput): MetaSignalProviderResult<TSignals>;
}

export type AnyMetaSignalProvider =
  | MetaSignalProvider<TaskMetaSignals>
  | MetaSignalProvider<EvidenceMetaSignals>
  | MetaSignalProvider<ReasoningMetaSignals>
  | MetaSignalProvider<PredictionMetaSignals>
  | MetaSignalProvider<ActionMetaSignals>
  | MetaSignalProvider<GovernanceMetaSignals>;

export function provenance(
  family: MetaSignalFamily,
  field: string,
  provider: string,
  status: MetaSignalProvenance["status"],
  timestamp: string,
  note?: string
): MetaSignalProvenance {
  return {
    family,
    field,
    provider,
    status,
    timestamp,
    note
  };
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0.5;
  }
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function weightedAverage(entries: Array<[number, number]>) {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) {
    return 0.5;
  }
  const total = entries.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return clamp01(total / totalWeight);
}

export function ratio(used?: number, total?: number) {
  if (!isNumber(used) || !isNumber(total) || total <= 0) {
    return undefined;
  }
  return clamp01(used / total);
}

export function isTimeSensitiveInput(content: unknown) {
  if (typeof content !== "string") {
    return false;
  }
  const text = content.toLowerCase();
  return /latest|current|today|now|price|schedule|news|recent|实时|最新|今天|当前/.test(text);
}

export function countUnresolvedDependencies(goals: Goal[]) {
  const dependencies = new Set<string>();
  for (const goal of goals) {
    for (const dependency of goal.dependencies ?? []) {
      dependencies.add(dependency);
    }
  }
  return dependencies.size;
}

export function computeGoalDepth(goals: Goal[]) {
  if (goals.length === 0) {
    return 0;
  }
  const byId = new Map(goals.map((goal) => [goal.goal_id, goal]));
  return clamp01(Math.max(...goals.map((goal) => depthForGoal(goal, byId))) / 4);
}

function depthForGoal(goal: Goal, byId: Map<string, Goal>) {
  let depth = 0;
  let current = goal.parent_goal_id ? byId.get(goal.parent_goal_id) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.goal_id)) {
    seen.add(current.goal_id);
    depth += 1;
    current = current.parent_goal_id ? byId.get(current.parent_goal_id) : undefined;
  }
  return depth;
}

export function countAssumptions(actions: CandidateAction[]) {
  return actions.reduce((count, action) => {
    if (Array.isArray(action.preconditions) && action.preconditions.length > 0) {
      return count + action.preconditions.length;
    }
    return count;
  }, 0);
}

export function computePredictorDisagreement(predictions: Prediction[]) {
  if (predictions.length <= 1) {
    return 0;
  }
  const successValues = predictions.map((prediction) => prediction.success_probability).filter(isNumber);
  if (successValues.length <= 1) {
    return 0;
  }
  const max = Math.max(...successValues);
  const min = Math.min(...successValues);
  return clamp01(max - min);
}

export function computeActionDivergence(actions: CandidateAction[]) {
  if (actions.length <= 1) {
    return 0;
  }
  const categories = new Set(actions.map((action) => `${action.action_type}:${action.tool_name ?? "none"}`));
  return clamp01((categories.size - 1) / Math.max(actions.length - 1, 1));
}
