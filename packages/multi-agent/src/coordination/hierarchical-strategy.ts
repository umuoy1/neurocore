import type {
  CoordinationContext,
  CoordinationResult,
  HierarchicalConfig,
  TaskAssignment
} from "../types.js";
import type { CoordinationStrategy } from "./coordination-strategy.js";

const DEFAULT_CONFIG: HierarchicalConfig = {
  max_tree_depth: 3,
  worker_selection: "best_fit",
  result_aggregation: "all_success"
};

export class HierarchicalStrategy implements CoordinationStrategy {
  public readonly name = "hierarchical";
  private readonly config: HierarchicalConfig;

  constructor(config?: Partial<HierarchicalConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async coordinate(ctx: CoordinationContext): Promise<CoordinationResult> {
    const agents = ctx.participating_agents;
    if (agents.length === 0) {
      return { strategy_name: this.name, assignments: [], reasoning: "No available workers" };
    }

    const subGoals = this.decomposeGoal(ctx);
    const assignments: TaskAssignment[] = [];
    let roundRobinIndex = 0;

    for (const subGoal of subGoals) {
      const selected = this.selectWorker(agents, subGoal, roundRobinIndex);
      if (selected) {
        assignments.push({
          agent_id: selected.agent_id,
          instance_id: selected.instance_id,
          sub_goal: subGoal,
        });
        roundRobinIndex++;
      }
    }

    return {
      strategy_name: this.name,
      assignments,
      reasoning: `Hierarchical decomposition: ${subGoals.length} sub-goals assigned to ${assignments.length} workers using ${this.config.worker_selection}`
    };
  }

  async resolveConflict(
    _ctx: CoordinationContext,
    conflictingAssignments: TaskAssignment[]
  ): Promise<TaskAssignment[]> {
    return conflictingAssignments.sort((a, b) => b.sub_goal.priority - a.sub_goal.priority).slice(0, 1);
  }

  private decomposeGoal(ctx: CoordinationContext): TaskAssignment["sub_goal"][] {
    const agentCount = ctx.participating_agents.length;
    const goals: TaskAssignment["sub_goal"][] = [];
    for (let i = 0; i < Math.min(agentCount, 3); i++) {
      goals.push({
        title: `${ctx.goal.title} - Part ${i + 1}`,
        description: ctx.goal.description,
        priority: ctx.goal.priority
      });
    }
    return goals;
  }

  private selectWorker(
    agents: CoordinationContext["participating_agents"],
    _subGoal: TaskAssignment["sub_goal"],
    roundRobinIndex: number
  ) {
    switch (this.config.worker_selection) {
      case "round_robin":
        return agents[roundRobinIndex % agents.length];
      case "least_loaded":
        return [...agents].sort((a, b) =>
          a.current_load - b.current_load
        )[0];
      case "best_fit":
      default:
        return [...agents].sort((a, b) => {
          const aMax = Math.max(0, ...a.capabilities.map((c) => c.proficiency));
          const bMax = Math.max(0, ...b.capabilities.map((c) => c.proficiency));
          return bMax - aMax;
        })[0];
    }
  }
}
