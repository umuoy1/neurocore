import type { Goal, PolicyDecision, SuggestedGoal } from "@neurocore/protocol";

export interface GoalFilterDecision {
  accepted: SuggestedGoal[];
  rejected: Array<{ goal: SuggestedGoal; reason: string }>;
}

export class DefaultGoalFilter {
  public evaluate(input: {
    candidates: SuggestedGoal[];
    activeGoals: Goal[];
    feasibilityThreshold: number;
    policyDecisionsByGoalId: Map<string, PolicyDecision[]>;
  }): GoalFilterDecision {
    const accepted: SuggestedGoal[] = [];
    const rejected: Array<{ goal: SuggestedGoal; reason: string }> = [];

    for (const candidate of input.candidates) {
      const policyDecisions = input.policyDecisionsByGoalId.get(candidate.suggested_goal_id) ?? [];
      if (policyDecisions.some((decision) => decision.level === "block")) {
        rejected.push({
          goal: candidate,
          reason: "Blocked by policy."
        });
        continue;
      }

      const hasSimilarGoal = input.activeGoals.some(
        (goal) => goal.title === candidate.title && goal.status !== "completed" && goal.status !== "failed"
      );
      if (hasSimilarGoal) {
        rejected.push({
          goal: candidate,
          reason: "A similar active goal already exists."
        });
        continue;
      }

      if (candidate.priority / 100 < input.feasibilityThreshold) {
        rejected.push({
          goal: candidate,
          reason: "Feasibility estimate below threshold."
        });
        continue;
      }

      accepted.push(candidate);
    }

    return { accepted, rejected };
  }
}
