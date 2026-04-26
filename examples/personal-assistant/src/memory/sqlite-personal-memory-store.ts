import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PersonalMemoryRecord,
  PersonalMemorySource,
  PersonalMemoryStore,
  RememberPersonalMemoryInput
} from "./personal-memory-store.js";
import { isIMPlatform } from "../im-gateway/types.js";

export interface SqlitePersonalMemoryStoreOptions {
  filename: string;
}

export class SqlitePersonalMemoryStore implements PersonalMemoryStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqlitePersonalMemoryStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_memories (
        memory_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        correction_of TEXT,
        source_platform TEXT,
        source_chat_id TEXT,
        source_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tombstoned_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_personal_memories_user_status_updated
        ON personal_memories(user_id, status, updated_at DESC, memory_id DESC);
    `);
  }

  public remember(input: RememberPersonalMemoryInput): PersonalMemoryRecord {
    const now = input.created_at ?? new Date().toISOString();
    const record: PersonalMemoryRecord = {
      memory_id: `pmem_${randomUUID()}`,
      user_id: input.user_id,
      content: input.content.trim(),
      status: "active",
      correction_of: input.correction_of,
      source: input.source,
      created_at: now,
      updated_at: now
    };

    this.db
      .prepare(`
        INSERT INTO personal_memories (
          memory_id,
          user_id,
          content,
          status,
          correction_of,
          source_platform,
          source_chat_id,
          source_message_id,
          created_at,
          updated_at,
          tombstoned_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.memory_id,
        record.user_id,
        record.content,
        record.status,
        record.correction_of ?? null,
        record.source?.platform ?? null,
        record.source?.chat_id ?? null,
        record.source?.message_id ?? null,
        record.created_at,
        record.updated_at,
        record.tombstoned_at ?? null
      );

    return record;
  }

  public listActive(userId: string, limit = 12): PersonalMemoryRecord[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ? AND status = 'active'
        ORDER BY updated_at DESC, memory_id DESC
        LIMIT ?
      `)
      .all(userId, Math.max(1, limit)) as unknown as PersonalMemoryRow[];
    return rows.map(toRecord);
  }

  public forget(userId: string, target: string, forgottenAt = new Date().toISOString()): PersonalMemoryRecord[] {
    const matched = this.findActiveMatches(userId, target);
    if (matched.length === 0) {
      return [];
    }

    const update = this.db.prepare(`
      UPDATE personal_memories
      SET status = 'tombstoned',
          updated_at = ?,
          tombstoned_at = ?
      WHERE memory_id = ? AND user_id = ? AND status = 'active'
    `);

    for (const record of matched) {
      update.run(forgottenAt, forgottenAt, record.memory_id, userId);
    }

    return matched.map((record) => ({
      ...record,
      status: "tombstoned",
      updated_at: forgottenAt,
      tombstoned_at: forgottenAt
    }));
  }

  public correct(
    userId: string,
    target: string,
    content: string,
    source?: PersonalMemorySource,
    correctedAt = new Date().toISOString()
  ): { forgotten: PersonalMemoryRecord[]; memory: PersonalMemoryRecord } {
    const forgotten = this.forget(userId, target, correctedAt);
    const memory = this.remember({
      user_id: userId,
      content,
      correction_of: forgotten[0]?.memory_id,
      source,
      created_at: correctedAt
    });
    return { forgotten, memory };
  }

  public close(): void {
    this.db.close();
  }

  private findActiveMatches(userId: string, target: string): PersonalMemoryRecord[] {
    const normalized = target.trim();
    if (normalized.length === 0) {
      return [];
    }

    if (normalized.toLowerCase() === "all") {
      return this.listActive(userId, 1000);
    }

    const exact = this.db
      .prepare(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ? AND status = 'active' AND memory_id = ?
      `)
      .all(userId, normalized) as unknown as PersonalMemoryRow[];
    if (exact.length > 0) {
      return exact.map(toRecord);
    }

    const query = `%${escapeLike(normalized.toLowerCase())}%`;
    const rows = this.db
      .prepare(`
        SELECT *
        FROM personal_memories
        WHERE user_id = ?
          AND status = 'active'
          AND lower(content) LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC, memory_id DESC
      `)
      .all(userId, query) as unknown as PersonalMemoryRow[];
    return rows.map(toRecord);
  }
}

interface PersonalMemoryRow {
  memory_id: string;
  user_id: string;
  content: string;
  status: string;
  correction_of: string | null;
  source_platform: string | null;
  source_chat_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  tombstoned_at: string | null;
}

function toRecord(row: PersonalMemoryRow): PersonalMemoryRecord {
  const platform = isIMPlatform(row.source_platform)
    ? row.source_platform
    : undefined;
  const source: PersonalMemorySource | undefined = row.source_platform || row.source_chat_id || row.source_message_id
    ? {
        platform,
        chat_id: row.source_chat_id ?? undefined,
        message_id: row.source_message_id ?? undefined
      }
    : undefined;

  return {
    memory_id: row.memory_id,
    user_id: row.user_id,
    content: row.content,
    status: row.status === "tombstoned" ? "tombstoned" : "active",
    correction_of: row.correction_of ?? undefined,
    source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tombstoned_at: row.tombstoned_at ?? undefined
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
