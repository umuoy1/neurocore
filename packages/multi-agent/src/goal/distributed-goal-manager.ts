import type { AgentDescriptor, GoalAssignment, GoalConflictRecord } from "../types.js";
import type { CoordinationStrategy } from "../coordination/coordination-strategy.js";

export interface GoalMutationContext {
  agent_id: string;
  instance_id?: string;
}

export interface DistributedGoalManager {
  decompose(
    parentGoalId: string,
    subGoals: Array<{ title: string; description?: string; priority: number }>,
    strategy: CoordinationStrategy,
    agents: AgentDescriptor[]
  ): Promise<GoalAssignment[]>;
  getAssignment(goalId: string): Promise<GoalAssignment | undefined>;
  listAssignments(parentGoalId: string): Promise<GoalAssignment[]>;
  updateStatus(goalId: string, status: string, progress?: number, context?: GoalMutationContext): Promise<void>;
  reassign(goalId: string, newAgentId: string, newInstanceId: string, context?: GoalMutationContext): Promise<void>;
  aggregateProgress(parentGoalId: string): Promise<{ total: number; completed: number; progress: number }>;
  getConflicts(goalId?: string): Promise<GoalConflictRecord[]>;
}
