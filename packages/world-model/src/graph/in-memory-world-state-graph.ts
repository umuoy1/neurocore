import type { Percept } from "@neurocore/device-core";
import type { WorldStateDigest } from "@neurocore/protocol";
import type { WorldEntity, WorldModelConfig, WorldRelation, WorldStateDiff, WorldStateQuery } from "../types.js";
import type { WorldStateGraph } from "./world-state-graph.js";

export class InMemoryWorldStateGraph implements WorldStateGraph {
  private readonly entities = new Map<string, WorldEntity>();
  private readonly relations = new Map<string, WorldRelation>();
  private readonly entityTypeIndex = new Map<string, Set<string>>();
  private readonly relationTypeIndex = new Map<string, Set<string>>();

  private readonly decayFactor: number;
  private readonly decayIntervalMs: number;
  private readonly pruneThreshold: number;
  private readonly defaultTtlMs: number;

  constructor(config?: WorldModelConfig) {
    this.decayFactor = config?.confidence_decay_factor ?? 0.95;
    this.decayIntervalMs = config?.confidence_decay_interval_ms ?? 60000;
    this.pruneThreshold = config?.prune_confidence_threshold ?? 0.1;
    this.defaultTtlMs = config?.default_entity_ttl_ms ?? 300000;
  }

  addEntity(entity: WorldEntity): void {
    this.entities.set(entity.entity_id, { ...entity });
    const typeSet = this.entityTypeIndex.get(entity.entity_type) ?? new Set();
    typeSet.add(entity.entity_id);
    this.entityTypeIndex.set(entity.entity_type, typeSet);
  }

  updateEntity(entity_id: string, properties: Partial<WorldEntity>): void {
    const existing = this.entities.get(entity_id);
    if (!existing) return;

    const oldType = existing.entity_type;
    const updated = {
      ...existing,
      ...properties,
      properties: properties.properties
        ? { ...existing.properties, ...properties.properties }
        : existing.properties
    };
    this.entities.set(entity_id, updated);

    if (properties.entity_type && properties.entity_type !== oldType) {
      this.entityTypeIndex.get(oldType)?.delete(entity_id);
      const newSet = this.entityTypeIndex.get(properties.entity_type) ?? new Set();
      newSet.add(entity_id);
      this.entityTypeIndex.set(properties.entity_type, newSet);
    }
  }

  removeEntity(entity_id: string): void {
    const entity = this.entities.get(entity_id);
    if (!entity) return;
    this.entities.delete(entity_id);
    this.entityTypeIndex.get(entity.entity_type)?.delete(entity_id);

    const relationsToRemove: string[] = [];
    for (const [rid, rel] of this.relations) {
      if (rel.source_entity_id === entity_id || rel.target_entity_id === entity_id) {
        relationsToRemove.push(rid);
      }
    }
    for (const rid of relationsToRemove) {
      this.removeRelation(rid);
    }
  }

  getEntity(entity_id: string): WorldEntity | undefined {
    const e = this.entities.get(entity_id);
    return e ? { ...e, properties: { ...e.properties } } : undefined;
  }

  addRelation(relation: WorldRelation): void {
    this.relations.set(relation.relation_id, { ...relation });
    const typeSet = this.relationTypeIndex.get(relation.relation_type) ?? new Set();
    typeSet.add(relation.relation_id);
    this.relationTypeIndex.set(relation.relation_type, typeSet);
  }

  removeRelation(relation_id: string): void {
    const rel = this.relations.get(relation_id);
    if (!rel) return;
    this.relations.delete(relation_id);
    this.relationTypeIndex.get(rel.relation_type)?.delete(relation_id);
  }

  query(q: WorldStateQuery): { entities: WorldEntity[]; relations: WorldRelation[] } {
    let entityIds: Set<string> | null = null;

    if (q.entity_id) {
      entityIds = new Set([q.entity_id]);
    } else if (q.entity_type) {
      entityIds = new Set(this.entityTypeIndex.get(q.entity_type) ?? []);
    }

    const now = Date.now();
    const matchedEntities: WorldEntity[] = [];
    const candidates = entityIds
      ? [...entityIds].map((id) => this.entities.get(id)).filter(Boolean) as WorldEntity[]
      : [...this.entities.values()];

    for (const entity of candidates) {
      if (q.min_confidence !== undefined && entity.confidence < q.min_confidence) continue;
      if (q.max_age_ms !== undefined) {
        const age = now - new Date(entity.last_observed).getTime();
        if (age > q.max_age_ms) continue;
      }
      if (q.spatial_bounds) {
        const props = entity.properties;
        const x = typeof props.x === "number" ? props.x : undefined;
        const y = typeof props.y === "number" ? props.y : undefined;
        if (x === undefined || y === undefined) continue;
        if (x < q.spatial_bounds.min_x || x > q.spatial_bounds.max_x) continue;
        if (y < q.spatial_bounds.min_y || y > q.spatial_bounds.max_y) continue;
      }
      matchedEntities.push({ ...entity });
    }

    const entityIdSet = new Set(matchedEntities.map((e) => e.entity_id));
    const matchedRelations: WorldRelation[] = [];
    const relationCandidates = q.relation_type
      ? [...(this.relationTypeIndex.get(q.relation_type) ?? [])].map((id) => this.relations.get(id)).filter(Boolean) as WorldRelation[]
      : [...this.relations.values()];

    for (const rel of relationCandidates) {
      if (entityIdSet.has(rel.source_entity_id) || entityIdSet.has(rel.target_entity_id)) {
        matchedRelations.push({ ...rel });
      }
    }

    return { entities: matchedEntities, relations: matchedRelations };
  }

  applyPercepts(percepts: Percept[]): WorldStateDiff {
    const diff: WorldStateDiff = {
      added_entities: [],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    };

    for (const percept of percepts) {
      const existingEntity = this.findMatchingEntity(percept);

      if (existingEntity) {
        const changes: Record<string, unknown> = {
          ...percept.data,
          confidence: Math.max(existingEntity.confidence, percept.confidence),
          last_observed: percept.timestamp
        };
        this.updateEntity(existingEntity.entity_id, {
          properties: percept.data,
          confidence: Math.max(existingEntity.confidence, percept.confidence),
          last_observed: percept.timestamp,
          source_percept_ids: [
            ...(existingEntity.source_percept_ids ?? []),
            percept.percept_id
          ]
        });
        diff.updated_entities.push({
          entity_id: existingEntity.entity_id,
          changes
        });
      } else {
        const entityId = `entity-${percept.percept_id}`;
        const newEntity: WorldEntity = {
          entity_id: entityId,
          entity_type: percept.percept_type,
          properties: {
            ...percept.data,
            ...(percept.spatial_ref ? { x: percept.spatial_ref.x, y: percept.spatial_ref.y, z: percept.spatial_ref.z } : {})
          },
          confidence: percept.confidence,
          last_observed: percept.timestamp,
          source_percept_ids: [percept.percept_id],
          ttl_ms: this.defaultTtlMs
        };
        this.addEntity(newEntity);
        diff.added_entities.push(newEntity);
      }
    }

    return diff;
  }

  applyDiff(diff: WorldStateDiff): void {
    for (const entity of diff.added_entities) {
      this.addEntity(entity);
    }
    for (const update of diff.updated_entities) {
      this.updateEntity(update.entity_id, {
        properties: update.changes as Record<string, unknown>
      });
    }
    for (const id of diff.removed_entity_ids) {
      this.removeEntity(id);
    }
    for (const rel of diff.added_relations) {
      this.addRelation(rel);
    }
    for (const id of diff.removed_relation_ids) {
      this.removeRelation(id);
    }
  }

  decayConfidence(now: string): void {
    const nowMs = new Date(now).getTime();
    for (const [id, entity] of this.entities) {
      const elapsedMs = nowMs - new Date(entity.last_observed).getTime();
      if (elapsedMs <= 0) continue;
      const intervals = elapsedMs / this.decayIntervalMs;
      const newConfidence = entity.confidence * Math.pow(this.decayFactor, intervals);
      this.entities.set(id, { ...entity, confidence: newConfidence });
    }
  }

  pruneExpired(now: string): number {
    const nowMs = new Date(now).getTime();
    const toRemove: string[] = [];
    for (const [id, entity] of this.entities) {
      const ttl = entity.ttl_ms ?? this.defaultTtlMs;
      const age = nowMs - new Date(entity.last_observed).getTime();
      if (age > ttl || entity.confidence < this.pruneThreshold) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.removeEntity(id);
    }
    return toRemove.length;
  }

  snapshot(): { entities: WorldEntity[]; relations: WorldRelation[] } {
    return {
      entities: [...this.entities.values()].map((e) => ({ ...e, properties: { ...e.properties } })),
      relations: [...this.relations.values()].map((r) => ({ ...r }))
    };
  }

  toDigest(): WorldStateDigest {
    const typeCounts = new Map<string, number>();
    let totalConfidence = 0;
    for (const entity of this.entities.values()) {
      typeCounts.set(entity.entity_type, (typeCounts.get(entity.entity_type) ?? 0) + 1);
      totalConfidence += entity.confidence;
    }

    const entityCount = this.entities.size;
    const avgConfidence = entityCount > 0 ? totalConfidence / entityCount : 1;

    const typeSummary = [...typeCounts.entries()]
      .map(([type, count]) => `${type}(${count})`)
      .join(", ");

    return {
      summary: entityCount > 0
        ? `World state: ${entityCount} entities [${typeSummary}], ${this.relations.size} relations`
        : "World state: empty",
      uncertainty: 1 - avgConfidence
    };
  }

  private findMatchingEntity(percept: Percept): WorldEntity | undefined {
    for (const entity of this.entities.values()) {
      if (entity.entity_type !== percept.percept_type) continue;
      if (percept.spatial_ref && entity.properties.x !== undefined) {
        const dx = (percept.spatial_ref.x ?? 0) - (entity.properties.x as number);
        const dy = (percept.spatial_ref.y ?? 0) - (entity.properties.y as number);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.0) return entity;
      }
      if (entity.source_percept_ids?.some((id) => percept.source_sensor_ids.includes(id.replace("entity-", "")))) {
        return entity;
      }
    }
    return undefined;
  }
}
