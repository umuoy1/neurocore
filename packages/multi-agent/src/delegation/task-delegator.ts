import type {
  AgentDescriptor,
  DelegationRequest,
  DelegationResponse,
  DelegationStatusRecord
} from "../types.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";

export interface TaskDelegator {
  delegate(request: DelegationRequest): Promise<DelegationResponse>;
  cancel(delegationId: string): Promise<void>;
  getStatus(delegationId: string): Promise<DelegationStatusRecord | undefined>;
  listStatuses(): Promise<DelegationStatusRecord[]>;
}

export class DefaultTaskDelegator implements TaskDelegator {
  private readonly statuses = new Map<string, DelegationStatusRecord>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly bus: InterAgentBus
  ) {}

  async delegate(request: DelegationRequest): Promise<DelegationResponse> {
    this.updateStatus(request, "pending");
    if (request.current_depth >= request.max_depth) {
      return this.finalize(
        request,
        {
        delegation_id: request.delegation_id,
        status: "rejected",
        error: `Max delegation depth (${request.max_depth}) exceeded`
        }
      );
    }

    switch (request.mode) {
      case "unicast":
        return this.delegateUnicast(request);
      case "broadcast":
        return this.delegateBroadcast(request);
      case "auction":
        return this.delegateAuction(request);
      default:
        return this.finalize(
          request,
          {
          delegation_id: request.delegation_id,
          status: "failed",
          error: `Unknown delegation mode: ${request.mode}`
          }
        );
    }
  }

  async cancel(delegationId: string): Promise<void> {
    const record = this.statuses.get(delegationId);
    if (!record || ["completed", "failed", "rejected", "timeout", "cancelled"].includes(record.status)) {
      return;
    }
    record.status = "cancelled";
    record.updated_at = new Date().toISOString();
    record.completed_at = record.updated_at;
    this.statuses.set(delegationId, record);
  }

  async getStatus(delegationId: string): Promise<DelegationStatusRecord | undefined> {
    const record = this.statuses.get(delegationId);
    return record ? { ...record } : undefined;
  }

  async listStatuses(): Promise<DelegationStatusRecord[]> {
    return [...this.statuses.values()].map((record) => ({ ...record }));
  }

  private async delegateUnicast(request: DelegationRequest): Promise<DelegationResponse> {
    if (!request.target_agent_id) {
      return this.finalize(request, {
        delegation_id: request.delegation_id,
        status: "rejected",
        error: "No target_agent_id for unicast"
      });
    }
    const agent = await this.resolveTarget(request.target_agent_id);
    if (!agent || (agent.status !== "idle" && agent.status !== "busy")) {
      return this.finalize(request, {
        delegation_id: request.delegation_id,
        status: "rejected",
        error: "Target agent unavailable"
      });
    }
    this.updateStatus(request, "running", agent);
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
      return this.finalize(
        request,
        (response.payload as { response: DelegationResponse }).response ?? {
        delegation_id: request.delegation_id,
        status: "completed",
        assigned_agent_id: agent.agent_id,
        assigned_instance_id: agent.instance_id,
        result: response.payload.result as DelegationResponse["result"]
        },
        agent
      );
    } catch {
      return this.finalize(
        request,
        { delegation_id: request.delegation_id, status: "timeout", error: "Request timed out" },
        agent
      );
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
      return this.finalize(request, {
        delegation_id: request.delegation_id,
        status: "rejected",
        error: "No candidates found"
      });
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
      return this.finalize(request, {
        delegation_id: request.delegation_id,
        status: "timeout",
        error: "No agent accepted"
      });
    }
    this.updateStatus(request, "running", first.agent);
    const delegated = (first.response.payload as { response?: DelegationResponse }).response;
    if (delegated) {
      return this.finalize(request, delegated, first.agent);
    }
    return this.finalize(
      request,
      {
      delegation_id: request.delegation_id,
      status: "completed",
      assigned_agent_id: first.agent.agent_id,
      assigned_instance_id: first.agent.instance_id,
      result: first.response.payload.result as DelegationResponse["result"]
      },
      first.agent
    );
  }

  private async delegateAuction(request: DelegationRequest): Promise<DelegationResponse> {
    const { AuctionManager } = await import("./auction-manager.js");
    const auctionManager = new AuctionManager(this.registry, this.bus);
    const response = await auctionManager.runAuction(request);
    const target = response.assigned_instance_id ? await this.resolveTarget(response.assigned_instance_id) : undefined;
    if (target) {
      this.updateStatus(request, response.status === "completed" ? "running" : response.status, target);
    }
    return this.finalize(request, response, target);
  }

  private async resolveTarget(target: string): Promise<AgentDescriptor | undefined> {
    const direct = await this.registry.get(target);
    if (direct) {
      return direct;
    }

    const all = await this.registry.listAll();
    return all.find((agent) => agent.agent_id === target);
  }

  private updateStatus(
    request: DelegationRequest,
    status: DelegationStatusRecord["status"],
    agent?: AgentDescriptor
  ): void {
    const existing = this.statuses.get(request.delegation_id);
    const now = new Date().toISOString();
    const record: DelegationStatusRecord = {
      delegation_id: request.delegation_id,
      mode: request.mode,
      source_agent_id: request.source_agent_id,
      source_session_id: request.source_session_id,
      created_at: existing?.created_at ?? request.created_at,
      updated_at: now,
      status,
      target_agent_id: agent?.agent_id ?? existing?.target_agent_id,
      target_instance_id: agent?.instance_id ?? existing?.target_instance_id,
      started_at: status === "running" ? (existing?.started_at ?? now) : existing?.started_at,
      completed_at: ["completed", "failed", "rejected", "timeout", "cancelled"].includes(status) ? now : existing?.completed_at,
      error: existing?.error,
      result_summary: existing?.result_summary
    };
    this.statuses.set(request.delegation_id, record);
  }

  private finalize(
    request: DelegationRequest,
    response: DelegationResponse,
    agent?: AgentDescriptor
  ): DelegationResponse {
    const existing = this.statuses.get(request.delegation_id);
    const finalStatus = existing?.status === "cancelled" ? "cancelled" : response.status;
    const now = new Date().toISOString();
    this.statuses.set(request.delegation_id, {
      delegation_id: request.delegation_id,
      mode: request.mode,
      source_agent_id: request.source_agent_id,
      source_session_id: request.source_session_id,
      target_agent_id: response.assigned_agent_id ?? agent?.agent_id ?? existing?.target_agent_id,
      target_instance_id: response.assigned_instance_id ?? agent?.instance_id ?? existing?.target_instance_id,
      created_at: existing?.created_at ?? request.created_at,
      updated_at: now,
      started_at: response.started_at ?? existing?.started_at,
      completed_at: response.completed_at ?? now,
      status: finalStatus,
      error: response.error,
      result_summary: response.result?.summary
    });
    return finalStatus === response.status ? response : { ...response, status: finalStatus };
  }
}
