import type { WorldStateDiff } from "@neurocore/world-model";

export interface VersionVector {
  [agentId: string]: number;
}

export interface SharedStateStore {
  applyDiff(agentId: string, namespace: string, diff: WorldStateDiff): Promise<void>;
  getState(namespace: string): Promise<Record<string, unknown>>;
  subscribe(namespace: string, handler: (agentId: string, diff: WorldStateDiff) => void): () => void;
  getVersionVector(namespace: string): VersionVector;
}
