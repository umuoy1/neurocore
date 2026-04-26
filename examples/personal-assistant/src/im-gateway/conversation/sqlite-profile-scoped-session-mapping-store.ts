import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform, SessionRoute } from "../types.js";
import { isIMPlatform } from "../types.js";
import type { SessionMappingStore, SessionRouteScope } from "./session-mapping-store.js";
import { buildAgentProfileRouteScopeKey } from "./agent-profile-store.js";

export interface SqliteProfileScopedSessionMappingStoreOptions {
  filename: string;
}

export class SqliteProfileScopedSessionMappingStore implements SessionMappingStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteProfileScopedSessionMappingStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_profile_routes (
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        route_scope_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        sender_id TEXT,
        canonical_user_id TEXT,
        agent_profile_id TEXT,
        workspace_id TEXT,
        memory_scope TEXT,
        tool_scope TEXT,
        policy_scope TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        PRIMARY KEY (platform, chat_id, route_scope_key)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_profile_routes_user
        ON conversation_profile_routes (canonical_user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversation_profile_routes_profile
        ON conversation_profile_routes (agent_profile_id, workspace_id, updated_at);
    `);
  }

  public getRoute(platform: IMPlatform, chatId: string, scope?: SessionRouteScope): SessionRoute | undefined {
    const scopeKey = routeScopeKey(scope);
    const row = this.db
      .prepare(`
        SELECT platform, chat_id, route_scope_key, session_id, sender_id, canonical_user_id,
          agent_profile_id, workspace_id, memory_scope, tool_scope, policy_scope,
          created_at, updated_at, last_active_at
        FROM conversation_profile_routes
        WHERE platform = ? AND chat_id = ? AND route_scope_key = ?
      `)
      .get(platform, chatId, scopeKey) as Record<string, unknown> | undefined;

    return row ? rowToRoute(row) : undefined;
  }

  public upsertRoute(route: SessionRoute): void {
    const scopeKey = route.route_scope_key ?? routeScopeKey(route);
    this.db
      .prepare(`
        INSERT INTO conversation_profile_routes (
          platform, chat_id, route_scope_key, session_id, sender_id, canonical_user_id,
          agent_profile_id, workspace_id, memory_scope, tool_scope, policy_scope,
          created_at, updated_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, chat_id, route_scope_key) DO UPDATE SET
          session_id = excluded.session_id,
          sender_id = excluded.sender_id,
          canonical_user_id = excluded.canonical_user_id,
          agent_profile_id = excluded.agent_profile_id,
          workspace_id = excluded.workspace_id,
          memory_scope = excluded.memory_scope,
          tool_scope = excluded.tool_scope,
          policy_scope = excluded.policy_scope,
          updated_at = excluded.updated_at,
          last_active_at = excluded.last_active_at
      `)
      .run(
        route.platform,
        route.chat_id,
        scopeKey,
        route.session_id,
        route.sender_id ?? null,
        route.canonical_user_id ?? null,
        route.agent_profile_id ?? null,
        route.workspace_id ?? null,
        route.memory_scope ?? null,
        route.tool_scope ?? null,
        route.policy_scope ?? null,
        route.created_at,
        route.updated_at,
        route.last_active_at
      );
  }

  public deleteRoute(platform: IMPlatform, chatId: string, scope?: SessionRouteScope): void {
    if (scope) {
      this.db
        .prepare("DELETE FROM conversation_profile_routes WHERE platform = ? AND chat_id = ? AND route_scope_key = ?")
        .run(platform, chatId, routeScopeKey(scope));
      return;
    }
    this.db
      .prepare("DELETE FROM conversation_profile_routes WHERE platform = ? AND chat_id = ?")
      .run(platform, chatId);
  }

  public listRoutesForUser(userId: string): SessionRoute[] {
    const rows = this.db
      .prepare(`
        SELECT platform, chat_id, route_scope_key, session_id, sender_id, canonical_user_id,
          agent_profile_id, workspace_id, memory_scope, tool_scope, policy_scope,
          created_at, updated_at, last_active_at
        FROM conversation_profile_routes
        WHERE canonical_user_id = ? OR sender_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `)
      .all(userId, userId) as Array<Record<string, unknown>>;

    return rows.map(rowToRoute);
  }

  public close(): void {
    this.db.close();
  }
}

function routeScopeKey(scope: SessionRouteScope | SessionRoute | undefined): string {
  if (scope?.route_scope_key) {
    return scope.route_scope_key;
  }
  if (scope?.agent_profile_id) {
    return buildAgentProfileRouteScopeKey(scope.agent_profile_id, scope.workspace_id);
  }
  return "profile:default|workspace:default";
}

function rowToRoute(row: Record<string, unknown>): SessionRoute {
  return {
    platform: normalizePlatform(row.platform),
    chat_id: String(row.chat_id),
    route_scope_key: String(row.route_scope_key),
    session_id: String(row.session_id),
    sender_id: readOptionalString(row.sender_id),
    canonical_user_id: readOptionalString(row.canonical_user_id),
    agent_profile_id: readOptionalString(row.agent_profile_id),
    workspace_id: readOptionalString(row.workspace_id),
    memory_scope: readOptionalString(row.memory_scope),
    tool_scope: readOptionalString(row.tool_scope),
    policy_scope: readOptionalString(row.policy_scope),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_active_at: String(row.last_active_at)
  };
}

function normalizePlatform(value: unknown): IMPlatform {
  if (isIMPlatform(value)) {
    return value;
  }
  throw new Error(`Unsupported IM platform value: ${String(value)}`);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
