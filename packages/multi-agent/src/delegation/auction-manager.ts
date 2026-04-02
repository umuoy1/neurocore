import type { AgentDescriptor, AuctionBid, DelegationRequest, DelegationResponse } from "../types.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";
import { CostAwareSelector } from "./delegation-strategies.js";

export class AuctionManager {
  private readonly selector = new CostAwareSelector();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly bus: InterAgentBus
  ) {}

  async runAuction(request: DelegationRequest): Promise<DelegationResponse> {
    const candidates = await this.registry.discover({
      capabilities: request.target_capabilities,
      domains: request.target_domains,
      status: ["idle", "busy"],
      min_available_capacity: 1
    });

    if (candidates.length === 0) {
      return { delegation_id: request.delegation_id, status: "timeout", error: "No candidates for auction" };
    }

    const bids = await this.collectBids(request, candidates);

    if (bids.length === 0) {
      return { delegation_id: request.delegation_id, status: "timeout", error: "No bids received", bids: [] };
    }

    const weights = { duration: 0.3, cost: 0.3, confidence: 0.4 };
    const winner = this.selector.select(bids, weights);

    if (!winner) {
      return { delegation_id: request.delegation_id, status: "timeout", error: "No valid bids", bids };
    }

    try {
      const response = await this.bus.send({
        message_id: `msg-auction-exec-${request.delegation_id}-${winner.instance_id}`,
        correlation_id: request.delegation_id,
        trace_id: request.delegation_id,
        pattern: "request",
        source_agent_id: request.source_agent_id,
        source_instance_id: request.source_agent_id,
        target_agent_id: winner.instance_id,
        payload: { type: "delegation_request", request },
        created_at: new Date().toISOString(),
        ttl_ms: request.timeout_ms
      });

      const delegated = (response.payload as { response?: DelegationResponse }).response;
      if (delegated) {
        return {
          ...delegated,
          bids,
          selected_bid: winner
        };
      }

      return {
        delegation_id: request.delegation_id,
        status: "completed",
        assigned_agent_id: winner.agent_id,
        assigned_instance_id: winner.instance_id,
        bids,
        selected_bid: winner,
        result: response.payload.result as DelegationResponse["result"]
      };
    } catch {
      return {
        delegation_id: request.delegation_id,
        status: "timeout",
        error: "Winning agent did not complete the delegated task in time",
        bids,
        selected_bid: winner
      };
    }
  }

  private async collectBids(
    request: DelegationRequest,
    candidates: AgentDescriptor[]
  ): Promise<AuctionBid[]> {
    const timeoutMs = request.timeout_ms || 10_000;
    const bids: AuctionBid[] = [];

    const bidPromises = candidates.map(async (agent) => {
      try {
        const response = await this.bus.send({
          message_id: `msg-auction-${request.delegation_id}-${agent.instance_id}`,
          correlation_id: `auction-${request.delegation_id}-${agent.instance_id}`,
          trace_id: request.delegation_id,
          pattern: "request",
          source_agent_id: request.source_agent_id,
          source_instance_id: request.source_agent_id,
          target_agent_id: agent.instance_id,
          payload: { type: "auction_request", request },
          created_at: new Date().toISOString(),
          ttl_ms: timeoutMs
        });
        const bid = response.payload.bid as AuctionBid | undefined;
        if (bid) bids.push(bid);
      } catch {}
    });

    await Promise.allSettled(bidPromises);
    return bids;
  }
}
