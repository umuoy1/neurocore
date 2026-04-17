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
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS working_memory_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        relevance REAL NOT NULL,
        created_at TEXT,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_working_session_sequence
        ON working_memory_entries(session_id, sequence DESC);
    `);
    this.ensureColumn("working_memory_entries", "created_at", "TEXT");
    this.ensureColumn("working_memory_entries", "expires_at", "TEXT");
  }

  public append(sessionId: string, entry: WorkingMemoryEntry, maxEntriesOverride?: number): void {
    this.db
      .prepare(`
        INSERT INTO working_memory_entries (session_id, memory_id, summary, relevance, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        sessionId,
        entry.memory_id,
        entry.summary,
        entry.relevance,
        entry.created_at ?? new Date().toISOString(),
        entry.expires_at ?? null
      );

    this.pruneExpired(sessionId);
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
    this.pruneExpired(sessionId);
    const rows = this.db
      .prepare(`
        SELECT memory_id, summary, relevance, created_at, expires_at
        FROM working_memory_entries
        WHERE session_id = ?
        ORDER BY sequence ASC
      `)
      .all(sessionId) as Array<{
        memory_id: string;
        summary: string;
        relevance: number;
        created_at: string | null;
        expires_at: string | null;
      }>;

    return rows.map((row) => ({
      memory_id: row.memory_id,
      summary: row.summary,
      relevance: Number(row.relevance),
      created_at: row.created_at ?? undefined,
      expires_at: row.expires_at ?? undefined
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

  private pruneExpired(sessionId: string): void {
    this.db
      .prepare(`
        DELETE FROM working_memory_entries
        WHERE session_id = ?
          AND expires_at IS NOT NULL
          AND expires_at != ''
          AND expires_at <= ?
      `)
      .run(sessionId, new Date().toISOString());
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
