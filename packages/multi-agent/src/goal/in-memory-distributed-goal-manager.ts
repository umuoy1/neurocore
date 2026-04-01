import type { AgentDescriptor, GoalAssignment } from "../types.js";
import type { CoordinationStrategy } from "../coordination/coordination-strategy.js";
import type { DistributedGoalManager } from "./distributed-goal-manager.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";

export class InMemoryDistributedGoalManager implements DistributedGoalManager {
  private readonly assignments = new Map<string, GoalAssignment>();
  private readonly parentIndex = new Map<string, Set<string>>();
  private propagationStrategy: "all_success" | "majority" | "any_success" = "all_success";

  constructor(private readonly bus?: InterAgentBus) {}

  setPropagationStrategy(strategy: "all_success" | "majority" | "any_success"): void {
    this.propagationStrategy = strategy;
  }

  async decompose(
    parentGoalId: string,
    subGoals: Array<{ title: string; description?: string; priority: number }>,
    strategy: CoordinationStrategy,
    agents: AgentDescriptor[]
  ): Promise<GoalAssignment[]> {
    const ctx = {
      initiator_agent_id: "supervisor",
      participating_agents: agents,
      goal: {
        goal_id: parentGoalId,
        title: subGoals[0]?.title ?? "Task",
        priority: subGoals[0]?.priority ?? 1
      }
    };

    const result = await strategy.coordinate(ctx);
    const now = new Date().toISOString();
    const goalAssignments: GoalAssignment[] = [];
    const childIds = new Set<string>();

    for (let i = 0; i < subGoals.length; i++) {
      const assignment = result.assignments[i];
      if (!assignment) continue;

      const goalId = `${parentGoalId}-sub-${i}`;
      const ga: GoalAssignment = {
        goal_id: goalId,
        agent_id: assignment.agent_id,
        instance_id: assignment.instance_id,
        session_id: "",
        status: "pending",
        progress: 0,
        updated_at: now
      };
      this.assignments.set(goalId, ga);
      childIds.add(goalId);
      goalAssignments.push(ga);
    }

    this.parentIndex.set(parentGoalId, childIds);

    if (this.bus) {
      await this.bus.publish("goal.progress", {
        message_id: `goal-decompose-${parentGoalId}`,
        correlation_id: parentGoalId,
        trace_id: parentGoalId,
        pattern: "event",
        source_agent_id: "supervisor",
        source_instance_id: "supervisor",
        payload: {
          type: "goal_decomposed",
          parent_goal_id: parentGoalId,
          child_count: goalAssignments.length
        },
        created_at: now
      });
    }

    return goalAssignments;
  }

  async getAssignment(goalId: string): Promise<GoalAssignment | undefined> {
    return this.assignments.get(goalId);
  }

  async listAssignments(parentGoalId: string): Promise<GoalAssignment[]> {
    const childIds = this.parentIndex.get(parentGoalId);
    if (!childIds) return [];
    return [...childIds].map((id) => this.assignments.get(id)!).filter(Boolean);
  }

  async updateStatus(goalId: string, status: string, progress?: number): Promise<void> {
    const assignment = this.assignments.get(goalId);
    if (!assignment) return;
    assignment.status = status;
    if (progress !== undefined) assignment.progress = progress;
    assignment.updated_at = new Date().toISOString();

    if (status === "completed" || status === "failed") {
      for (const [parentId, childIds] of this.parentIndex) {
        if (childIds.has(goalId)) {
          await this.propagateStatus(parentId);
          break;
        }
      }
    }

    if (this.bus) {
      await this.bus.publish("goal.progress", {
        message_id: `goal-status-${goalId}-${Date.now()}`,
        correlation_id: goalId,
        trace_id: goalId,
        pattern: "event",
        source_agent_id: assignment.agent_id,
        source_instance_id: assignment.instance_id,
        payload: { type: "goal_status_updated", goal_id: goalId, status, progress },
        created_at: new Date().toISOString()
      });
    }
  }

  async reassign(goalId: string, newAgentId: string, newInstanceId: string): Promise<void> {
    const assignment = this.assignments.get(goalId);
    if (!assignment) return;
    assignment.agent_id = newAgentId;
    assignment.instance_id = newInstanceId;
    assignment.updated_at = new Date().toISOString();

    if (this.bus) {
      await this.bus.publish("goal.progress", {
        message_id: `goal-reassign-${goalId}-${Date.now()}`,
        correlation_id: goalId,
        trace_id: goalId,
        pattern: "event",
        source_agent_id: newAgentId,
        source_instance_id: newInstanceId,
        payload: { type: "goal_reassigned", goal_id: goalId, new_agent_id: newAgentId },
        created_at: new Date().toISOString()
      });
    }
  }

  async aggregateProgress(parentGoalId: string): Promise<{ total: number; completed: number; progress: number }> {
    const childIds = this.parentIndex.get(parentGoalId);
    if (!childIds || childIds.size === 0) return { total: 0, completed: 0, progress: 0 };
    const children = [...childIds].map((id) => this.assignments.get(id)!).filter(Boolean);
    const completed = children.filter((c) => c.status === "completed").length;
    return {
      total: children.length,
      completed,
      progress: children.length > 0 ? completed / children.length : 0
    };
  }

  private async propagateStatus(parentGoalId: string): Promise<void> {
    const childIds = this.parentIndex.get(parentGoalId);
    if (!childIds) return;
    const children = [...childIds].map((id) => this.assignments.get(id)!).filter(Boolean);

    const completed = children.filter((c) => c.status === "completed").length;
    const failed = children.filter((c) => c.status === "failed").length;
    const total = children.length;

    const parentAssignment = this.assignments.get(parentGoalId);

    switch (this.propagationStrategy) {
      case "all_success":
        if (completed === total && parentAssignment) {
          parentAssignment.status = "completed";
          parentAssignment.progress = 1;
          parentAssignment.updated_at = new Date().toISOString();
        } else if (failed > 0 && parentAssignment) {
          parentAssignment.status = "failed";
          parentAssignment.updated_at = new Date().toISOString();
        }
        break;
      case "majority":
        if (completed > total / 2 && parentAssignment) {
          parentAssignment.status = "completed";
          parentAssignment.progress = completed / total;
          parentAssignment.updated_at = new Date().toISOString();
        }
        break;
      case "any_success":
        if (completed >= 1 && parentAssignment) {
          parentAssignment.status = "completed";
          parentAssignment.progress = completed / total;
          parentAssignment.updated_at = new Date().toISOString();
        }
        break;
    }
  }
}
