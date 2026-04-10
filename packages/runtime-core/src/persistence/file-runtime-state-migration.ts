import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Episode,
  ProceduralMemorySnapshot,
  RuntimeSessionSnapshot,
  SemanticMemorySnapshot,
  SessionCheckpoint,
  WorkingMemoryRecord
} from "@neurocore/protocol";
import { SqliteCheckpointStore } from "../checkpoint/sqlite-checkpoint-store.js";
import {
  createSqliteMemoryPersistence,
  type SqliteMemoryPersistenceOptions
} from "./sqlite-memory-persistence.js";
import { FileRuntimeStateStore } from "./file-runtime-state-store.js";

export interface FileRuntimeStateMigrationOptions extends SqliteMemoryPersistenceOptions {
  directory: string;
}

export interface FileRuntimeStateMigrationResult {
  memorySessionsBackfilled: number;
  checkpointSessionsBackfilled: number;
  rewrittenMemorySnapshots: number;
  rewrittenCheckpointSnapshots: number;
}

export function migrateFileRuntimeStateToSqlFirst(
  options: FileRuntimeStateMigrationOptions
): FileRuntimeStateMigrationResult {
  const stateStore = new FileRuntimeStateStore({ directory: options.directory });
  const persistence = createSqliteMemoryPersistence({
    filename: options.filename,
    workingMaxEntries: options.workingMaxEntries
  });
  const checkpointStore = new SqliteCheckpointStore({
    filename: options.filename
  });

  try {
    const snapshots = listLegacySnapshots(options.directory);
    let memorySessionsBackfilled = 0;
    let checkpointSessionsBackfilled = 0;
    let rewrittenMemorySnapshots = 0;
    let rewrittenCheckpointSnapshots = 0;

    for (const snapshot of snapshots) {
      const sessionId = snapshot.session.session_id;
      const tenantId = snapshot.session.tenant_id;
      const hasLegacyMemory =
        snapshot.working_memory !== undefined ||
        snapshot.episodes !== undefined ||
        snapshot.semantic_memory !== undefined ||
        snapshot.procedural_memory !== undefined;
      const hasLegacyCheckpoints = snapshot.checkpoints !== undefined;

      if (snapshot.working_memory && persistence.working) {
        persistence.working.replace(
          sessionId,
          structuredClone(snapshot.working_memory)
        );
      }

      if (snapshot.episodes && persistence.episodic) {
        persistence.episodic.replace(
          sessionId,
          tenantId,
          structuredClone(snapshot.episodes)
        );
      }

      if (persistence.semantic) {
        if (snapshot.semantic_memory) {
          persistence.semantic.restoreSnapshot(
            sessionId,
            tenantId,
            structuredClone(snapshot.semantic_memory)
          );
        } else if (snapshot.episodes) {
          persistence.semantic.replaceSession(
            sessionId,
            tenantId,
            structuredClone(snapshot.episodes)
          );
        }
      }

      if (snapshot.procedural_memory?.skills?.length && persistence.skillStore) {
        for (const skill of structuredClone(snapshot.procedural_memory).skills) {
          persistence.skillStore.save(skill);
        }
      }

      if (snapshot.checkpoints?.length) {
        for (const checkpoint of structuredClone(snapshot.checkpoints)) {
          checkpointStore.save(checkpoint);
        }
      }

      if (hasLegacyMemory) {
        delete snapshot.working_memory;
        delete snapshot.episodes;
        delete snapshot.semantic_memory;
        delete snapshot.procedural_memory;
        memorySessionsBackfilled += 1;
        rewrittenMemorySnapshots += 1;
      }

      if (hasLegacyCheckpoints) {
        delete snapshot.checkpoints;
        checkpointSessionsBackfilled += 1;
        rewrittenCheckpointSnapshots += 1;
      }

      if (hasLegacyMemory || hasLegacyCheckpoints) {
        stateStore.saveSession(snapshot);
      }
    }

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

function listLegacySnapshots(directory: string): LegacyRuntimeSessionSnapshot[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => parseSnapshot(readFileSync(join(directory, entry), "utf8"), entry));
}

function parseSnapshot(raw: string, target: string): LegacyRuntimeSessionSnapshot {
  const parsed = JSON.parse(raw) as LegacyRuntimeSessionSnapshot;
  if (!parsed?.session?.session_id) {
    throw new Error(`Invalid runtime session snapshot at ${target}.`);
  }
  return parsed;
}

interface LegacyRuntimeSessionSnapshot extends RuntimeSessionSnapshot {
  working_memory?: WorkingMemoryRecord[];
  episodes?: Episode[];
  semantic_memory?: SemanticMemorySnapshot;
  procedural_memory?: ProceduralMemorySnapshot;
  checkpoints?: SessionCheckpoint[];
}
