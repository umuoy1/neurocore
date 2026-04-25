import { DatabaseSync } from "node:sqlite";

const REQUIRED_SQL_FIRST_TABLES = [
  "runtime_sessions",
  "working_memory_entries",
  "episodic_episodes",
  "semantic_patterns",
  "semantic_session_contributions",
  "semantic_card_governance",
  "procedural_skills",
  "procedural_skill_triggers",
  "session_checkpoints"
] as const;

type SqlFirstTableName = typeof REQUIRED_SQL_FIRST_TABLES[number];

export interface SqlFirstRuntimeStateValidationOptions {
  filename: string;
}

export interface SqlFirstRuntimeStateValidationReport {
  filename: string;
  checked_at: string;
  compatible: boolean;
  runtime_session_count: number;
  legacy_memory_payload_session_ids: string[];
  legacy_checkpoint_payload_session_ids: string[];
  missing_tables: SqlFirstTableName[];
  table_counts: Record<SqlFirstTableName, number>;
  migration_status: {
    memory_backfill_completed: boolean;
    checkpoint_backfill_completed: boolean;
    memory_payload_cleanup_completed: boolean;
    checkpoint_payload_cleanup_completed: boolean;
  };
}

export function validateSqlFirstRuntimeState(
  options: SqlFirstRuntimeStateValidationOptions
): SqlFirstRuntimeStateValidationReport {
  const db = new DatabaseSync(options.filename);

  try {
    const existingTables = listTables(db);
    const missingTables = REQUIRED_SQL_FIRST_TABLES.filter((table) => !existingTables.has(table));
    const runtimeRows = existingTables.has("runtime_sessions")
      ? db
          .prepare(`
            SELECT session_id, snapshot_json
            FROM runtime_sessions
            ORDER BY session_id ASC
          `)
          .all() as Array<{ session_id: string; snapshot_json: string }>
      : [];
    const legacyMemoryPayloadSessionIds: string[] = [];
    const legacyCheckpointPayloadSessionIds: string[] = [];

    for (const row of runtimeRows) {
      const snapshot = parseSnapshot(row.snapshot_json, row.session_id);
      if (hasLegacyMemoryPayload(snapshot)) {
        legacyMemoryPayloadSessionIds.push(row.session_id);
      }
      if (snapshot.checkpoints !== undefined) {
        legacyCheckpointPayloadSessionIds.push(row.session_id);
      }
    }

    const tableCounts = Object.fromEntries(
      REQUIRED_SQL_FIRST_TABLES.map((table) => [
        table,
        existingTables.has(table) ? countRows(db, table) : 0
      ])
    ) as Record<SqlFirstTableName, number>;

    return {
      filename: options.filename,
      checked_at: new Date().toISOString(),
      compatible:
        missingTables.length === 0 &&
        legacyMemoryPayloadSessionIds.length === 0 &&
        legacyCheckpointPayloadSessionIds.length === 0,
      runtime_session_count: runtimeRows.length,
      legacy_memory_payload_session_ids: legacyMemoryPayloadSessionIds,
      legacy_checkpoint_payload_session_ids: legacyCheckpointPayloadSessionIds,
      missing_tables: missingTables,
      table_counts: tableCounts,
      migration_status: {
        memory_backfill_completed: hasStatus(
          db,
          existingTables,
          "memory_backfill_status",
          "migration_key",
          "runtime_sessions_v1_to_memory_tables_v1"
        ),
        checkpoint_backfill_completed: hasStatus(
          db,
          existingTables,
          "checkpoint_backfill_status",
          "migration_key",
          "runtime_sessions_v1_to_checkpoint_table_v1"
        ),
        memory_payload_cleanup_completed: hasStatus(
          db,
          existingTables,
          "runtime_snapshot_cleanup_status",
          "cleanup_key",
          "runtime_sessions_v1_strip_legacy_memory_payload_v1"
        ),
        checkpoint_payload_cleanup_completed: hasStatus(
          db,
          existingTables,
          "runtime_snapshot_cleanup_status",
          "cleanup_key",
          "runtime_sessions_v1_strip_legacy_checkpoint_payload_v1"
        )
      }
    };
  } finally {
    db.close();
  }
}

function listTables(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function countRows(db: DatabaseSync, table: SqlFirstTableName): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number | bigint };
  return Number(row.count);
}

function hasStatus(
  db: DatabaseSync,
  tables: Set<string>,
  table: string,
  keyColumn: string,
  key: string
): boolean {
  if (!tables.has(table)) {
    return false;
  }
  const row = db
    .prepare(`SELECT ${keyColumn} FROM ${table} WHERE ${keyColumn} = ?`)
    .get(key) as Record<string, unknown> | undefined;
  return row !== undefined;
}

function parseSnapshot(raw: string, target: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed?.session || typeof parsed.session !== "object") {
    throw new Error(`Invalid runtime session snapshot at ${target}.`);
  }
  return parsed;
}

function hasLegacyMemoryPayload(snapshot: Record<string, unknown>): boolean {
  return snapshot.working_memory !== undefined ||
    snapshot.episodes !== undefined ||
    snapshot.semantic_memory !== undefined ||
    snapshot.procedural_memory !== undefined;
}
