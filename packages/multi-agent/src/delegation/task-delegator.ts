import type { AgentDescriptor, DelegationRequest, DelegationResponse } from "../types.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";

export interface TaskDelegator {
  delegate(request: DelegationRequest): Promise<DelegationResponse>;
  cancel(delegationId: string): Promise<void>;
}

export class DefaultTaskDelegator implements TaskDelegator {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly bus: InterAgentBus
  ) {}

  async delegate(request: DelegationRequest): Promise<DelegationResponse> {
    if (request.current_depth >= request.max_depth) {
      return {
        delegation_id: request.delegation_id,
        status: "rejected",
        error: `Max delegation depth (${request.max_depth}) exceeded`
      };
    }

    switch (request.mode) {
      case "unicast":
        return this.delegateUnicast(request);
      case "broadcast":
        return this.delegateBroadcast(request);
      case "auction":
        return this.delegateAuction(request);
      default:
        return {
          delegation_id: request.delegation_id,
          status: "failed",
          error: `Unknown delegation mode: ${request.mode}`
        };
    }
  }

  async cancel(_delegationId: string): Promise<void> {}

  private async delegateUnicast(request: DelegationRequest): Promise<DelegationResponse> {
    if (!request.target_agent_id) {
      return { delegation_id: request.delegation_id, status: "rejected", error: "No target_agent_id for unicast" };
    }
    const agent = await this.resolveTarget(request.target_agent_id);
    if (!agent || (agent.status !== "idle" && agent.status !== "busy")) {
      return { delegation_id: request.delegation_id, status: "rejected", error: "Target agent unavailable" };
    }
    try {
      const response = await this.bus.send({
        message_id: `msg-${request.delegation_id}`,
        correlation_id: request.delegation_id,
        trace_id: request.delegation_id,
        pattern: "request",
        source_agent_id: request.source_agent_id,
        source_instance_id: request.source_agent_id,
        target_agent_id: agent.instance_id,
        payload: { type: "delegation_request", request },
        created_at: new Date().toISOString(),
        ttl_ms: request.timeout_ms
      });
      return (response.payload as { response: DelegationResponse }).response ?? {
        delegation_id: request.delegation_id,
        status: "completed",
        assigned_agent_id: agent.agent_id,
        assigned_instance_id: agent.instance_id,
        result: response.payload.result as DelegationResponse["result"]
      };
    } catch {
      return { delegation_id: request.delegation_id, status: "timeout", error: "Request timed out" };
    }
  }

  private async delegateBroadcast(request: DelegationRequest): Promise<DelegationResponse> {
    const candidates = await this.registry.discover({
      capabilities: request.target_capabilities,
      domains: request.target_domains,
      status: ["idle", "busy"],
      min_available_capacity: 1
    });
    if (candidates.length === 0) {
      return { delegation_id: request.delegation_id, status: "rejected", error: "No candidates found" };
    }
    const acceptPromises = candidates.map((agent) =>
      this.bus.send({
        message_id: `msg-bcast-${request.delegation_id}-${agent.instance_id}`,
        correlation_id: `${request.delegation_id}-${agent.instance_id}`,
        trace_id: request.delegation_id,
        pattern: "request",
        source_agent_id: request.source_agent_id,
        source_instance_id: request.source_agent_id,
        target_agent_id: agent.instance_id,
        payload: { type: "delegation_request", request },
        created_at: new Date().toISOString(),
        ttl_ms: request.timeout_ms
      }).then((r) => ({ agent, response: r }))
        .catch(() => null)
    );
    const first = await Promise.race(acceptPromises.map((p) =>
      p.then((r) => r ? r : Promise.reject(new Error("null")))
    )).catch(() => null);
    if (!first) {
      return { delegation_id: request.delegation_id, status: "timeout", error: "No agent accepted" };
    }
    const delegated = (first.response.payload as { response?: DelegationResponse }).response;
    if (delegated) {
      return delegated;
    }
    return {
      delegation_id: request.delegation_id,
      status: "completed",
      assigned_agent_id: first.agent.agent_id,
      assigned_instance_id: first.agent.instance_id,
      result: first.response.payload.result as DelegationResponse["result"]
    };
  }

  private async delegateAuction(request: DelegationRequest): Promise<DelegationResponse> {
    const { AuctionManager } = await import("./auction-manager.js");
    const auctionManager = new AuctionManager(this.registry, this.bus);
    return auctionManager.runAuction(request);
  }

  private async resolveTarget(target: string): Promise<AgentDescriptor | undefined> {
    const direct = await this.registry.get(target);
    if (direct) {
      return direct;
    }

    const all = await this.registry.listAll();
    return all.find((agent) => agent.agent_id === target);
  }
}
