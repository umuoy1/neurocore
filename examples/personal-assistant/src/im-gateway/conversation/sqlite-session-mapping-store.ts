import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform, SessionRoute } from "../types.js";
import { isIMPlatform } from "../types.js";
import type { SessionMappingStore } from "./session-mapping-store.js";

export interface SqliteSessionMappingStoreOptions {
  filename: string;
}

export class SqliteSessionMappingStore implements SessionMappingStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteSessionMappingStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_routes (
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        sender_id TEXT,
        canonical_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        PRIMARY KEY (platform, chat_id)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_routes_user
        ON conversation_routes (canonical_user_id, updated_at);
    `);
  }

  public getRoute(platform: IMPlatform, chatId: string): SessionRoute | undefined {
    return this.db
      .prepare(`
        SELECT platform, chat_id, session_id, sender_id, canonical_user_id, created_at, updated_at, last_active_at
        FROM conversation_routes
        WHERE platform = ? AND chat_id = ?
      `)
      .get(platform, chatId) as SessionRoute | undefined;
  }

  public upsertRoute(route: SessionRoute): void {
    this.db
      .prepare(`
        INSERT INTO conversation_routes (
          platform, chat_id, session_id, sender_id, canonical_user_id, created_at, updated_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, chat_id) DO UPDATE SET
          session_id = excluded.session_id,
          sender_id = excluded.sender_id,
          canonical_user_id = excluded.canonical_user_id,
          updated_at = excluded.updated_at,
          last_active_at = excluded.last_active_at
      `)
      .run(
        route.platform,
        route.chat_id,
        route.session_id,
        route.sender_id ?? null,
        route.canonical_user_id ?? null,
        route.created_at,
        route.updated_at,
        route.last_active_at
      );
  }

  public deleteRoute(platform: IMPlatform, chatId: string): void {
    this.db
      .prepare("DELETE FROM conversation_routes WHERE platform = ? AND chat_id = ?")
      .run(platform, chatId);
  }

  public listRoutesForUser(userId: string): SessionRoute[] {
    const rows = this.db
      .prepare(`
        SELECT platform, chat_id, session_id, sender_id, canonical_user_id, created_at, updated_at, last_active_at
        FROM conversation_routes
        WHERE canonical_user_id = ? OR sender_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `)
      .all(userId, userId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      platform: normalizePlatform(row.platform),
      chat_id: String(row.chat_id),
      session_id: String(row.session_id),
      sender_id: typeof row.sender_id === "string" ? row.sender_id : undefined,
      canonical_user_id: typeof row.canonical_user_id === "string" ? row.canonical_user_id : undefined,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      last_active_at: String(row.last_active_at)
    }));
  }
}

function normalizePlatform(value: unknown): IMPlatform {
  if (isIMPlatform(value)) {
    return value;
  }
  throw new Error(`Unsupported IM platform value: ${String(value)}`);
}
