import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CheckpointStore, SessionCheckpoint } from "@neurocore/protocol";

export interface SqliteCheckpointStoreOptions {
  filename: string;
}

export class SqliteCheckpointStore implements CheckpointStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteCheckpointStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_session_created
        ON session_checkpoints(session_id, created_at DESC, checkpoint_id DESC);
    `);
  }

  public save(snapshot: SessionCheckpoint): void {
    this.db
      .prepare(`
        INSERT INTO session_checkpoints (
          checkpoint_id,
          session_id,
          snapshot_json,
          created_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(checkpoint_id) DO UPDATE SET
          session_id = excluded.session_id,
          snapshot_json = excluded.snapshot_json,
          created_at = excluded.created_at
      `)
      .run(
        snapshot.checkpoint_id,
        snapshot.session.session_id,
        JSON.stringify(snapshot),
        snapshot.created_at
      );
  }

  public get(checkpointId: string): SessionCheckpoint | undefined {
    const row = this.db
      .prepare(`
        SELECT snapshot_json
        FROM session_checkpoints
        WHERE checkpoint_id = ?
      `)
      .get(checkpointId) as { snapshot_json: string } | undefined;

    if (!row) {
      return undefined;
    }

    return parseCheckpoint(row.snapshot_json, checkpointId);
  }

  public list(sessionId: string): SessionCheckpoint[] {
    const rows = this.db
      .prepare(`
        SELECT checkpoint_id, snapshot_json
        FROM session_checkpoints
        WHERE session_id = ?
        ORDER BY created_at DESC, checkpoint_id DESC
      `)
      .all(sessionId) as Array<{ checkpoint_id: string; snapshot_json: string }>;

    return rows.map((row) => parseCheckpoint(row.snapshot_json, row.checkpoint_id));
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM session_checkpoints WHERE session_id = ?").run(sessionId);
  }

  public close(): void {
    this.db.close();
  }
}

function parseCheckpoint(raw: string, target: string): SessionCheckpoint {
  const parsed = JSON.parse(raw) as SessionCheckpoint;
  if (!parsed?.checkpoint_id || !parsed?.session?.session_id) {
    throw new Error(`Invalid session checkpoint at ${target}.`);
  }
  return parsed;
}
