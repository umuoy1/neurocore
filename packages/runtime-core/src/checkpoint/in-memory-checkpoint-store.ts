import type { CheckpointStore, SessionCheckpoint } from "@neurocore/protocol";

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpointsById = new Map<string, SessionCheckpoint>();
  private readonly checkpointIdsBySession = new Map<string, string[]>();

  public save(snapshot: SessionCheckpoint): void {
    this.checkpointsById.set(snapshot.checkpoint_id, clone(snapshot));
    const current = this.checkpointIdsBySession.get(snapshot.session.session_id) ?? [];
    current.push(snapshot.checkpoint_id);
    this.checkpointIdsBySession.set(snapshot.session.session_id, current);
  }

  public get(checkpointId: string): SessionCheckpoint | undefined {
    const snapshot = this.checkpointsById.get(checkpointId);
    return snapshot ? clone(snapshot) : undefined;
  }

  public list(sessionId: string): SessionCheckpoint[] {
    const ids = this.checkpointIdsBySession.get(sessionId) ?? [];
    return ids
      .map((id) => this.get(id))
      .filter((snapshot): snapshot is SessionCheckpoint => Boolean(snapshot));
  }

  public deleteSession(sessionId: string): void {
    const ids = this.checkpointIdsBySession.get(sessionId) ?? [];
    for (const checkpointId of ids) {
      this.checkpointsById.delete(checkpointId);
    }
    this.checkpointIdsBySession.delete(sessionId);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
