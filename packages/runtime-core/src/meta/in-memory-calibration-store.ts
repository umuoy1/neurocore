import type { CalibrationStore, CalibrationRecord } from "@neurocore/protocol";
import { summarizeCalibrationBucket } from "./calibration-store.js";

export class InMemoryCalibrationStore implements CalibrationStore {
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

  public getBucketStats(input: {
    taskBucket: string;
    riskLevel?: string;
    predictorId?: string;
  }) {
    return summarizeCalibrationBucket(
      this.records,
      input.taskBucket,
      input.riskLevel,
      input.predictorId
    );
  }

  public deleteSession(sessionId: string) {
    const next = this.records.filter((record) => record.session_id !== sessionId);
    this.records.length = 0;
    this.records.push(...next);
  }
}
