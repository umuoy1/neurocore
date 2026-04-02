import type { AgentProfile, CreateSessionCommand } from "@neurocore/protocol";
import {
  DefaultAgentLifecycleManager,
  DefaultTaskDelegator,
  InMemoryAgentRegistry,
  InMemoryDistributedGoalManager,
  InMemorySharedStateStore,
  LocalInterAgentBus,
  type AgentCapability,
  type AgentDescriptor,
  type AuctionBid,
  type DelegationRequest,
  type DelegationResponse,
  type InterAgentMessage
} from "@neurocore/multi-agent";
import type { AgentBuilder } from "./define-agent.js";

interface RegisteredAgentEntry {
  builder: AgentBuilder;
  descriptor: AgentDescriptor;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

export class InProcessAgentMesh {
  public readonly registry = new InMemoryAgentRegistry();
  public readonly bus = new LocalInterAgentBus();
  public readonly distributedGoalManager = new InMemoryDistributedGoalManager(this.bus);
  public readonly sharedStateStore = new InMemorySharedStateStore(this.bus);
  public readonly agentLifecycleManager = new DefaultAgentLifecycleManager(
    this.registry,
    this.bus,
    this.distributedGoalManager
  );
  public readonly taskDelegator = new DefaultTaskDelegator(this.registry, this.bus);

  private readonly registrations = new Map<string, RegisteredAgentEntry>();

  public async registerAgents(agents: Iterable<AgentBuilder>): Promise<AgentDescriptor[]> {
    const descriptors: AgentDescriptor[] = [];
    for (const agent of agents) {
      descriptors.push(await this.registerAgent(agent));
    }
    return descriptors;
  }

  public async registerAgent(agent: AgentBuilder): Promise<AgentDescriptor> {
    const profile = agent.getProfile();
    const existing = this.registrations.get(profile.agent_id);
    if (existing) {
      agent.useRuntimeInfrastructure(this.buildInfrastructure());
      return existing.descriptor;
    }

    const config = this.ensureMultiAgentConfig(agent);
    const descriptor = this.buildDescriptor(agent.getProfile(), config);

    agent.useRuntimeInfrastructure(this.buildInfrastructure());
    await this.registry.register(descriptor);
    this.bus.registerHandler(descriptor.instance_id, (message) =>
      this.handleMessage(agent, descriptor, message)
    );

    const heartbeatTimer = setInterval(() => {
      void this.registry.heartbeat(descriptor.instance_id);
    }, descriptor.heartbeat_interval_ms);

    this.registrations.set(profile.agent_id, {
      builder: agent,
      descriptor,
      heartbeatTimer
    });

    return descriptor;
  }

  public getDescriptor(agentId: string): AgentDescriptor | undefined {
    return this.registrations.get(agentId)?.descriptor;
  }

  public async close(): Promise<void> {
    for (const { descriptor, heartbeatTimer } of this.registrations.values()) {
      clearInterval(heartbeatTimer);
      this.bus.unregisterHandler(descriptor.instance_id);
      await this.registry.deregister(descriptor.instance_id);
    }
    this.registrations.clear();
    await this.bus.close();
  }

  private buildInfrastructure() {
    return {
      agentRegistry: this.registry,
      interAgentBus: this.bus,
      taskDelegator: this.taskDelegator,
      distributedGoalManager: this.distributedGoalManager,
      agentLifecycleManager: this.agentLifecycleManager,
      sharedStateStore: this.sharedStateStore
    };
  }

  private ensureMultiAgentConfig(agent: AgentBuilder): NonNullable<AgentProfile["multi_agent_config"]> {
    const profile = agent.getProfile();
    agent.configureMultiAgent({
      enabled: profile.multi_agent_config?.enabled ?? true,
      heartbeat_interval_ms: profile.multi_agent_config?.heartbeat_interval_ms ?? 30_000,
      delegation_timeout_ms: profile.multi_agent_config?.delegation_timeout_ms ?? 60_000,
      auction_timeout_ms:
        profile.multi_agent_config?.auction_timeout_ms ??
        profile.multi_agent_config?.delegation_timeout_ms ??
        15_000,
      max_delegation_depth: profile.multi_agent_config?.max_delegation_depth ?? 3,
      coordination_strategy: profile.multi_agent_config?.coordination_strategy ?? "hierarchical",
      domains: profile.multi_agent_config?.domains ?? (profile.domain ? [profile.domain] : []),
      capabilities: profile.multi_agent_config?.capabilities ?? [],
      max_capacity: profile.multi_agent_config?.max_capacity ?? 1,
      auto_accept_delegation: profile.multi_agent_config?.auto_accept_delegation ?? true
    });
    return agent.getProfile().multi_agent_config!;
  }

  private buildDescriptor(
    profile: AgentProfile,
    config: NonNullable<AgentProfile["multi_agent_config"]>
  ): AgentDescriptor {
    const now = new Date().toISOString();
    return {
      agent_id: profile.agent_id,
      instance_id: `${profile.agent_id}::primary`,
      name: profile.name,
      version: profile.version,
      status: "idle",
      capabilities: config.capabilities ?? [],
      domains: config.domains ?? [],
      current_load: 0,
      max_capacity: config.max_capacity ?? 1,
      heartbeat_interval_ms: config.heartbeat_interval_ms ?? 30_000,
      last_heartbeat_at: now,
      registered_at: now,
      metadata: {
        role: profile.role,
        mode: profile.mode
      }
    };
  }

  private async handleMessage(
    agent: AgentBuilder,
    descriptor: AgentDescriptor,
    message: InterAgentMessage
  ): Promise<InterAgentMessage> {
    const type = typeof message.payload.type === "string" ? message.payload.type : undefined;
    if (type === "auction_request") {
      return this.respond(message, descriptor, {
        bid: this.buildBid(descriptor, message.payload.request as DelegationRequest)
      });
    }

    if (type === "delegation_request") {
      const response = await this.executeDelegation(agent, descriptor, message.payload.request as DelegationRequest);
      return this.respond(message, descriptor, { response });
    }

    return this.respond(message, descriptor, {
      response: {
        delegation_id:
          typeof message.payload.delegation_id === "string" ? message.payload.delegation_id : message.correlation_id,
        status: "failed",
        error: `Unsupported inter-agent payload type: ${type ?? "unknown"}`
      } satisfies DelegationResponse
    });
  }

  private respond(
    request: InterAgentMessage,
    descriptor: AgentDescriptor,
    payload: Record<string, unknown>
  ): InterAgentMessage {
    return {
      ...request,
      message_id: `resp-${request.message_id}`,
      pattern: "response",
      source_agent_id: descriptor.agent_id,
      source_instance_id: descriptor.instance_id,
      target_agent_id: request.source_instance_id,
      payload
    };
  }

  private buildBid(descriptor: AgentDescriptor, request: DelegationRequest): AuctionBid | undefined {
    if (descriptor.current_load >= descriptor.max_capacity) {
      return undefined;
    }

    if (this.registrations.get(descriptor.agent_id)?.builder.getProfile().multi_agent_config?.auto_accept_delegation === false) {
      return undefined;
    }

    const matchingCapabilities =
      request.target_capabilities && request.target_capabilities.length > 0
        ? descriptor.capabilities.filter((cap) => request.target_capabilities?.includes(cap.name))
        : descriptor.capabilities;

    const strongestCapability = matchingCapabilities.reduce<AgentCapability | undefined>((best, current) => {
      if (!best || current.proficiency > best.proficiency) {
        return current;
      }
      return best;
    }, undefined);

    const proficiency = strongestCapability?.proficiency ?? 0.6;
    const loadRatio = descriptor.max_capacity > 0 ? descriptor.current_load / descriptor.max_capacity : 1;
    const confidence = clamp(0.45 + proficiency * 0.45 - loadRatio * 0.2, 0.05, 0.99);
    const estimatedDurationMs = Math.round(800 + (1 - proficiency) * 4_000 + descriptor.current_load * 750);
    const estimatedCost = Number((0.01 + (1 - proficiency) * 0.04 + descriptor.current_load * 0.01).toFixed(4));

    return {
      agent_id: descriptor.agent_id,
      instance_id: descriptor.instance_id,
      estimated_duration_ms: estimatedDurationMs,
      estimated_cost: estimatedCost,
      confidence,
      reasoning: `capacity ${descriptor.current_load}/${descriptor.max_capacity}, proficiency ${proficiency.toFixed(2)}`
    };
  }

  private async executeDelegation(
    agent: AgentBuilder,
    descriptor: AgentDescriptor,
    request: DelegationRequest
  ): Promise<DelegationResponse> {
    const startedAt = new Date().toISOString();
    const profile = agent.getProfile();
    if (profile.multi_agent_config?.auto_accept_delegation === false) {
      return {
        delegation_id: request.delegation_id,
        status: "rejected",
        assigned_agent_id: descriptor.agent_id,
        assigned_instance_id: descriptor.instance_id,
        error: "Agent is configured to reject delegated tasks",
        started_at: startedAt,
        completed_at: new Date().toISOString()
      };
    }

    if (descriptor.current_load >= descriptor.max_capacity) {
      return {
        delegation_id: request.delegation_id,
        status: "rejected",
        assigned_agent_id: descriptor.agent_id,
        assigned_instance_id: descriptor.instance_id,
        error: "Agent is at capacity",
        started_at: startedAt,
        completed_at: new Date().toISOString()
      };
    }

    this.setDescriptorLoad(descriptor, descriptor.current_load + 1);
    await this.registry.heartbeat(descriptor.instance_id);

    try {
      const handle = agent.createSession(this.buildDelegatedSessionCommand(profile, descriptor, request));
      const result = await withTimeout(handle.run(), request.timeout_ms, () => handle.cancel());
      const completedAt = new Date().toISOString();
      const isSuccessful = result.finalState === "completed";
      const isPartial = result.finalState === "waiting" || result.finalState === "suspended";

      return {
        delegation_id: request.delegation_id,
        status: isSuccessful || isPartial ? "completed" : "failed",
        assigned_agent_id: descriptor.agent_id,
        assigned_instance_id: descriptor.instance_id,
        assigned_session_id: handle.id,
        result: {
          status: isSuccessful ? "success" : isPartial ? "partial" : "failure",
          summary:
            result.outputText ??
            `Delegated session ${handle.id} ended in state ${result.finalState}.`,
          payload: {
            final_state: result.finalState,
            step_count: result.steps.length,
            source_goal_id: request.source_goal_id
          }
        },
        started_at: startedAt,
        completed_at: completedAt
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "delegation_timeout";
      return {
        delegation_id: request.delegation_id,
        status: isTimeout ? "timeout" : "failed",
        assigned_agent_id: descriptor.agent_id,
        assigned_instance_id: descriptor.instance_id,
        error: error instanceof Error ? error.message : String(error),
        started_at: startedAt,
        completed_at: new Date().toISOString()
      };
    } finally {
      this.setDescriptorLoad(descriptor, Math.max(0, descriptor.current_load - 1));
      await this.registry.heartbeat(descriptor.instance_id);
    }
  }

  private buildDelegatedSessionCommand(
    profile: AgentProfile,
    descriptor: AgentDescriptor,
    request: DelegationRequest
  ): CreateSessionCommand {
    const description = request.goal.description?.trim();
    const context =
      request.context && Object.keys(request.context).length > 0
        ? `\n\nContext:\n${JSON.stringify(request.context, null, 2)}`
        : "";

    return {
      agent_id: profile.agent_id,
      tenant_id: request.tenant_id ?? "multi-agent",
      session_mode: "sync",
      initial_input: {
        input_id: `inp_${request.delegation_id}`,
        content: `${request.goal.title}${description ? `\n\n${description}` : ""}${context}`,
        created_at: new Date().toISOString(),
        metadata: {
          delegation_id: request.delegation_id,
          delegation_depth: request.current_depth + 1,
          delegation_mode: request.mode,
          source_agent_id: request.source_agent_id,
          source_session_id: request.source_session_id,
          source_cycle_id: request.source_cycle_id,
          source_goal_id: request.source_goal_id,
          target_agent_id: descriptor.agent_id,
          target_instance_id: descriptor.instance_id
        }
      }
    };
  }

  private setDescriptorLoad(descriptor: AgentDescriptor, nextLoad: number): void {
    descriptor.current_load = Math.max(0, nextLoad);
    descriptor.status = descriptor.current_load > 0 ? "busy" : "idle";
    descriptor.last_heartbeat_at = new Date().toISOString();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout();
          reject(new Error("delegation_timeout"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
