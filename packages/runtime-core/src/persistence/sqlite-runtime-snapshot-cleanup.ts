import { DatabaseSync } from "node:sqlite";
import type {
  Episode,
  ProceduralMemorySnapshot,
  SemanticMemorySnapshot,
  SessionCheckpoint,
  WorkingMemoryRecord
} from "@neurocore/protocol";

const STRIP_LEGACY_MEMORY_PAYLOAD_KEY =
  "runtime_sessions_v1_strip_legacy_memory_payload_v1";
const STRIP_LEGACY_CHECKPOINT_PAYLOAD_KEY =
  "runtime_sessions_v1_strip_legacy_checkpoint_payload_v1";

export interface SqliteRuntimeSnapshotCleanupOptions {
  filename: string;
  stripMemory?: boolean;
  stripCheckpoints?: boolean;
}

export function cleanupSqliteRuntimeSnapshotLegacyPayload(
  options: SqliteRuntimeSnapshotCleanupOptions
): number {
  if (!options.stripMemory && !options.stripCheckpoints) {
    return 0;
  }

  const db = new DatabaseSync(options.filename);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_snapshot_cleanup_status (
        cleanup_key TEXT PRIMARY KEY,
        completed_at TEXT NOT NULL,
        session_count INTEGER NOT NULL,
        rewritten_session_count INTEGER NOT NULL
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

    let rewrittenSessions = 0;

    if (options.stripMemory) {
      rewrittenSessions += runCleanupPass(
        db,
        STRIP_LEGACY_MEMORY_PAYLOAD_KEY,
        stripLegacyMemoryPayload
      );
    }

    if (options.stripCheckpoints) {
      rewrittenSessions += runCleanupPass(
        db,
        STRIP_LEGACY_CHECKPOINT_PAYLOAD_KEY,
        stripLegacyCheckpointPayload
      );
    }

    return rewrittenSessions;
  } finally {
    db.close();
  }
}

function runCleanupPass(
  db: DatabaseSync,
  cleanupKey: string,
  mutate: (snapshot: LegacyRuntimeSessionSnapshot) => boolean
): number {
  const completed = db
    .prepare(`
      SELECT cleanup_key
      FROM runtime_snapshot_cleanup_status
      WHERE cleanup_key = ?
    `)
    .get(cleanupKey) as { cleanup_key: string } | undefined;

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

  const updateRow = db.prepare(`
    UPDATE runtime_sessions
    SET snapshot_json = ?, updated_at = ?
    WHERE session_id = ?
  `);

  let rewrittenSessionCount = 0;

  for (const row of rows) {
    const snapshot = parseSnapshot(row.snapshot_json, row.session_id);
    if (!mutate(snapshot)) {
      continue;
    }

    updateRow.run(
      JSON.stringify(snapshot, null, 2),
      new Date().toISOString(),
      row.session_id
    );
    rewrittenSessionCount += 1;
  }

  db.prepare(`
    INSERT INTO runtime_snapshot_cleanup_status (
      cleanup_key,
      completed_at,
      session_count,
      rewritten_session_count
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cleanup_key) DO UPDATE SET
      completed_at = excluded.completed_at,
      session_count = excluded.session_count,
      rewritten_session_count = excluded.rewritten_session_count
  `).run(
    cleanupKey,
    new Date().toISOString(),
    rows.length,
    rewrittenSessionCount
  );

  return rewrittenSessionCount;
}

function stripLegacyMemoryPayload(snapshot: LegacyRuntimeSessionSnapshot): boolean {
  const changed =
    snapshot.working_memory !== undefined ||
    snapshot.episodes !== undefined ||
    snapshot.semantic_memory !== undefined ||
    snapshot.procedural_memory !== undefined;

  if (!changed) {
    return false;
  }

  delete snapshot.working_memory;
  delete snapshot.episodes;
  delete snapshot.semantic_memory;
  delete snapshot.procedural_memory;
  return true;
}

function stripLegacyCheckpointPayload(snapshot: LegacyRuntimeSessionSnapshot): boolean {
  if (snapshot.checkpoints === undefined) {
    return false;
  }

  delete snapshot.checkpoints;
  return true;
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
  working_memory?: WorkingMemoryRecord[];
  episodes?: Episode[];
  semantic_memory?: SemanticMemorySnapshot;
  procedural_memory?: ProceduralMemorySnapshot;
  checkpoints?: SessionCheckpoint[];
}
