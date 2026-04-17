import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CalibrationStore, CalibrationRecord } from "@neurocore/protocol";
import { summarizeCalibrationBucket } from "./calibration-store.js";

export interface SqliteCalibrationStoreOptions {
  filename: string;
}

export class SqliteCalibrationStore implements CalibrationStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteCalibrationStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta_calibration_records (
        record_id TEXT PRIMARY KEY,
        task_bucket TEXT NOT NULL,
        predicted_confidence REAL NOT NULL,
        calibrated_confidence REAL NOT NULL,
        observed_success INTEGER NOT NULL,
        risk_level TEXT NOT NULL,
        predictor_id TEXT,
        deep_eval_used INTEGER NOT NULL,
        session_id TEXT,
        cycle_id TEXT,
        action_id TEXT,
        meta_state TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_calibration_bucket
        ON meta_calibration_records(task_bucket, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_meta_calibration_session
        ON meta_calibration_records(session_id, created_at DESC);
    `);
  }

  public append(record: CalibrationRecord) {
    this.db
      .prepare(`
        INSERT INTO meta_calibration_records (
          record_id,
          task_bucket,
          predicted_confidence,
          calibrated_confidence,
          observed_success,
          risk_level,
          predictor_id,
          deep_eval_used,
          session_id,
          cycle_id,
          action_id,
          meta_state,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.record_id,
        record.task_bucket,
        record.predicted_confidence,
        record.calibrated_confidence,
        record.observed_success ? 1 : 0,
        record.risk_level,
        record.predictor_id ?? null,
        record.deep_eval_used ? 1 : 0,
        record.session_id ?? null,
        record.cycle_id ?? null,
        record.action_id ?? null,
        record.meta_state ?? null,
        record.created_at
      );
  }

  public list(sessionId?: string) {
    const rows = sessionId
      ? this.db
          .prepare(`
            SELECT *
            FROM meta_calibration_records
            WHERE session_id = ?
            ORDER BY created_at ASC, record_id ASC
          `)
      .all(sessionId) as unknown as SqliteCalibrationRow[]
      : this.db
          .prepare(`
            SELECT *
            FROM meta_calibration_records
            ORDER BY created_at ASC, record_id ASC
          `)
          .all() as unknown as SqliteCalibrationRow[];

    return rows.map((row) => toCalibrationRecord(row));
  }

  public listByTaskBucket(taskBucket: string) {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM meta_calibration_records
        WHERE task_bucket = ?
        ORDER BY created_at ASC, record_id ASC
      `)
      .all(taskBucket) as unknown as SqliteCalibrationRow[];

    return rows.map((row) => toCalibrationRecord(row));
  }

  public getBucketStats(input: {
    taskBucket: string;
    riskLevel?: string;
    predictorId?: string;
  }) {
    return summarizeCalibrationBucket(
      this.listByTaskBucket(input.taskBucket),
      input.taskBucket,
      input.riskLevel,
      input.predictorId
    );
  }

  public deleteSession(sessionId: string) {
    this.db
      .prepare("DELETE FROM meta_calibration_records WHERE session_id = ?")
      .run(sessionId);
  }

  public close(): void {
    this.db.close();
  }
}

interface SqliteCalibrationRow {
  record_id: string;
  task_bucket: string;
  predicted_confidence: number;
  calibrated_confidence: number;
  observed_success: number;
  risk_level: string;
  predictor_id: string | null;
  deep_eval_used: number;
  session_id: string | null;
  cycle_id: string | null;
  action_id: string | null;
  meta_state: CalibrationRecord["meta_state"] | null;
  created_at: string;
}

function toCalibrationRecord(row: SqliteCalibrationRow): CalibrationRecord {
  return {
    record_id: row.record_id,
    task_bucket: row.task_bucket,
    predicted_confidence: Number(row.predicted_confidence),
    calibrated_confidence: Number(row.calibrated_confidence),
    observed_success: row.observed_success === 1,
    risk_level: row.risk_level,
    predictor_id: row.predictor_id ?? undefined,
    deep_eval_used: row.deep_eval_used === 1,
    session_id: row.session_id ?? undefined,
    cycle_id: row.cycle_id ?? undefined,
    action_id: row.action_id ?? undefined,
    meta_state: row.meta_state ?? undefined,
    created_at: row.created_at
  };
}
