import {
  SqliteEpisodicMemoryStore,
  SqliteSemanticMemoryStore,
  SqliteWorkingMemoryStore,
  type EpisodicMemoryPersistenceStore,
  type SemanticMemoryPersistenceStore,
  type WorkingMemoryPersistenceStore
} from "@neurocore/memory-core";
import { SqliteSkillStore } from "../skill/sqlite-skill-store.js";
import type { SkillStore } from "@neurocore/protocol";

export interface AgentMemoryPersistence {
  working?: WorkingMemoryPersistenceStore;
  episodic?: EpisodicMemoryPersistenceStore;
  semantic?: SemanticMemoryPersistenceStore;
  skillStore?: SkillStore;
}

export interface SqliteMemoryPersistenceOptions {
  filename: string;
  workingMaxEntries?: number;
}

export function createSqliteMemoryPersistence(
  options: SqliteMemoryPersistenceOptions
): AgentMemoryPersistence {
  return {
    working: new SqliteWorkingMemoryStore({
      filename: options.filename,
      maxEntries: options.workingMaxEntries
    }),
    episodic: new SqliteEpisodicMemoryStore({
      filename: options.filename
    }),
    semantic: new SqliteSemanticMemoryStore({
      filename: options.filename
    }),
    skillStore: new SqliteSkillStore({
      filename: options.filename
    })
  };
}
