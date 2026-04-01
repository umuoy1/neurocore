import type { WorldStateDiff } from "@neurocore/world-model";
import type { SharedStateStore, VersionVector } from "./shared-state-store.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";

interface NamespaceState {
  entities: Map<string, Record<string, unknown>>;
  versionVector: VersionVector;
  subscribers: Set<(agentId: string, diff: WorldStateDiff) => void>;
}

export class InMemorySharedStateStore implements SharedStateStore {
  private readonly namespaces = new Map<string, NamespaceState>();

  constructor(private readonly bus?: InterAgentBus) {}

  private getOrCreateNamespace(namespace: string): NamespaceState {
    let ns = this.namespaces.get(namespace);
    if (!ns) {
      ns = { entities: new Map(), versionVector: {}, subscribers: new Set() };
      this.namespaces.set(namespace, ns);
    }
    return ns;
  }

  async applyDiff(agentId: string, namespace: string, diff: WorldStateDiff): Promise<void> {
    const ns = this.getOrCreateNamespace(namespace);

    ns.versionVector[agentId] = (ns.versionVector[agentId] ?? 0) + 1;

    for (const entity of diff.added_entities) {
      ns.entities.set(entity.entity_id, entity.properties);
    }
    for (const update of diff.updated_entities) {
      const existing = ns.entities.get(update.entity_id) ?? {};
      ns.entities.set(update.entity_id, { ...existing, ...update.changes });
    }
    for (const id of diff.removed_entity_ids) {
      ns.entities.delete(id);
    }

    for (const sub of ns.subscribers) {
      sub(agentId, diff);
    }

    if (this.bus) {
      await this.bus.publish("world.state_changed", {
        message_id: `state-${namespace}-${Date.now()}`,
        correlation_id: namespace,
        trace_id: namespace,
        pattern: "event",
        source_agent_id: agentId,
        source_instance_id: agentId,
        payload: { type: "world_state_changed", namespace, diff, version: ns.versionVector[agentId] },
        created_at: new Date().toISOString()
      });
    }
  }

  async getState(namespace: string): Promise<Record<string, unknown>> {
    const ns = this.namespaces.get(namespace);
    if (!ns) return {};
    const result: Record<string, unknown> = {};
    for (const [id, props] of ns.entities) {
      result[id] = props;
    }
    return result;
  }

  subscribe(namespace: string, handler: (agentId: string, diff: WorldStateDiff) => void): () => void {
    const ns = this.getOrCreateNamespace(namespace);
    ns.subscribers.add(handler);
    return () => ns.subscribers.delete(handler);
  }

  getVersionVector(namespace: string): VersionVector {
    const ns = this.namespaces.get(namespace);
    return ns ? { ...ns.versionVector } : {};
  }
}
