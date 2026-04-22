import type { Percept } from "../types.js";

export type FusionConflictResolution = "max_confidence" | "weighted_merge";

export interface SensorFusionStrategy {
  readonly name: string;
  fuse(percepts: Percept[]): Promise<Percept[]>;
}

export class ConfidenceWeightedFusionStrategy implements SensorFusionStrategy {
  public readonly name = "confidence-weighted";

  public constructor(
    private readonly resolution: FusionConflictResolution = "weighted_merge"
  ) {}

  public async fuse(percepts: Percept[]): Promise<Percept[]> {
    if (percepts.length <= 1) {
      return percepts;
    }

    const groups = new Map<string, Percept[]>();
    for (const percept of percepts) {
      const key = buildFusionKey(percept);
      const group = groups.get(key) ?? [];
      group.push(percept);
      groups.set(key, group);
    }

    return Array.from(groups.values()).map((group) => {
      if (group.length === 1) {
        return group[0];
      }
      return this.resolution === "max_confidence"
        ? chooseStrongest(group)
        : mergeWeighted(group);
    });
  }
}

function buildFusionKey(percept: Percept): string {
  const fusionKey =
    typeof percept.metadata?.fusion_key === "string"
      ? percept.metadata.fusion_key
      : typeof percept.data.entity_id === "string"
        ? percept.data.entity_id
        : typeof percept.data.label === "string"
          ? percept.data.label
          : JSON.stringify(percept.data);
  return `${percept.modality}:${percept.percept_type}:${fusionKey}`;
}

function chooseStrongest(group: Percept[]): Percept {
  return group.reduce((best, current) => current.confidence > best.confidence ? current : best);
}

function mergeWeighted(group: Percept[]): Percept {
  const totalConfidence = group.reduce((sum, percept) => sum + Math.max(percept.confidence, 0.0001), 0);
  const strongest = chooseStrongest(group);
  const mergedData = { ...strongest.data };
  const sourceSensorIds = Array.from(new Set(group.flatMap((percept) => percept.source_sensor_ids)));
  const confidence = Math.min(1, group.reduce((sum, percept) => sum + percept.confidence, 0) / group.length);
  const spatialRef = mergeSpatialRefs(group, totalConfidence);

  return {
    ...strongest,
    percept_id: strongest.percept_id,
    source_sensor_ids: sourceSensorIds,
    confidence,
    data: {
      ...mergedData,
      fused_count: group.length
    },
    spatial_ref: spatialRef,
    metadata: {
      ...strongest.metadata,
      fusion_strategy: "confidence-weighted",
      fused: true
    }
  };
}

function mergeSpatialRefs(group: Percept[], totalConfidence: number): Percept["spatial_ref"] | undefined {
  const refs = group.map((percept) => percept.spatial_ref).filter((ref): ref is NonNullable<Percept["spatial_ref"]> => Boolean(ref));
  if (refs.length === 0) {
    return undefined;
  }

  const weightedAverage = (selector: (ref: NonNullable<Percept["spatial_ref"]>) => number | undefined) => {
    let weighted = 0;
    let used = 0;
    for (const percept of group) {
      const value = selector(percept.spatial_ref ?? {});
      if (typeof value !== "number") {
        continue;
      }
      weighted += value * Math.max(percept.confidence, 0.0001);
      used += Math.max(percept.confidence, 0.0001);
    }
    if (used === 0 || totalConfidence === 0) {
      return undefined;
    }
    return weighted / used;
  };

  return {
    x: weightedAverage((ref) => ref.x),
    y: weightedAverage((ref) => ref.y),
    z: weightedAverage((ref) => ref.z),
    frame: refs.find((ref) => typeof ref.frame === "string")?.frame
  };
}
