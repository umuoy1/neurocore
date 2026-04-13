import type { CalibrationRecord } from "@neurocore/protocol";

export class InMemoryCalibrationStore {
  private readonly records: CalibrationRecord[] = [];

  public append(record: CalibrationRecord) {
    this.records.push(record);
  }

  public list(sessionId?: string) {
    if (!sessionId) {
      return [...this.records];
    }
    return this.records.filter((record) => record.session_id === sessionId);
  }

  public listByTaskBucket(taskBucket: string) {
    return this.records.filter((record) => record.task_bucket === taskBucket);
  }

  public deleteSession(sessionId: string) {
    const next = this.records.filter((record) => record.session_id !== sessionId);
    this.records.length = 0;
    this.records.push(...next);
  }
}
