export interface WorldEntity {
  entity_id: string;
  entity_type: string;
  properties: Record<string, unknown>;
  confidence: number;
  last_observed: string;
  source_percept_ids?: string[];
  ttl_ms?: number;
}

export interface WorldRelation {
  relation_id: string;
  relation_type: string;
  source_entity_id: string;
  target_entity_id: string;
  properties?: Record<string, unknown>;
  strength: number;
  confidence: number;
  last_observed: string;
}

export interface WorldStateQuery {
  entity_type?: string;
  relation_type?: string;
  entity_id?: string;
  min_confidence?: number;
  spatial_bounds?: { min_x: number; max_x: number; min_y: number; max_y: number };
  max_age_ms?: number;
}

export interface WorldStateDiff {
  added_entities: WorldEntity[];
  updated_entities: { entity_id: string; changes: Record<string, unknown> }[];
  removed_entity_ids: string[];
  added_relations: WorldRelation[];
  removed_relation_ids: string[];
}

export interface WorldModelConfig {
  confidence_decay_factor?: number;
  confidence_decay_interval_ms?: number;
  prune_confidence_threshold?: number;
  default_entity_ttl_ms?: number;
  forward_simulation_enabled?: boolean;
}
