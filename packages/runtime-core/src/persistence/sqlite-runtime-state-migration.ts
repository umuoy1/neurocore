import { SqliteCheckpointStore } from "../checkpoint/sqlite-checkpoint-store.js";
import { backfillSqliteCheckpointStoreFromRuntimeState } from "../checkpoint/sqlite-checkpoint-backfill.js";
import { cleanupSqliteRuntimeSnapshotLegacyPayload } from "./sqlite-runtime-snapshot-cleanup.js";
import {
  createSqliteMemoryPersistence,
  type SqliteMemoryPersistenceOptions
} from "./sqlite-memory-persistence.js";
import { backfillSqliteMemoryFromRuntimeState } from "./sqlite-memory-backfill.js";

export interface SqliteRuntimeStateMigrationOptions extends SqliteMemoryPersistenceOptions {}

export interface SqliteRuntimeStateMigrationResult {
  memorySessionsBackfilled: number;
  checkpointSessionsBackfilled: number;
  rewrittenMemorySnapshots: number;
  rewrittenCheckpointSnapshots: number;
}

export function migrateSqliteRuntimeStateToSqlFirst(
  options: SqliteRuntimeStateMigrationOptions
): SqliteRuntimeStateMigrationResult {
  const persistence = createSqliteMemoryPersistence({
    filename: options.filename,
    workingMaxEntries: options.workingMaxEntries
  });
  const checkpointStore = new SqliteCheckpointStore({
    filename: options.filename
  });

  try {
    const memorySessionsBackfilled = backfillSqliteMemoryFromRuntimeState({
      filename: options.filename,
      persistence
    });
    const checkpointSessionsBackfilled = backfillSqliteCheckpointStoreFromRuntimeState({
      filename: options.filename,
      checkpointStore
    });
    const rewrittenMemorySnapshots = cleanupSqliteRuntimeSnapshotLegacyPayload({
      filename: options.filename,
      stripMemory: true
    });
    const rewrittenCheckpointSnapshots = cleanupSqliteRuntimeSnapshotLegacyPayload({
      filename: options.filename,
      stripCheckpoints: true
    });

    return {
      memorySessionsBackfilled,
      checkpointSessionsBackfilled,
      rewrittenMemorySnapshots,
      rewrittenCheckpointSnapshots
    };
  } finally {
    (persistence.working as { close?: () => void } | undefined)?.close?.();
    (persistence.episodic as { close?: () => void } | undefined)?.close?.();
    (persistence.semantic as { close?: () => void } | undefined)?.close?.();
    (persistence.skillStore as { close?: () => void } | undefined)?.close?.();
    checkpointStore.close();
  }
}
