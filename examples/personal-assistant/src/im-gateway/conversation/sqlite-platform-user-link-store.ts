import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform, PlatformHomeChannel, PlatformIdentityAuditEvent, PlatformPairingCode, PlatformUserLink } from "../types.js";
import { isIMPlatform } from "../types.js";
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
      CREATE TABLE IF NOT EXISTS platform_pairing_codes (
        code TEXT PRIMARY KEY,
        canonical_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        consumed_platform TEXT,
        consumed_sender_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_platform_pairing_codes_canonical
        ON platform_pairing_codes (canonical_user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS platform_home_channels (
        canonical_user_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform_identity_audit_events (
        audit_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        platform TEXT,
        sender_id TEXT,
        canonical_user_id TEXT,
        chat_id TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_platform_identity_audit_canonical
        ON platform_identity_audit_events (canonical_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_platform_identity_audit_sender
        ON platform_identity_audit_events (platform, sender_id, created_at DESC);
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

  public deleteLink(platform: IMPlatform, senderId: string): void {
    this.db
      .prepare(`
        DELETE FROM platform_user_links
        WHERE platform = ? AND sender_id = ?
      `)
      .run(platform, senderId);
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

  public createPairingCode(code: PlatformPairingCode): void {
    this.db
      .prepare(`
        INSERT INTO platform_pairing_codes (
          code, canonical_user_id, created_at, expires_at, consumed_at, consumed_platform, consumed_sender_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        code.code,
        code.canonical_user_id,
        code.created_at,
        code.expires_at,
        code.consumed_at ?? null,
        code.consumed_platform ?? null,
        code.consumed_sender_id ?? null
      );
  }

  public consumePairingCode(code: string, input: { platform: IMPlatform; sender_id: string; consumed_at: string }): PlatformPairingCode | undefined {
    const row = this.db
      .prepare(`
        SELECT code, canonical_user_id, created_at, expires_at, consumed_at, consumed_platform, consumed_sender_id
        FROM platform_pairing_codes
        WHERE code = ?
      `)
      .get(code) as PairingCodeRow | undefined;
    if (!row || row.consumed_at || Date.parse(row.expires_at) < Date.parse(input.consumed_at)) {
      return undefined;
    }

    this.db
      .prepare(`
        UPDATE platform_pairing_codes
        SET consumed_at = ?, consumed_platform = ?, consumed_sender_id = ?
        WHERE code = ?
      `)
      .run(input.consumed_at, input.platform, input.sender_id, code);

    return {
      code: row.code,
      canonical_user_id: row.canonical_user_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      consumed_at: input.consumed_at,
      consumed_platform: input.platform,
      consumed_sender_id: input.sender_id
    };
  }

  public setHomeChannel(channel: PlatformHomeChannel): void {
    this.db
      .prepare(`
        INSERT INTO platform_home_channels (
          canonical_user_id, platform, chat_id, sender_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_user_id) DO UPDATE SET
          platform = excluded.platform,
          chat_id = excluded.chat_id,
          sender_id = excluded.sender_id,
          updated_at = excluded.updated_at
      `)
      .run(
        channel.canonical_user_id,
        channel.platform,
        channel.chat_id,
        channel.sender_id,
        channel.created_at,
        channel.updated_at
      );
  }

  public getHomeChannel(canonicalUserId: string): PlatformHomeChannel | undefined {
    const row = this.db
      .prepare(`
        SELECT canonical_user_id, platform, chat_id, sender_id, created_at, updated_at
        FROM platform_home_channels
        WHERE canonical_user_id = ?
      `)
      .get(canonicalUserId) as HomeChannelRow | undefined;
    return row ? {
      canonical_user_id: row.canonical_user_id,
      platform: normalizePlatform(row.platform),
      chat_id: row.chat_id,
      sender_id: row.sender_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    } : undefined;
  }

  public recordAuditEvent(event: PlatformIdentityAuditEvent): void {
    this.db
      .prepare(`
        INSERT INTO platform_identity_audit_events (
          audit_id, event_type, platform, sender_id, canonical_user_id, chat_id, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.audit_id,
        event.event_type,
        event.platform ?? null,
        event.sender_id ?? null,
        event.canonical_user_id ?? null,
        event.chat_id ?? null,
        event.created_at,
        JSON.stringify(event.metadata)
      );
  }

  public listAuditEvents(input: { canonical_user_id?: string; platform?: IMPlatform; sender_id?: string; limit?: number } = {}): PlatformIdentityAuditEvent[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (input.canonical_user_id) {
      clauses.push("canonical_user_id = ?");
      params.push(input.canonical_user_id);
    }
    if (input.platform) {
      clauses.push("platform = ?");
      params.push(input.platform);
    }
    if (input.sender_id) {
      clauses.push("sender_id = ?");
      params.push(input.sender_id);
    }
    params.push(Math.max(1, input.limit ?? 50));
    const rows = this.db
      .prepare(`
        SELECT audit_id, event_type, platform, sender_id, canonical_user_id, chat_id, created_at, metadata_json
        FROM platform_identity_audit_events
        ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY created_at DESC, audit_id DESC
        LIMIT ?
      `)
      .all(...params) as unknown as AuditEventRow[];
    return rows.map(toAuditEvent);
  }
}

interface PairingCodeRow {
  code: string;
  canonical_user_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_platform: string | null;
  consumed_sender_id: string | null;
}

interface HomeChannelRow {
  canonical_user_id: string;
  platform: string;
  chat_id: string;
  sender_id: string;
  created_at: string;
  updated_at: string;
}

interface AuditEventRow {
  audit_id: string;
  event_type: string;
  platform: string | null;
  sender_id: string | null;
  canonical_user_id: string | null;
  chat_id: string | null;
  created_at: string;
  metadata_json: string;
}

function toAuditEvent(row: AuditEventRow): PlatformIdentityAuditEvent {
  return {
    audit_id: row.audit_id,
    event_type: normalizeAuditEventType(row.event_type),
    platform: row.platform ? normalizePlatform(row.platform) : undefined,
    sender_id: row.sender_id ?? undefined,
    canonical_user_id: row.canonical_user_id ?? undefined,
    chat_id: row.chat_id ?? undefined,
    created_at: row.created_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

function normalizeAuditEventType(value: string): PlatformIdentityAuditEvent["event_type"] {
  if (value === "pair_code_created" || value === "paired" || value === "revoked" || value === "home_channel_set" || value === "blocked_unpaired") {
    return value;
  }
  throw new Error(`Unsupported identity audit event type: ${value}`);
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizePlatform(value: unknown): IMPlatform {
  if (isIMPlatform(value)) {
    return value;
  }
  throw new Error(`Unsupported IM platform value: ${String(value)}`);
}
