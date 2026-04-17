import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RuntimeSessionSnapshot, RuntimeStateStore } from "@neurocore/protocol";

export interface SqliteRuntimeStateStoreOptions {
  filename: string;
}

export class SqliteRuntimeStateStore implements RuntimeStateStore {
  private readonly db: DatabaseSync;
  private readonly filename: string;

  public constructor(options: SqliteRuntimeStateStoreOptions) {
    this.filename = options.filename;
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_sessions (
        session_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public getSession(sessionId: string): RuntimeSessionSnapshot | undefined {
    const row = this.db
      .prepare("SELECT snapshot_json FROM runtime_sessions WHERE session_id = ?")
      .get(sessionId) as { snapshot_json: string } | undefined;

    if (!row) {
      return undefined;
    }

    return parseSnapshot(row.snapshot_json, sessionId);
  }

  public listSessions(): RuntimeSessionSnapshot[] {
    const rows = this.db
      .prepare("SELECT snapshot_json, session_id FROM runtime_sessions ORDER BY updated_at ASC, session_id ASC")
      .all() as Array<{ snapshot_json: string; session_id: string }>;

    return rows.map((row) => parseSnapshot(row.snapshot_json, row.session_id));
  }

  public saveSession(snapshot: RuntimeSessionSnapshot): void {
    this.db
      .prepare(`
        INSERT INTO runtime_sessions (session_id, snapshot_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `)
      .run(
        snapshot.session.session_id,
        JSON.stringify(snapshot, null, 2),
        new Date().toISOString()
      );
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM runtime_sessions WHERE session_id = ?").run(sessionId);
  }

  public close(): void {
    this.db.close();
  }

  public getFilename(): string {
    return this.filename;
  }
}

function parseSnapshot(raw: string, target: string): RuntimeSessionSnapshot {
  const parsed = JSON.parse(raw) as RuntimeSessionSnapshot;
  if (!parsed?.session?.session_id) {
    throw new Error(`Invalid runtime session snapshot at ${target}.`);
  }
  return parsed;
}
