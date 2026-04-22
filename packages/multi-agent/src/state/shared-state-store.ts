import type { WorldStateDiff } from "@neurocore/world-model";
import type { SharedStateConflictRecord } from "../types.js";

export interface VersionVector {
  [agentId: string]: number;
}

export interface SharedStateStore {
  applyDiff(
    agentId: string,
    namespace: string,
    diff: WorldStateDiff,
    options?: {
      expectedVersionVector?: VersionVector;
      resolution?: "last_writer_wins" | "merge";
    }
  ): Promise<void>;
  getState(namespace: string): Promise<Record<string, unknown>>;
  subscribe(namespace: string, handler: (agentId: string, diff: WorldStateDiff) => void): () => void;
  getVersionVector(namespace: string): VersionVector;
  getConflicts(namespace?: string): SharedStateConflictRecord[];
}
