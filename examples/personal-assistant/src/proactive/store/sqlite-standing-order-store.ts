import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateStandingOrderInput,
  StandingOrderPermission,
  StandingOrderQuery,
  StandingOrderRecord,
  StandingOrderScope,
  StandingOrderStatus
} from "../types.js";
import type { StandingOrderStore } from "../standing-order-store.js";
import { isIMPlatform } from "../../im-gateway/types.js";

export interface SqliteStandingOrderStoreOptions {
  filename: string;
}

export class SqliteStandingOrderStore implements StandingOrderStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteStandingOrderStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS standing_orders (
        order_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        instruction TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        status TEXT NOT NULL,
        permission_json TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_applied_at TEXT,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_standing_orders_owner_status
        ON standing_orders(owner_user_id, status, updated_at DESC, order_id DESC);
    `);
  }

  public create(input: CreateStandingOrderInput): StandingOrderRecord {
    const now = input.created_at ?? new Date().toISOString();
    const record: StandingOrderRecord = {
      order_id: `sto_${randomUUID()}`,
      owner_user_id: input.owner_user_id,
      instruction: input.instruction,
      scope: input.scope,
      status: "active",
      permission: input.permission ?? {},
      expires_at: input.expires_at,
      created_at: now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };

    this.db.prepare(`
      INSERT INTO standing_orders (
        order_id,
        owner_user_id,
        instruction,
        scope_json,
        status,
        permission_json,
        expires_at,
        created_at,
        updated_at,
        last_applied_at,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.order_id,
      record.owner_user_id,
      record.instruction,
      JSON.stringify(record.scope),
      record.status,
      JSON.stringify(record.permission),
      record.expires_at ?? null,
      record.created_at,
      record.updated_at,
      record.last_applied_at ?? null,
      JSON.stringify(record.metadata)
    );
    return record;
  }

  public get(orderId: string): StandingOrderRecord | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM standing_orders
      WHERE order_id = ?
    `).get(orderId) as unknown as StandingOrderRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  public listActive(query: StandingOrderQuery): StandingOrderRecord[] {
    const now = query.now ?? new Date().toISOString();
    const clauses = query.include_paused
      ? ["status IN ('active', 'paused')"]
      : ["status = 'active'"];
    const params: string[] = [];

    if (query.owner_user_id) {
      clauses.push("owner_user_id = ?");
      params.push(query.owner_user_id);
    }

    clauses.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(now);

    const rows = this.db.prepare(`
      SELECT *
      FROM standing_orders
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC, order_id DESC
    `).all(...params) as unknown as StandingOrderRow[];

    return rows
      .map(toRecord)
      .filter((record) => matchesScope(record.scope, query));
  }

  public updateStatus(
    orderId: string,
    status: StandingOrderStatus,
    updatedAt = new Date().toISOString()
  ): StandingOrderRecord | undefined {
    this.db.prepare(`
      UPDATE standing_orders
      SET status = ?, updated_at = ?
      WHERE order_id = ?
    `).run(status, updatedAt, orderId);
    return this.get(orderId);
  }

  public markApplied(orderId: string, appliedAt = new Date().toISOString()): StandingOrderRecord | undefined {
    this.db.prepare(`
      UPDATE standing_orders
      SET last_applied_at = ?, updated_at = ?
      WHERE order_id = ?
    `).run(appliedAt, appliedAt, orderId);
    return this.get(orderId);
  }

  public close(): void {
    this.db.close();
  }
}

interface StandingOrderRow {
  order_id: string;
  owner_user_id: string;
  instruction: string;
  scope_json: string;
  status: string;
  permission_json: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_applied_at: string | null;
  metadata_json: string;
}

function toRecord(row: StandingOrderRow): StandingOrderRecord {
  return {
    order_id: row.order_id,
    owner_user_id: row.owner_user_id,
    instruction: row.instruction,
    scope: parseScope(row.scope_json),
    status: normalizeStatus(row.status),
    permission: parsePermission(row.permission_json),
    expires_at: row.expires_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_applied_at: row.last_applied_at ?? undefined,
    metadata: parseRecord(row.metadata_json)
  };
}

function matchesScope(scope: StandingOrderScope, query: StandingOrderQuery): boolean {
  if (scope.type === "global") {
    return true;
  }
  if (scope.type === "user") {
    return !scope.user_id || !query.user_id || scope.user_id === query.user_id;
  }
  if (scope.type === "channel") {
    const platformMatches = !scope.platform || !query.platform || scope.platform === query.platform;
    const chatMatches = !scope.chat_id || !query.chat_id || scope.chat_id === query.chat_id;
    return platformMatches && chatMatches;
  }
  return false;
}

function parseScope(value: string): StandingOrderScope {
  const parsed = parseRecord(value);
  const type = parsed.type === "user" || parsed.type === "channel" ? parsed.type : "global";
  return {
    type,
    user_id: typeof parsed.user_id === "string" ? parsed.user_id : undefined,
    platform: isIMPlatform(parsed.platform) ? parsed.platform : undefined,
    chat_id: typeof parsed.chat_id === "string" ? parsed.chat_id : undefined
  };
}

function parsePermission(value: string): StandingOrderPermission {
  const parsed = parseRecord(value);
  const tools = Array.isArray(parsed.tools) ? parsed.tools.filter((item): item is string => typeof item === "string") : undefined;
  const channels = Array.isArray(parsed.channels) ? parsed.channels.filter(isIMPlatform) : undefined;
  return {
    tools,
    channels,
    requires_approval: typeof parsed.requires_approval === "boolean" ? parsed.requires_approval : undefined
  };
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeStatus(value: string): StandingOrderStatus {
  if (value === "paused" || value === "expired") {
    return value;
  }
  return "active";
}
