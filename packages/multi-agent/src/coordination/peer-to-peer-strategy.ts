import type {
  CoordinationContext,
  CoordinationResult,
  PeerToPeerConfig,
  TaskAssignment
} from "../types.js";
import type { CoordinationStrategy } from "./coordination-strategy.js";

const DEFAULT_CONFIG: PeerToPeerConfig = {
  consensus_mode: "simple_majority",
  voting_timeout_ms: 10_000,
  max_voting_rounds: 3
};

export class PeerToPeerStrategy implements CoordinationStrategy {
  public readonly name = "peer_to_peer";
  private readonly config: PeerToPeerConfig;

  constructor(config?: Partial<PeerToPeerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async coordinate(ctx: CoordinationContext): Promise<CoordinationResult> {
    const agents = ctx.participating_agents;
    if (agents.length === 0) {
      return { strategy_name: this.name, assignments: [], reasoning: "No participants" };
    }

    const proposal = this.generateProposal(ctx);
    let consensus = false;
    let round = 0;

    while (!consensus && round < this.config.max_voting_rounds) {
      round++;
      const votes = this.simulateVoting(agents, proposal);
      consensus = this.checkConsensus(votes, agents);
    }

    if (!consensus) {
      return {
        strategy_name: this.name,
        assignments: proposal,
        coordination_metadata: { consensus_reached: false, rounds: round },
        reasoning: `Failed to reach ${this.config.consensus_mode} consensus after ${round} rounds; using fallback`
      };
    }

    return {
      strategy_name: this.name,
      assignments: proposal,
      coordination_metadata: { consensus_reached: true, rounds: round },
      reasoning: `Reached ${this.config.consensus_mode} consensus in ${round} round(s)`
    };
  }

  private generateProposal(ctx: CoordinationContext): TaskAssignment[] {
    return ctx.participating_agents.map((agent, i) => ({
      agent_id: agent.agent_id,
      instance_id: agent.instance_id,
      sub_goal: {
        title: `${ctx.goal.title} - Peer Task ${i + 1}`,
        description: ctx.goal.description,
        priority: ctx.goal.priority
      }
    }));
  }

  private simulateVoting(
    agents: CoordinationContext["participating_agents"],
    _proposal: TaskAssignment[]
  ): Map<string, boolean> {
    const votes = new Map<string, boolean>();
    for (const agent of agents) {
      votes.set(agent.instance_id, true);
    }
    return votes;
  }

  private checkConsensus(
    votes: Map<string, boolean>,
    agents: CoordinationContext["participating_agents"]
  ): boolean {
    const approvals = [...votes.values()].filter(Boolean).length;
    const total = agents.length;

    switch (this.config.consensus_mode) {
      case "unanimous":
        return approvals === total;
      case "weighted_majority": {
        let totalWeight = 0;
        let approvalWeight = 0;
        for (const agent of agents) {
          const weight = this.config.agent_weights?.[agent.instance_id] ?? 1;
          totalWeight += weight;
          if (votes.get(agent.instance_id)) {
            approvalWeight += weight;
          }
        }
        return approvalWeight > totalWeight / 2;
      }
      case "simple_majority":
      default:
        return approvals > total / 2;
    }
  }
}
