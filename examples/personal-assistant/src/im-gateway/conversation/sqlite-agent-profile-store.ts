import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform, PersonalChannelKind } from "../types.js";
import { isIMPlatform } from "../types.js";
import type {
  AgentProfileBinding,
  AgentProfilePolicyAuditEntry,
  AgentProfilePolicyChangeType,
  AgentProfileStore,
  AgentProfileToolPolicy,
  PersonalAgentProfile
} from "./agent-profile-store.js";

export interface SqliteAgentProfileStoreOptions {
  filename: string;
}

export class SqliteAgentProfileStore implements AgentProfileStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteAgentProfileStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        profile_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        display_name TEXT,
        memory_scope TEXT NOT NULL,
        tool_scope TEXT NOT NULL,
        policy_scope TEXT NOT NULL,
        default_workspace_id TEXT,
        tool_policy_json TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_profile_bindings (
        binding_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        priority INTEGER NOT NULL,
        user_id TEXT,
        platform TEXT,
        chat_id TEXT,
        channel_kind TEXT,
        workspace_id TEXT,
        active INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profile_bindings_match
        ON agent_profile_bindings (active, user_id, platform, chat_id, workspace_id, priority);
      CREATE TABLE IF NOT EXISTS agent_profile_policy_audit (
        audit_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        change_type TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profile_policy_audit_profile
        ON agent_profile_policy_audit (profile_id, created_at);
    `);
  }

  public upsertProfile(profile: PersonalAgentProfile): void {
    this.db
      .prepare(`
        INSERT INTO agent_profiles (
          profile_id, agent_id, tenant_id, display_name, memory_scope, tool_scope, policy_scope,
          default_workspace_id, tool_policy_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          tenant_id = excluded.tenant_id,
          display_name = excluded.display_name,
          memory_scope = excluded.memory_scope,
          tool_scope = excluded.tool_scope,
          policy_scope = excluded.policy_scope,
          default_workspace_id = excluded.default_workspace_id,
          tool_policy_json = excluded.tool_policy_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `)
      .run(
        profile.profile_id,
        profile.agent_id,
        profile.tenant_id,
        profile.display_name ?? null,
        profile.memory_scope,
        profile.tool_scope,
        profile.policy_scope,
        profile.default_workspace_id ?? null,
        encodeJson(profile.tool_policy ?? {}),
        encodeJson(profile.metadata),
        profile.created_at,
        profile.updated_at
      );
  }

  public getProfile(profileId: string): PersonalAgentProfile | undefined {
    const row = this.db
      .prepare(`
        SELECT profile_id, agent_id, tenant_id, display_name, memory_scope, tool_scope, policy_scope,
          default_workspace_id, tool_policy_json, metadata_json, created_at, updated_at
        FROM agent_profiles
        WHERE profile_id = ?
      `)
      .get(profileId) as Record<string, unknown> | undefined;

    return row ? rowToProfile(row) : undefined;
  }

  public listProfiles(): PersonalAgentProfile[] {
    const rows = this.db
      .prepare(`
        SELECT profile_id, agent_id, tenant_id, display_name, memory_scope, tool_scope, policy_scope,
          default_workspace_id, tool_policy_json, metadata_json, created_at, updated_at
        FROM agent_profiles
        ORDER BY profile_id ASC
      `)
      .all() as Array<Record<string, unknown>>;

    return rows.map(rowToProfile);
  }

  public upsertBinding(binding: AgentProfileBinding): void {
    this.db
      .prepare(`
        INSERT INTO agent_profile_bindings (
          binding_id, profile_id, priority, user_id, platform, chat_id, channel_kind, workspace_id,
          active, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(binding_id) DO UPDATE SET
          profile_id = excluded.profile_id,
          priority = excluded.priority,
          user_id = excluded.user_id,
          platform = excluded.platform,
          chat_id = excluded.chat_id,
          channel_kind = excluded.channel_kind,
          workspace_id = excluded.workspace_id,
          active = excluded.active,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `)
      .run(
        binding.binding_id,
        binding.profile_id,
        binding.priority,
        binding.user_id ?? null,
        binding.platform ?? null,
        binding.chat_id ?? null,
        binding.channel_kind ?? null,
        binding.workspace_id ?? null,
        binding.active ? 1 : 0,
        encodeJson(binding.metadata),
        binding.created_at,
        binding.updated_at
      );
  }

  public getBinding(bindingId: string): AgentProfileBinding | undefined {
    const row = this.db
      .prepare(`
        SELECT binding_id, profile_id, priority, user_id, platform, chat_id, channel_kind, workspace_id,
          active, metadata_json, created_at, updated_at
        FROM agent_profile_bindings
        WHERE binding_id = ?
      `)
      .get(bindingId) as Record<string, unknown> | undefined;

    return row ? rowToBinding(row) : undefined;
  }

  public listBindings(options: { activeOnly?: boolean; profileId?: string } = {}): AgentProfileBinding[] {
    const rows = this.db
      .prepare(`
        SELECT binding_id, profile_id, priority, user_id, platform, chat_id, channel_kind, workspace_id,
          active, metadata_json, created_at, updated_at
        FROM agent_profile_bindings
        WHERE (? = 0 OR active = 1) AND (? IS NULL OR profile_id = ?)
        ORDER BY priority DESC, updated_at DESC
      `)
      .all(options.activeOnly ? 1 : 0, options.profileId ?? null, options.profileId ?? null) as Array<Record<string, unknown>>;

    return rows.map(rowToBinding).sort(sortBindings);
  }

  public recordPolicyAudit(entry: AgentProfilePolicyAuditEntry): void {
    this.db
      .prepare(`
        INSERT INTO agent_profile_policy_audit (
          audit_id, profile_id, actor_id, change_type, before_json, after_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.audit_id,
        entry.profile_id,
        entry.actor_id,
        entry.change_type,
        encodeJson(entry.before),
        encodeJson(entry.after),
        encodeJson(entry.metadata),
        entry.created_at
      );
  }

  public listPolicyAudit(profileId?: string): AgentProfilePolicyAuditEntry[] {
    const rows = this.db
      .prepare(`
        SELECT audit_id, profile_id, actor_id, change_type, before_json, after_json, metadata_json, created_at
        FROM agent_profile_policy_audit
        WHERE (? IS NULL OR profile_id = ?)
        ORDER BY created_at DESC, audit_id DESC
      `)
      .all(profileId ?? null, profileId ?? null) as Array<Record<string, unknown>>;

    return rows.map(rowToAuditEntry);
  }

  public close(): void {
    this.db.close();
  }
}

function rowToProfile(row: Record<string, unknown>): PersonalAgentProfile {
  return {
    profile_id: String(row.profile_id),
    agent_id: String(row.agent_id),
    tenant_id: String(row.tenant_id),
    display_name: readOptionalString(row.display_name),
    memory_scope: String(row.memory_scope),
    tool_scope: String(row.tool_scope),
    policy_scope: String(row.policy_scope),
    default_workspace_id: readOptionalString(row.default_workspace_id),
    tool_policy: decodeJsonObject<AgentProfileToolPolicy>(row.tool_policy_json),
    metadata: decodeJsonObject(row.metadata_json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function rowToBinding(row: Record<string, unknown>): AgentProfileBinding {
  return {
    binding_id: String(row.binding_id),
    profile_id: String(row.profile_id),
    priority: Number(row.priority),
    user_id: readOptionalString(row.user_id),
    platform: normalizePlatform(row.platform),
    chat_id: readOptionalString(row.chat_id),
    channel_kind: normalizeChannelKind(row.channel_kind),
    workspace_id: readOptionalString(row.workspace_id),
    active: Number(row.active) === 1,
    metadata: decodeJsonObject(row.metadata_json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function rowToAuditEntry(row: Record<string, unknown>): AgentProfilePolicyAuditEntry {
  return {
    audit_id: String(row.audit_id),
    profile_id: String(row.profile_id),
    actor_id: String(row.actor_id),
    change_type: normalizeChangeType(row.change_type),
    before: decodeJsonObject(row.before_json),
    after: decodeJsonObject(row.after_json),
    metadata: decodeJsonObject(row.metadata_json),
    created_at: String(row.created_at)
  };
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function decodeJsonObject<T extends object = Record<string, unknown>>(value: unknown): T {
  if (typeof value !== "string" || value.length === 0) {
    return {} as T;
  }
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : {} as T;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function normalizeChannelKind(value: unknown): PersonalChannelKind | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "cli" || value === "im" || value === "web") {
    return value;
  }
  throw new Error(`Unsupported channel kind value: ${String(value)}`);
}

function normalizeChangeType(value: unknown): AgentProfilePolicyChangeType {
  if (
    value === "tool_policy_update" ||
    value === "policy_scope_update" ||
    value === "approval_policy_update" ||
    value === "channel_policy_update"
  ) {
    return value;
  }
  throw new Error(`Unsupported agent profile policy change type: ${String(value)}`);
}

function sortBindings(left: AgentProfileBinding, right: AgentProfileBinding): number {
  const priorityDelta = right.priority - left.priority;
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  const specificityDelta = bindingSpecificity(right) - bindingSpecificity(left);
  if (specificityDelta !== 0) {
    return specificityDelta;
  }
  return right.updated_at.localeCompare(left.updated_at);
}

function bindingSpecificity(binding: AgentProfileBinding): number {
  return [
    binding.user_id,
    binding.platform,
    binding.chat_id,
    binding.channel_kind,
    binding.workspace_id
  ].filter(Boolean).length;
}
