import type { CycleTrace, CycleTraceRecord, TraceStore } from "@neurocore/protocol";

export class InMemoryTraceStore implements TraceStore {
  private readonly recordsBySession = new Map<string, CycleTraceRecord[]>();

  public append(record: CycleTraceRecord): void {
    const current = this.recordsBySession.get(record.trace.session_id) ?? [];
    current.push(record);
    this.recordsBySession.set(record.trace.session_id, current);
  }

  public list(sessionId: string): CycleTraceRecord[] {
    return [...(this.recordsBySession.get(sessionId) ?? [])].sort((left, right) =>
      left.trace.started_at.localeCompare(right.trace.started_at)
    );
  }

  public getCycleRecord(sessionId: string, cycleId: string): CycleTraceRecord | undefined {
    return this.list(sessionId).find((record) => record.trace.cycle_id === cycleId);
  }

  public listTraces(sessionId: string): CycleTrace[] {
    return this.list(sessionId).map((record) => record.trace);
  }

  public replaceSession(sessionId: string, records: CycleTraceRecord[]): void {
    this.recordsBySession.set(sessionId, records);
  }
}
