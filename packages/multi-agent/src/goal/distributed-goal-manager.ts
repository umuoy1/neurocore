import type { AgentDescriptor, GoalAssignment } from "../types.js";
import type { CoordinationStrategy } from "../coordination/coordination-strategy.js";

export interface DistributedGoalManager {
  decompose(
    parentGoalId: string,
    subGoals: Array<{ title: string; description?: string; priority: number }>,
    strategy: CoordinationStrategy,
    agents: AgentDescriptor[]
  ): Promise<GoalAssignment[]>;
  getAssignment(goalId: string): Promise<GoalAssignment | undefined>;
  listAssignments(parentGoalId: string): Promise<GoalAssignment[]>;
  updateStatus(goalId: string, status: string, progress?: number): Promise<void>;
  reassign(goalId: string, newAgentId: string, newInstanceId: string): Promise<void>;
  aggregateProgress(parentGoalId: string): Promise<{ total: number; completed: number; progress: number }>;
}
