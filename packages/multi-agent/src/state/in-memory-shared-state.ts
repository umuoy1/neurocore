import type { WorldStateDiff } from "@neurocore/world-model";
import type { SharedStateConflictRecord } from "../types.js";
import type { SharedStateStore, VersionVector } from "./shared-state-store.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";

interface NamespaceState {
  entities: Map<string, Record<string, unknown>>;
  versionVector: VersionVector;
  subscribers: Set<(agentId: string, diff: WorldStateDiff) => void>;
  conflicts: SharedStateConflictRecord[];
}

export class InMemorySharedStateStore implements SharedStateStore {
  private readonly namespaces = new Map<string, NamespaceState>();

  constructor(private readonly bus?: InterAgentBus) {}

  private getOrCreateNamespace(namespace: string): NamespaceState {
    let ns = this.namespaces.get(namespace);
    if (!ns) {
      ns = { entities: new Map(), versionVector: {}, subscribers: new Set(), conflicts: [] };
      this.namespaces.set(namespace, ns);
    }
    return ns;
  }

  async applyDiff(
    agentId: string,
    namespace: string,
    diff: WorldStateDiff,
    options?: {
      expectedVersionVector?: VersionVector;
      resolution?: "last_writer_wins" | "merge";
    }
  ): Promise<void> {
    const ns = this.getOrCreateNamespace(namespace);
    const resolution = options?.resolution ?? "merge";
    const expectedVector = options?.expectedVersionVector;

    if (expectedVector && this.hasVersionConflict(expectedVector, ns.versionVector)) {
      const conflict = this.recordConflict(ns, {
        namespace,
        source_agent_id: agentId,
        conflict_type: "stale_version",
        expected_version_vector: { ...expectedVector },
        current_version_vector: { ...ns.versionVector },
        detected_at: new Date().toISOString(),
        resolved_by: resolution
      });
      await this.publishConflict("world_state.conflict_detected", agentId, namespace, conflict);
    }

    ns.versionVector[agentId] = (ns.versionVector[agentId] ?? 0) + 1;

    for (const entity of diff.added_entities) {
      ns.entities.set(entity.entity_id, entity.properties);
    }
    for (const update of diff.updated_entities) {
      const existing = ns.entities.get(update.entity_id) ?? {};
      if (Object.keys(existing).length > 0 && expectedVector && this.hasAnyForeignProgress(agentId, expectedVector, ns.versionVector)) {
        const conflict = this.recordConflict(ns, {
          namespace,
          entity_id: update.entity_id,
          source_agent_id: agentId,
          conflict_type: "concurrent_update",
          expected_version_vector: { ...expectedVector },
          current_version_vector: { ...ns.versionVector },
          detected_at: new Date().toISOString(),
          resolved_by: resolution
        });
        await this.publishConflict("world_state.conflict_detected", agentId, namespace, conflict);
      }
      ns.entities.set(update.entity_id, resolution === "last_writer_wins" ? { ...update.changes } : { ...existing, ...update.changes });
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

  getConflicts(namespace?: string): SharedStateConflictRecord[] {
    if (!namespace) {
      return Array.from(this.namespaces.values()).flatMap((entry) => entry.conflicts);
    }
    return [...(this.namespaces.get(namespace)?.conflicts ?? [])];
  }

  private hasVersionConflict(expected: VersionVector, current: VersionVector): boolean {
    for (const [agentId, version] of Object.entries(expected)) {
      if ((current[agentId] ?? 0) > version) {
        return true;
      }
    }
    return false;
  }

  private hasAnyForeignProgress(sourceAgentId: string, expected: VersionVector, current: VersionVector): boolean {
    for (const [agentId, version] of Object.entries(current)) {
      if (agentId !== sourceAgentId && version > (expected[agentId] ?? 0)) {
        return true;
      }
    }
    return false;
  }

  private recordConflict(ns: NamespaceState, conflict: SharedStateConflictRecord): SharedStateConflictRecord {
    ns.conflicts.push(conflict);
    return conflict;
  }

  private async publishConflict(
    topic: "world_state.conflict_detected" | "world_state.conflict_resolved",
    agentId: string,
    namespace: string,
    conflict: SharedStateConflictRecord
  ): Promise<void> {
    if (!this.bus) {
      return;
    }
    await this.bus.publish("world.state_conflict", {
      message_id: `state-conflict-${namespace}-${Date.now()}`,
      correlation_id: namespace,
      trace_id: namespace,
      pattern: "event",
      source_agent_id: agentId,
      source_instance_id: agentId,
      payload: {
        type: topic,
        namespace,
        conflict
      },
      created_at: new Date().toISOString()
    });
  }
}
