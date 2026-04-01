import type {
  AuctionBid,
  CoordinationContext,
  CoordinationResult,
  MarketBasedConfig,
  TaskAssignment
} from "../types.js";
import type { CoordinationStrategy } from "./coordination-strategy.js";
import { CostAwareSelector } from "../delegation/delegation-strategies.js";

const DEFAULT_CONFIG: MarketBasedConfig = {
  auction_timeout_ms: 10_000,
  min_bids: 1,
  scoring_weights: { duration: 0.3, cost: 0.3, confidence: 0.4 },
  reserve_price: undefined
};

export class MarketBasedStrategy implements CoordinationStrategy {
  public readonly name = "market_based";
  private readonly config: MarketBasedConfig;
  private readonly selector = new CostAwareSelector();

  constructor(config?: Partial<MarketBasedConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async coordinate(ctx: CoordinationContext): Promise<CoordinationResult> {
    const agents = ctx.participating_agents;
    if (agents.length === 0) {
      return { strategy_name: this.name, assignments: [], reasoning: "No bidders available" };
    }

    const subGoals = this.decomposeGoal(ctx);
    const assignments: TaskAssignment[] = [];

    for (const subGoal of subGoals) {
      const bids = this.collectBids(agents, subGoal);
      const filteredBids = this.config.reserve_price !== undefined
        ? bids.filter((b) => b.estimated_cost <= this.config.reserve_price!)
        : bids;

      if (filteredBids.length < this.config.min_bids) continue;

      const winner = this.selector.select(filteredBids, this.config.scoring_weights);
      if (winner) {
        assignments.push({
          agent_id: winner.agent_id,
          instance_id: winner.instance_id,
          sub_goal: subGoal,
          estimated_cost: winner.estimated_cost
        });
      }
    }

    return {
      strategy_name: this.name,
      assignments,
      reasoning: `Market-based auction: ${assignments.length}/${subGoals.length} tasks assigned`
    };
  }

  private decomposeGoal(ctx: CoordinationContext): TaskAssignment["sub_goal"][] {
    const count = Math.min(ctx.participating_agents.length, 3);
    const goals: TaskAssignment["sub_goal"][] = [];
    for (let i = 0; i < count; i++) {
      goals.push({
        title: `${ctx.goal.title} - Task ${i + 1}`,
        description: ctx.goal.description,
        priority: ctx.goal.priority
      });
    }
    return goals;
  }

  private collectBids(
    agents: CoordinationContext["participating_agents"],
    _subGoal: TaskAssignment["sub_goal"]
  ): AuctionBid[] {
    return agents.map((agent) => ({
      agent_id: agent.agent_id,
      instance_id: agent.instance_id,
      estimated_duration_ms: 1000 + (agent.current_load * 500),
      estimated_cost: 0.01 + (agent.current_load * 0.005),
      confidence: Math.max(0, ...agent.capabilities.map((c) => c.proficiency))
    }));
  }
}
