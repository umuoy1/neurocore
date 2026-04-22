import type { AgentDescriptor, AgentQuery, AgentStatus, StatusChangeCallback } from "../types.js";
import type {
  AgentDeregistrationCallback,
  AgentHeartbeatLostCallback,
  AgentRegistrationCallback,
  AgentRegistry
} from "./agent-registry.js";
import { HeartbeatMonitor } from "./heartbeat-monitor.js";

export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<string, AgentDescriptor>();
  private readonly capabilityIndex = new Map<string, Set<string>>();
  private readonly domainIndex = new Map<string, Set<string>>();
  private readonly statusCallbacks = new Set<StatusChangeCallback>();
  private readonly registrationCallbacks = new Set<AgentRegistrationCallback>();
  private readonly deregistrationCallbacks = new Set<AgentDeregistrationCallback>();
  private readonly heartbeatLostCallbacks = new Set<AgentHeartbeatLostCallback>();
  public readonly heartbeatMonitor = new HeartbeatMonitor();

  constructor() {
    this.heartbeatMonitor.onMiss = (instanceId) => {
      const agent = this.agents.get(instanceId);
      if (agent && agent.status !== "unreachable" && agent.status !== "terminated") {
        const previous = agent.status;
        this.changeStatus(instanceId, "unreachable");
        const updated = this.agents.get(instanceId);
        if (updated) {
          for (const callback of this.heartbeatLostCallbacks) {
            callback(updated, previous);
          }
        }
      }
    };
    this.heartbeatMonitor.onTimeout = (instanceId) => {
      const agent = this.agents.get(instanceId);
      if (agent && agent.status !== "terminated") {
        this.changeStatus(instanceId, "terminated");
      }
    };
    this.heartbeatMonitor.onRecovery = (instanceId) => {
      const agent = this.agents.get(instanceId);
      if (agent && agent.status === "unreachable") {
        this.changeStatus(instanceId, "idle");
      }
    };
  }

  async register(descriptor: AgentDescriptor): Promise<void> {
    if (this.agents.has(descriptor.instance_id)) {
      throw new Error(`Agent instance '${descriptor.instance_id}' is already registered`);
    }
    this.agents.set(descriptor.instance_id, { ...descriptor });
    for (const cap of descriptor.capabilities) {
      let set = this.capabilityIndex.get(cap.name);
      if (!set) {
        set = new Set();
        this.capabilityIndex.set(cap.name, set);
      }
      set.add(descriptor.instance_id);
    }
    for (const domain of descriptor.domains) {
      let set = this.domainIndex.get(domain);
      if (!set) {
        set = new Set();
        this.domainIndex.set(domain, set);
      }
      set.add(descriptor.instance_id);
    }
    this.heartbeatMonitor.track(descriptor.instance_id, descriptor.heartbeat_interval_ms);
    const registered = this.agents.get(descriptor.instance_id);
    if (registered) {
      for (const callback of this.registrationCallbacks) {
        callback(registered);
      }
    }
  }

  async deregister(instanceId: string): Promise<void> {
    const agent = this.agents.get(instanceId);
    if (!agent) return;
    for (const cap of agent.capabilities) {
      this.capabilityIndex.get(cap.name)?.delete(instanceId);
    }
    for (const domain of agent.domains) {
      this.domainIndex.get(domain)?.delete(instanceId);
    }
    this.heartbeatMonitor.untrack(instanceId);
    this.agents.delete(instanceId);
    for (const callback of this.deregistrationCallbacks) {
      callback(agent);
    }
  }

  async heartbeat(instanceId: string): Promise<void> {
    const agent = this.agents.get(instanceId);
    if (!agent) return;
    agent.last_heartbeat_at = new Date().toISOString();
    this.heartbeatMonitor.touch(instanceId);
  }

  async discover(query: AgentQuery): Promise<AgentDescriptor[]> {
    let candidateIds: Set<string> | null = null;

    if (query.capabilities && query.capabilities.length > 0) {
      for (const cap of query.capabilities) {
        const ids = this.capabilityIndex.get(cap);
        if (!ids || ids.size === 0) return [];
        if (!candidateIds) {
          candidateIds = new Set(ids);
        } else {
          for (const id of candidateIds) {
            if (!ids.has(id)) candidateIds.delete(id);
          }
        }
      }
    }

    if (query.domains && query.domains.length > 0) {
      for (const domain of query.domains) {
        const ids = this.domainIndex.get(domain);
        if (!ids || ids.size === 0) return [];
        if (!candidateIds) {
          candidateIds = new Set(ids);
        } else {
          for (const id of candidateIds) {
            if (!ids.has(id)) candidateIds.delete(id);
          }
        }
      }
    }

    const agents = candidateIds
      ? [...candidateIds].map((id) => this.agents.get(id)!).filter(Boolean)
      : [...this.agents.values()];

    return agents.filter((agent) => {
      if (query.status && query.status.length > 0 && !query.status.includes(agent.status)) {
        return false;
      }
      if (
        query.min_available_capacity !== undefined &&
        agent.max_capacity - agent.current_load < query.min_available_capacity
      ) {
        return false;
      }
      return true;
    });
  }

  async get(instanceId: string): Promise<AgentDescriptor | undefined> {
    return this.agents.get(instanceId);
  }

  async listAll(): Promise<AgentDescriptor[]> {
    return [...this.agents.values()];
  }

  onStatusChange(callback: StatusChangeCallback): void {
    this.statusCallbacks.add(callback);
  }

  onRegistered(callback: AgentRegistrationCallback): void {
    this.registrationCallbacks.add(callback);
  }

  onDeregistered(callback: AgentDeregistrationCallback): void {
    this.deregistrationCallbacks.add(callback);
  }

  onHeartbeatLost(callback: AgentHeartbeatLostCallback): void {
    this.heartbeatLostCallbacks.add(callback);
  }

  private changeStatus(instanceId: string, newStatus: AgentStatus): void {
    const agent = this.agents.get(instanceId);
    if (!agent) return;
    const previous = agent.status;
    agent.status = newStatus;
    for (const cb of this.statusCallbacks) {
      cb(agent, previous);
    }
  }
}
