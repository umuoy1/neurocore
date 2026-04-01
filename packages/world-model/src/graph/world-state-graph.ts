import type { Percept } from "@neurocore/device-core";
import type { WorldStateDigest } from "@neurocore/protocol";
import type { WorldEntity, WorldRelation, WorldStateDiff, WorldStateQuery } from "../types.js";

export interface WorldStateGraph {
  addEntity(entity: WorldEntity): void;
  updateEntity(entity_id: string, properties: Partial<WorldEntity>): void;
  removeEntity(entity_id: string): void;
  getEntity(entity_id: string): WorldEntity | undefined;

  addRelation(relation: WorldRelation): void;
  removeRelation(relation_id: string): void;

  query(query: WorldStateQuery): { entities: WorldEntity[]; relations: WorldRelation[] };

  applyPercepts(percepts: Percept[]): WorldStateDiff;
  applyDiff(diff: WorldStateDiff): void;

  decayConfidence(now: string): void;
  pruneExpired(now: string): number;

  snapshot(): { entities: WorldEntity[]; relations: WorldRelation[] };
  toDigest(): WorldStateDigest;
}
