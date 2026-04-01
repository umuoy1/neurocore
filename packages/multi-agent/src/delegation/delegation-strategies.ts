import type { AgentDescriptor, AuctionBid } from "../types.js";

export class CapabilityBasedMatcher {
  match(targetCapabilities: string[], candidates: AgentDescriptor[]): AgentDescriptor[] {
    if (!targetCapabilities || targetCapabilities.length === 0) return [...candidates];
    return candidates
      .filter((agent) =>
        targetCapabilities.every((cap) =>
          agent.capabilities.some((ac) => ac.name === cap)
        )
      )
      .sort((a, b) => {
        const aMax = Math.max(...a.capabilities.map((c) => c.proficiency));
        const bMax = Math.max(...b.capabilities.map((c) => c.proficiency));
        return bMax - aMax;
      });
  }
}

export class LoadBalancedAssigner {
  assign(candidates: AgentDescriptor[]): AgentDescriptor | undefined {
    return candidates
      .filter((a) => a.max_capacity - a.current_load > 0)
      .sort((a, b) =>
        (b.max_capacity - b.current_load) - (a.max_capacity - a.current_load)
      )[0];
  }
}

export class CostAwareSelector {
  select(
    bids: AuctionBid[],
    weights: { duration: number; cost: number; confidence: number }
  ): AuctionBid | undefined {
    if (bids.length === 0) return undefined;
    const scored = bids.map((bid) => {
      const durationScore = bid.estimated_duration_ms > 0 ? weights.duration / bid.estimated_duration_ms : 0;
      const costScore = bid.estimated_cost > 0 ? weights.cost / bid.estimated_cost : 0;
      const confidenceScore = weights.confidence * bid.confidence;
      return { bid, score: durationScore + costScore + confidenceScore };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.bid;
  }
}
