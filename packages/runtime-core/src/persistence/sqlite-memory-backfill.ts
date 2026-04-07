import { DatabaseSync } from "node:sqlite";
import type {
  Episode,
  ProceduralMemorySnapshot,
  RuntimeSessionSnapshot,
  SemanticMemorySnapshot,
  WorkingMemoryRecord
} from "@neurocore/protocol";
import type { AgentMemoryPersistence } from "./sqlite-memory-persistence.js";

const RUNTIME_SNAPSHOT_BACKFILL_KEY = "runtime_sessions_v1_to_memory_tables_v1";

export interface SqliteMemoryBackfillOptions {
  filename: string;
  persistence: AgentMemoryPersistence;
}

export function backfillSqliteMemoryFromRuntimeState(
  options: SqliteMemoryBackfillOptions
): number {
  const db = new DatabaseSync(options.filename);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_backfill_status (
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
        FROM memory_backfill_status
        WHERE migration_key = ?
      `)
      .get(RUNTIME_SNAPSHOT_BACKFILL_KEY) as { migration_key: string } | undefined;

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
      const sessionId = snapshot.session.session_id;
      const tenantId = snapshot.session.tenant_id;

      if (snapshot.working_memory && options.persistence.working) {
        options.persistence.working.replace(
          sessionId,
          structuredClone(snapshot.working_memory) as WorkingMemoryRecord[]
        );
      }

      if (snapshot.episodes && options.persistence.episodic) {
        options.persistence.episodic.replace(
          sessionId,
          tenantId,
          structuredClone(snapshot.episodes) as Episode[]
        );
      }

      if (options.persistence.semantic) {
        if (snapshot.semantic_memory) {
          options.persistence.semantic.restoreSnapshot(
            sessionId,
            tenantId,
            structuredClone(snapshot.semantic_memory) as SemanticMemorySnapshot
          );
        } else if (snapshot.episodes) {
          options.persistence.semantic.replaceSession(
            sessionId,
            tenantId,
            structuredClone(snapshot.episodes) as Episode[]
          );
        }
      }

      if (snapshot.procedural_memory?.skills?.length && options.persistence.skillStore) {
        const procedural = structuredClone(snapshot.procedural_memory) as ProceduralMemorySnapshot;
        for (const skill of procedural.skills) {
          options.persistence.skillStore.save(skill);
        }
      }

      backfilledSessions += 1;
    }

    db.prepare(`
      INSERT INTO memory_backfill_status (
        migration_key,
        completed_at,
        session_count
      )
      VALUES (?, ?, ?)
      ON CONFLICT(migration_key) DO UPDATE SET
        completed_at = excluded.completed_at,
        session_count = excluded.session_count
    `).run(
      RUNTIME_SNAPSHOT_BACKFILL_KEY,
      new Date().toISOString(),
      backfilledSessions
    );

    return backfilledSessions;
  } finally {
    db.close();
  }
}

function parseSnapshot(raw: string, target: string): RuntimeSessionSnapshot {
  const parsed = JSON.parse(raw) as RuntimeSessionSnapshot;
  if (!parsed?.session?.session_id) {
    throw new Error(`Invalid runtime session snapshot at ${target}.`);
  }
  return parsed;
}
