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
        enabled INTEGER NOT NULL
      );
    `);
  }

  public upsert(entry: ScheduleEntry): void {
    this.db
      .prepare(`
        INSERT INTO proactive_schedules (
          id, cron, task_description, target_user, target_platform, enabled
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cron = excluded.cron,
          task_description = excluded.task_description,
          target_user = excluded.target_user,
          target_platform = excluded.target_platform,
          enabled = excluded.enabled
      `)
      .run(
        entry.id,
        entry.cron,
        entry.task_description,
        entry.target_user,
        entry.target_platform ?? null,
        entry.enabled ? 1 : 0
      );
  }

  public list(): ScheduleEntry[] {
    const rows = this.db
      .prepare(`
        SELECT id, cron, task_description, target_user, target_platform, enabled
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
      enabled: Number(row.enabled) === 1
    }));
  }
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
