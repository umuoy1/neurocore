import { DatabaseSync } from "node:sqlite";
import type { SessionCheckpoint } from "@neurocore/protocol";
import type { CheckpointStore } from "@neurocore/protocol";

const RUNTIME_SNAPSHOT_CHECKPOINT_BACKFILL_KEY =
  "runtime_sessions_v1_to_checkpoint_table_v1";

export interface SqliteCheckpointBackfillOptions {
  filename: string;
  checkpointStore: CheckpointStore;
}

export function backfillSqliteCheckpointStoreFromRuntimeState(
  options: SqliteCheckpointBackfillOptions
): number {
  const db = new DatabaseSync(options.filename);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_backfill_status (
        migration_key TEXT PRIMARY KEY,
        completed_at TEXT NOT NULL,
        session_count INTEGER NOT NULL
      );
    `);

    const runtimeSessionsTable = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'runtime_sessions'
      `)
      .get() as { name: string } | undefined;

    if (!runtimeSessionsTable) {
      return 0;
    }

    const completed = db
      .prepare(`
        SELECT migration_key
        FROM checkpoint_backfill_status
        WHERE migration_key = ?
      `)
      .get(RUNTIME_SNAPSHOT_CHECKPOINT_BACKFILL_KEY) as { migration_key: string } | undefined;

    if (completed) {
      return 0;
    }

    const rows = db
      .prepare(`
        SELECT session_id, snapshot_json
        FROM runtime_sessions
        ORDER BY updated_at ASC, session_id ASC
      `)
      .all() as Array<{ session_id: string; snapshot_json: string }>;

    let backfilledSessions = 0;

    for (const row of rows) {
      const snapshot = parseSnapshot(row.snapshot_json, row.session_id);
      for (const checkpoint of snapshot.checkpoints ?? []) {
        options.checkpointStore.save(structuredClone(checkpoint) as SessionCheckpoint);
      }
      backfilledSessions += 1;
    }

    db.prepare(`
      INSERT INTO checkpoint_backfill_status (
        migration_key,
        completed_at,
        session_count
      )
      VALUES (?, ?, ?)
      ON CONFLICT(migration_key) DO UPDATE SET
        completed_at = excluded.completed_at,
        session_count = excluded.session_count
    `).run(
      RUNTIME_SNAPSHOT_CHECKPOINT_BACKFILL_KEY,
      new Date().toISOString(),
      backfilledSessions
    );

    return backfilledSessions;
  } finally {
    db.close();
  }
}

function parseSnapshot(raw: string, target: string): LegacyRuntimeSessionSnapshot {
  const parsed = JSON.parse(raw) as LegacyRuntimeSessionSnapshot;
  if (!parsed?.session?.session_id) {
    throw new Error(`Invalid runtime session snapshot at ${target}.`);
  }
  return parsed;
}

interface LegacyRuntimeSessionSnapshot {
  session: {
    session_id: string;
  };
  checkpoints?: SessionCheckpoint[];
}
