import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform, PlatformUserLink } from "../types.js";
import type { PlatformUserLinkStore } from "./platform-user-link-store.js";

export interface SqlitePlatformUserLinkStoreOptions {
  filename: string;
}

export class SqlitePlatformUserLinkStore implements PlatformUserLinkStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqlitePlatformUserLinkStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platform_user_links (
        platform TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        canonical_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, sender_id)
      );
      CREATE INDEX IF NOT EXISTS idx_platform_user_links_canonical
        ON platform_user_links (canonical_user_id, updated_at);
    `);
  }

  public resolveCanonicalUserId(platform: IMPlatform, senderId: string): string | undefined {
    const row = this.db
      .prepare(`
        SELECT canonical_user_id
        FROM platform_user_links
        WHERE platform = ? AND sender_id = ?
      `)
      .get(platform, senderId) as { canonical_user_id: string } | undefined;
    return row?.canonical_user_id;
  }

  public upsertLink(link: PlatformUserLink): void {
    this.db
      .prepare(`
        INSERT INTO platform_user_links (
          platform, sender_id, canonical_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(platform, sender_id) DO UPDATE SET
          canonical_user_id = excluded.canonical_user_id,
          updated_at = excluded.updated_at
      `)
      .run(
        link.platform,
        link.sender_id,
        link.canonical_user_id,
        link.created_at,
        link.updated_at
      );
  }

  public listLinks(canonicalUserId: string): PlatformUserLink[] {
    const rows = this.db
      .prepare(`
        SELECT platform, sender_id, canonical_user_id, created_at, updated_at
        FROM platform_user_links
        WHERE canonical_user_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `)
      .all(canonicalUserId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      platform: normalizePlatform(row.platform),
      sender_id: String(row.sender_id),
      canonical_user_id: String(row.canonical_user_id),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    }));
  }
}

function normalizePlatform(value: unknown): IMPlatform {
  if (value === "feishu" || value === "web") {
    return value;
  }
  throw new Error(`Unsupported IM platform value: ${String(value)}`);
}
