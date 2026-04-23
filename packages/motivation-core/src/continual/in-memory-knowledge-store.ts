import type { KnowledgeSnapshot } from "@neurocore/protocol";

export class InMemoryKnowledgeStore {
  private readonly snapshotsBySession = new Map<string, KnowledgeSnapshot[]>();

  public append(snapshot: KnowledgeSnapshot): void {
    const snapshots = this.snapshotsBySession.get(snapshot.session_id) ?? [];
    snapshots.push(structuredClone(snapshot));
    this.snapshotsBySession.set(snapshot.session_id, snapshots);
  }

  public list(sessionId: string): KnowledgeSnapshot[] {
    return structuredClone(this.snapshotsBySession.get(sessionId) ?? []);
  }

  public deleteSession(sessionId: string): void {
    this.snapshotsBySession.delete(sessionId);
  }
}
