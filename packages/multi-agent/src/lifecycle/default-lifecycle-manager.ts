import type { AgentStatus } from "../types.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";
import type { DistributedGoalManager } from "../goal/distributed-goal-manager.js";
import type { AgentLifecycleManager } from "./agent-lifecycle-manager.js";

interface ManagedInstance {
  agentId: string;
  instanceId: string;
  status: AgentStatus;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  paused: boolean;
}

export class DefaultAgentLifecycleManager implements AgentLifecycleManager {
  private readonly instances = new Map<string, ManagedInstance>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly bus: InterAgentBus,
    private readonly goalManager?: DistributedGoalManager
  ) {}

  async spawn(agentId: string, instanceId: string, options?: Record<string, unknown>): Promise<string> {
    const now = new Date().toISOString();
    await this.registry.register({
      agent_id: agentId,
      instance_id: instanceId,
      name: agentId,
      version: "1.0.0",
      status: "idle",
      capabilities: [],
      domains: [],
      current_load: 0,
      max_capacity: (options?.max_capacity as number) ?? 5,
      heartbeat_interval_ms: (options?.heartbeat_interval_ms as number) ?? 30_000,
      last_heartbeat_at: now,
      registered_at: now
    });

    this.instances.set(instanceId, {
      agentId,
      instanceId,
      status: "idle",
      paused: false
    });

    return instanceId;
  }

  async terminate(instanceId: string, force = false): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    if (!force && instance.status === "busy") {
      await this.drain(instanceId);
      return;
    }

    if (instance.heartbeatTimer) {
      clearInterval(instance.heartbeatTimer);
    }
    await this.registry.deregister(instanceId);
    this.instances.delete(instanceId);
  }

  async drain(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.status = "draining";
    const agent = await this.registry.get(instanceId);
    if (agent) {
      (agent as { status: AgentStatus }).status = "draining";
    }
  }

  async pause(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.paused = true;
  }

  async resume(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.paused = false;
  }

  isDraining(instanceId: string): boolean {
    return this.instances.get(instanceId)?.status === "draining";
  }

  isPaused(instanceId: string): boolean {
    return this.instances.get(instanceId)?.paused ?? false;
  }
}
