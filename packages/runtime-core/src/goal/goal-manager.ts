import type { Goal, UserInput } from "@neurocore/protocol";
import { generateId } from "../utils/ids.js";

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
      owner: "user"
    };

    this.goalsBySession.set(sessionId, [rootGoal]);
    return rootGoal;
  }

  public list(sessionId: string): Goal[] {
    return this.goalsBySession.get(sessionId) ?? [];
  }

  public hydrate(sessionId: string, goals: Goal[]): void {
    this.goalsBySession.set(sessionId, goals);
  }

  public active(sessionId: string): Goal[] {
    return this.list(sessionId).filter((goal) => goal.status === "active" || goal.status === "pending");
  }

  public add(sessionId: string, goal: Goal): void {
    const current = this.goalsBySession.get(sessionId) ?? [];
    current.push(goal);
    this.goalsBySession.set(sessionId, current);
  }

  public updateStatus(sessionId: string, goalId: string, status: Goal["status"]): Goal {
    const goals = this.list(sessionId);
    const goal = goals.find((item) => item.goal_id === goalId);
    if (!goal) {
      throw new Error(`Unknown goal: ${goalId}`);
    }

    goal.status = status;
    return goal;
  }
}
