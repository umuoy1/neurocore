import type { Goal, TaskMetaSignals } from "@neurocore/protocol";
import {
  average,
  clamp01,
  computePredictorDisagreement,
  countUnresolvedDependencies,
  provenance,
  type MetaSignalInput,
  type MetaSignalProvider
} from "./provider.js";

export class HeuristicTaskSignalProvider implements MetaSignalProvider<TaskMetaSignals> {
  public readonly name = "heuristic-task-provider";
  public readonly family = "task" as const;

  public collect(input: MetaSignalInput) {
    const timestamp = input.ctx.services.now();
    const memoryRecallProposals = Array.isArray(input.ctx.runtime_state.memory_recall_proposals)
      ? input.ctx.runtime_state.memory_recall_proposals.length
      : 0;
    const skillMatchProposals = Array.isArray(input.ctx.runtime_state.skill_match_proposals)
      ? input.ctx.runtime_state.skill_match_proposals.length
      : 0;
    const activeGoals = input.goals.filter((goal) => goal.status === "active" || goal.status === "pending");
    const highRiskActionCount = input.actions.filter((action) => action.side_effect_level === "high").length;
    const familiarity = clamp01((memoryRecallProposals * 0.45 + skillMatchProposals * 0.55) / 5);
    const avgPredictionUncertainty = average(
      input.predictions.map((prediction) => prediction.uncertainty).filter((value): value is number => typeof value === "number")
    );
    const predictorDisagreement = computePredictorDisagreement(input.predictions);
    const novelty = computeTaskNovelty({
      familiarity,
      actions: input.actions,
      activeGoals,
      highRiskActionCount
    });
    const historicalSuccessRate = computeHistoricalSuccessRate(input.predictionErrorRate, familiarity);
    const taskOOD = clamp01(
      novelty * 0.45 +
        avgPredictionUncertainty * 0.2 +
        predictorDisagreement * 0.2 +
        (1 - familiarity) * 0.15
    );
    const goalDepth = computeGoalDepth(activeGoals);
    const dependencyCount = countUnresolvedDependencies(activeGoals);

    return {
      signals: {
        task_novelty: novelty,
        domain_familiarity: familiarity,
        historical_success_rate: historicalSuccessRate,
        ood_score: taskOOD,
        decomposition_depth: goalDepth,
        goal_decomposition_depth: goalDepth,
        unresolved_dependency_count: dependencyCount
      },
      provenance: [
        provenance(
          "task",
          "task_novelty",
          this.name,
          skillMatchProposals + memoryRecallProposals > 0 ? "ok" : "fallback",
          timestamp
        ),
        provenance(
          "task",
          "decomposition_depth",
          this.name,
          activeGoals.length > 0 ? "ok" : "fallback",
          timestamp
        ),
        provenance("task", "ood_score", this.name, "ok", timestamp)
      ]
    };
  }
}

function computeTaskNovelty(input: {
  familiarity: number;
  actions: MetaSignalInput["actions"];
  activeGoals: Goal[];
  highRiskActionCount: number;
}) {
  const newToolMix =
    input.actions.filter((action) => action.action_type === "call_tool").length > 1 ? 0.15 : 0;
  const goalComplexity = input.activeGoals.length > 2 ? 0.1 : 0;
  const highRiskBias = input.highRiskActionCount > 0 ? 0.1 : 0;
  return clamp01(1 - input.familiarity + newToolMix + goalComplexity + highRiskBias);
}

function computeHistoricalSuccessRate(predictionErrorRate: number | undefined, familiarity: number) {
  if (typeof predictionErrorRate === "number") {
    return clamp01(1 - predictionErrorRate);
  }
  return clamp01(0.45 + familiarity * 0.4);
}

function computeGoalDepth(goals: Goal[]) {
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
