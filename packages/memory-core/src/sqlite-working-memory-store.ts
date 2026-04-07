import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryDigest } from "@neurocore/protocol";
import type { WorkingMemoryEntry } from "./working-memory.js";

export interface SqliteWorkingMemoryStoreOptions {
  filename: string;
  maxEntries?: number;
}

export class SqliteWorkingMemoryStore {
  private readonly db: DatabaseSync;
  private readonly maxEntries?: number;

  public constructor(options: SqliteWorkingMemoryStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.maxEntries = options.maxEntries;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS working_memory_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        relevance REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_working_session_sequence
        ON working_memory_entries(session_id, sequence DESC);
    `);
  }

  public append(sessionId: string, entry: WorkingMemoryEntry, maxEntriesOverride?: number): void {
    this.db
      .prepare(`
        INSERT INTO working_memory_entries (session_id, memory_id, summary, relevance)
        VALUES (?, ?, ?, ?)
      `)
      .run(sessionId, entry.memory_id, entry.summary, entry.relevance);

    const limit = maxEntriesOverride ?? this.maxEntries;
    if (!limit || limit <= 0) {
      return;
    }

    const total = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM working_memory_entries
        WHERE session_id = ?
      `)
      .get(sessionId) as { count: number | bigint };
    const overflow = Number(total.count) - limit;
    if (overflow <= 0) {
      return;
    }

    this.db
      .prepare(`
        DELETE FROM working_memory_entries
        WHERE sequence IN (
          SELECT sequence
          FROM working_memory_entries
          WHERE session_id = ?
          ORDER BY sequence ASC
          LIMIT ?
        )
      `)
      .run(sessionId, overflow);
  }

  public list(sessionId: string): WorkingMemoryEntry[] {
    const rows = this.db
      .prepare(`
        SELECT memory_id, summary, relevance
        FROM working_memory_entries
        WHERE session_id = ?
        ORDER BY sequence ASC
      `)
      .all(sessionId) as Array<{
        memory_id: string;
        summary: string;
        relevance: number;
      }>;

    return rows.map((row) => ({
      memory_id: row.memory_id,
      summary: row.summary,
      relevance: Number(row.relevance)
    }));
  }

  public replace(sessionId: string, entries: WorkingMemoryEntry[]): void {
    this.deleteSession(sessionId);
    for (const entry of entries) {
      this.append(sessionId, entry);
    }
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM working_memory_entries WHERE session_id = ?").run(sessionId);
  }

  public digest(sessionId: string): MemoryDigest[] {
    return this.list(sessionId).map((entry) => ({
      memory_id: entry.memory_id,
      memory_type: "working",
      summary: entry.summary,
      relevance: entry.relevance
    }));
  }

  public close(): void {
    this.db.close();
  }
}
