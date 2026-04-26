import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform } from "../../im-gateway/types.js";
import { isIMPlatform } from "../../im-gateway/types.js";
import type { ScheduleEntry } from "../types.js";

export interface SqliteScheduleStoreOptions {
  filename: string;
}

export class SqliteScheduleStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteScheduleStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proactive_schedules (
        id TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        task_description TEXT NOT NULL,
        target_user TEXT NOT NULL,
        target_platform TEXT,
        mode TEXT,
        run_at TEXT,
        enabled INTEGER NOT NULL
      );
    `);
    ensureColumn(this.db, "proactive_schedules", "mode", "TEXT");
    ensureColumn(this.db, "proactive_schedules", "run_at", "TEXT");
  }

  public upsert(entry: ScheduleEntry): void {
    this.db
      .prepare(`
        INSERT INTO proactive_schedules (
          id, cron, task_description, target_user, target_platform, mode, run_at, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cron = excluded.cron,
          task_description = excluded.task_description,
          target_user = excluded.target_user,
          target_platform = excluded.target_platform,
          mode = excluded.mode,
          run_at = excluded.run_at,
          enabled = excluded.enabled
      `)
      .run(
        entry.id,
        entry.cron,
        entry.task_description,
        entry.target_user,
        entry.target_platform ?? null,
        entry.mode ?? (entry.run_at ? "one_shot" : "recurring"),
        entry.run_at ?? null,
        entry.enabled ? 1 : 0
      );
  }

  public list(): ScheduleEntry[] {
    const rows = this.db
      .prepare(`
        SELECT id, cron, task_description, target_user, target_platform, mode, run_at, enabled
        FROM proactive_schedules
        ORDER BY id ASC
      `)
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      cron: String(row.cron),
      task_description: String(row.task_description),
      target_user: String(row.target_user),
      target_platform: normalizePlatform(row.target_platform),
      mode: normalizeMode(row.mode),
      run_at: typeof row.run_at === "string" ? row.run_at : undefined,
      enabled: Number(row.enabled) === 1
    }));
  }
}

function normalizeMode(value: unknown): ScheduleEntry["mode"] {
  if (value === "one_shot" || value === "recurring") {
    return value;
  }
  return undefined;
}

function normalizePlatform(value: unknown): IMPlatform | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (isIMPlatform(value)) {
    return value;
  }
  throw new Error(`Unsupported IM platform value: ${String(value)}`);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
