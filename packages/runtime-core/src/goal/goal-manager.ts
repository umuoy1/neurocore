import type { Goal, UserInput } from "@neurocore/protocol";
import { generateId } from "../utils/ids.js";

const ACTIVE_GOAL_STATUSES = new Set<Goal["status"]>(["pending", "active"]);
const TERMINAL_GOAL_STATUSES = new Set<Goal["status"]>(["completed", "failed", "cancelled"]);
const GOAL_DECOMPOSITION_STATUS_KEY = "decomposition_status";

export class GoalManager {
  private readonly goalsBySession = new Map<string, Goal[]>();

  public initializeRootGoal(sessionId: string, input: UserInput): Goal {
    const rootGoal: Goal = {
      goal_id: generateId("gol"),
      schema_version: "0.1.0",
      session_id: sessionId,
      title: input.content.slice(0, 80),
      description: input.content,
      goal_type: "task",
      status: "active",
      priority: 100,
      owner: "user",
      metadata: {
        [GOAL_DECOMPOSITION_STATUS_KEY]: "pending",
        root_goal: true
      }
    };

    this.goalsBySession.set(sessionId, [rootGoal]);
    return rootGoal;
  }

  public list(sessionId: string): Goal[] {
    return this.goalsBySession.get(sessionId) ?? [];
  }

  public hydrate(sessionId: string, goals: Goal[]): void {
    this.goalsBySession.set(
      sessionId,
      goals.map((goal) => this.normalize(goal))
    );
    this.refreshDerivedStatuses(sessionId);
  }

  public active(sessionId: string): Goal[] {
    const goals = this.list(sessionId);
    return goals.filter((goal) => this.isActionable(goal, goals));
  }

  public add(sessionId: string, goal: Goal): void {
    const current = this.goalsBySession.get(sessionId) ?? [];
    current.push(this.normalize(goal));
    this.goalsBySession.set(sessionId, current);
    this.refreshDerivedStatuses(sessionId);
  }

  public addMany(sessionId: string, goals: Goal[]): Goal[] {
    const current = this.goalsBySession.get(sessionId) ?? [];
    const existingIds = new Set(current.map((goal) => goal.goal_id));
    const normalized = goals
      .map((goal) => this.normalize(goal))
      .filter((goal) => !existingIds.has(goal.goal_id));
    this.goalsBySession.set(sessionId, [...current, ...normalized]);
    this.refreshDerivedStatuses(sessionId);
    return normalized;
  }

  public get(sessionId: string, goalId: string): Goal | undefined {
    return this.list(sessionId).find((goal) => goal.goal_id === goalId);
  }

  public children(sessionId: string, parentGoalId: string): Goal[] {
    return this.list(sessionId).filter((goal) => goal.parent_goal_id === parentGoalId);
  }

  public decomposable(sessionId: string): Goal[] {
    const goals = this.list(sessionId);
    return goals.filter((goal) => {
      if (!ACTIVE_GOAL_STATUSES.has(goal.status)) {
        return false;
      }
      if (this.children(sessionId, goal.goal_id).length > 0) {
        return false;
      }
      return this.decompositionStatus(goal) === "pending";
    });
  }

  public markDecompositionState(
    sessionId: string,
    goalId: string,
    state: "pending" | "completed" | "skipped"
  ): Goal {
    const goal = this.require(sessionId, goalId);
    const metadata = (goal.metadata ??= {});
    metadata[GOAL_DECOMPOSITION_STATUS_KEY] = state;
    this.refreshDerivedStatuses(sessionId);
    return goal;
  }

  public markActionable(sessionId: string, status: Goal["status"]): Goal[] {
    const goals = this.list(sessionId);
    const updated: Goal[] = [];
    for (const goal of goals) {
      if (!this.isActionable(goal, goals)) {
        continue;
      }
      if (TERMINAL_GOAL_STATUSES.has(goal.status)) {
        continue;
      }
      goal.status = status;
      updated.push(goal);
    }
    this.refreshDerivedStatuses(sessionId);
    return updated;
  }

  public updateStatus(sessionId: string, goalId: string, status: Goal["status"]): Goal {
    const goal = this.require(sessionId, goalId);
    goal.status = status;
    this.refreshDerivedStatuses(sessionId);
    return goal;
  }

  private require(sessionId: string, goalId: string): Goal {
    const goal = this.get(sessionId, goalId);
    if (!goal) {
      throw new Error(`Unknown goal: ${goalId}`);
    }
    return goal;
  }

  private normalize(goal: Goal): Goal {
    const metadata = { ...(goal.metadata ?? {}) };
    if (typeof metadata[GOAL_DECOMPOSITION_STATUS_KEY] !== "string") {
      metadata[GOAL_DECOMPOSITION_STATUS_KEY] = "pending";
    }
    return {
      ...goal,
      metadata
    };
  }

  private isActionable(goal: Goal, goals: Goal[]): boolean {
    if (!ACTIVE_GOAL_STATUSES.has(goal.status)) {
      return false;
    }
    return !goals.some(
      (candidate) =>
        candidate.parent_goal_id === goal.goal_id && !TERMINAL_GOAL_STATUSES.has(candidate.status)
    );
  }

  private decompositionStatus(goal: Goal): string {
    return goal.metadata && typeof goal.metadata[GOAL_DECOMPOSITION_STATUS_KEY] === "string"
      ? goal.metadata[GOAL_DECOMPOSITION_STATUS_KEY]
      : "pending";
  }

  private refreshDerivedStatuses(sessionId: string): void {
    const goals = this.list(sessionId);
    const goalsById = new Map(goals.map((goal) => [goal.goal_id, goal]));

    for (const goal of [...goals].reverse()) {
      const children = goals.filter((candidate) => candidate.parent_goal_id === goal.goal_id);
      if (children.length === 0 || TERMINAL_GOAL_STATUSES.has(goal.status)) {
        continue;
      }

      if (children.every((child) => child.status === "completed")) {
        goal.status = "completed";
        continue;
      }

      if (children.some((child) => child.status === "failed")) {
        goal.status = "failed";
        continue;
      }

      if (children.some((child) => child.status === "waiting_input")) {
        goal.status = "waiting_input";
        continue;
      }

      if (
        children.some((child) =>
          child.status === "active" || child.status === "pending" || child.status === "blocked"
        )
      ) {
        goal.status = "blocked";
        continue;
      }

      if (children.every((child) => child.status === "cancelled")) {
        goal.status = "cancelled";
        continue;
      }

      if (goalsById.has(goal.goal_id) && ACTIVE_GOAL_STATUSES.has(goal.status)) {
        goal.status = "active";
      }
    }
  }
}
