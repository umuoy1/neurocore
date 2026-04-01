import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface AgentProfileSummary {
  agent_id: string;
  name: string;
  version: string;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  tenant_id: string;
  affected_tools: string[];
  risk_levels: string[];
  rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConfigApiKeyEntry {
  key_id: string;
  tenant_id: string;
  role: string;
  key_prefix: string;
  expiration?: string;
  last_used_at?: string;
  status: "active" | "revoked";
  created_at: string;
}

export interface ConfigStore {
  getProfile(agentId: string): Record<string, unknown> | null;
  setProfile(agentId: string, profile: Record<string, unknown>): void;
  listProfiles(): AgentProfileSummary[];
  listPolicies(tenantId?: string): PolicyTemplate[];
  getPolicy(policyId: string): PolicyTemplate | null;
  createPolicy(policy: Omit<PolicyTemplate, "id" | "created_at" | "updated_at">): PolicyTemplate;
  updatePolicy(policyId: string, patch: Partial<PolicyTemplate>): PolicyTemplate | null;
  deletePolicy(policyId: string): boolean;
  listApiKeys(tenantId?: string): ConfigApiKeyEntry[];
  createApiKey(entry: { tenant_id: string; role: string; expiration?: string }): { key_id: string; key: string };
  revokeApiKey(keyId: string): boolean;
}

export class InMemoryConfigStore implements ConfigStore {
  private readonly profiles = new Map<string, Record<string, unknown>>();
  private readonly policies = new Map<string, PolicyTemplate>();
  private readonly apiKeys = new Map<string, ConfigApiKeyEntry & { full_key: string }>();

  public getProfile(agentId: string): Record<string, unknown> | null {
    return this.profiles.get(agentId) ?? null;
  }

  public setProfile(agentId: string, profile: Record<string, unknown>): void {
    this.profiles.set(agentId, profile);
  }

  public listProfiles(): AgentProfileSummary[] {
    return Array.from(this.profiles.entries()).map(([id, p]) => ({
      agent_id: id,
      name: (p.name as string) ?? id,
      version: (p.version as string) ?? "0.0.0",
    }));
  }

  public listPolicies(tenantId?: string): PolicyTemplate[] {
    const all = Array.from(this.policies.values());
    if (tenantId) return all.filter((p) => p.tenant_id === tenantId);
    return all;
  }

  public getPolicy(policyId: string): PolicyTemplate | null {
    return this.policies.get(policyId) ?? null;
  }

  public createPolicy(policy: Omit<PolicyTemplate, "id" | "created_at" | "updated_at">): PolicyTemplate {
    const now = new Date().toISOString();
    const full: PolicyTemplate = {
      ...policy,
      id: `pol_${randomUUID().slice(0, 8)}`,
      created_at: now,
      updated_at: now,
    };
    this.policies.set(full.id, full);
    return full;
  }

  public updatePolicy(policyId: string, patch: Partial<PolicyTemplate>): PolicyTemplate | null {
    const existing = this.policies.get(policyId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id: existing.id, updated_at: new Date().toISOString() };
    this.policies.set(policyId, updated);
    return updated;
  }

  public deletePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  public listApiKeys(tenantId?: string): ConfigApiKeyEntry[] {
    const all = Array.from(this.apiKeys.values());
    if (tenantId) return all.filter((k) => k.tenant_id === tenantId);
    return all.map(({ full_key: _, ...entry }) => entry);
  }

  public createApiKey(entry: { tenant_id: string; role: string; expiration?: string }): {
    key_id: string;
    key: string;
  } {
    const key = `nc_${randomUUID()}`;
    const key_id = `key_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const record: ConfigApiKeyEntry & { full_key: string } = {
      key_id,
      tenant_id: entry.tenant_id,
      role: entry.role,
      key_prefix: key.slice(0, 7) + "..." + key.slice(-4),
      expiration: entry.expiration,
      status: "active",
      created_at: now,
      full_key: key,
    };
    this.apiKeys.set(key_id, record);
    return { key_id, key };
  }

  public revokeApiKey(keyId: string): boolean {
    const entry = this.apiKeys.get(keyId);
    if (!entry) return false;
    entry.status = "revoked";
    return true;
  }
}

export class SqliteConfigStore implements ConfigStore {
  private readonly db: DatabaseSync;

  public constructor(options: { filename: string }) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        agent_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_templates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        role TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        full_key TEXT NOT NULL,
        expiration TEXT,
        last_used_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
    `);
  }

  public getProfile(agentId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT data FROM agent_profiles WHERE agent_id = ?").get(agentId) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
  }

  public setProfile(agentId: string, profile: Record<string, unknown>): void {
    this.db
      .prepare("INSERT INTO agent_profiles (agent_id, data) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET data = excluded.data")
      .run(agentId, JSON.stringify(profile));
  }

  public listProfiles(): AgentProfileSummary[] {
    const rows = this.db.prepare("SELECT agent_id, data FROM agent_profiles").all() as Array<{
      agent_id: string;
      data: string;
    }>;
    return rows.map((r) => {
      const p = JSON.parse(r.data) as Record<string, unknown>;
      return { agent_id: r.agent_id, name: (p.name as string) ?? r.agent_id, version: (p.version as string) ?? "0.0.0" };
    });
  }

  public listPolicies(tenantId?: string): PolicyTemplate[] {
    const sql = tenantId ? "SELECT data FROM policy_templates WHERE tenant_id = ?" : "SELECT data FROM policy_templates";
    const params = tenantId ? [tenantId] : [];
    const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as PolicyTemplate);
  }

  public getPolicy(policyId: string): PolicyTemplate | null {
    const row = this.db.prepare("SELECT data FROM policy_templates WHERE id = ?").get(policyId) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as PolicyTemplate) : null;
  }

  public createPolicy(policy: Omit<PolicyTemplate, "id" | "created_at" | "updated_at">): PolicyTemplate {
    const now = new Date().toISOString();
    const full: PolicyTemplate = { ...policy, id: `pol_${randomUUID().slice(0, 8)}`, created_at: now, updated_at: now };
    this.db
      .prepare("INSERT INTO policy_templates (id, tenant_id, data) VALUES (?, ?, ?)")
      .run(full.id, full.tenant_id, JSON.stringify(full));
    return full;
  }

  public updatePolicy(policyId: string, patch: Partial<PolicyTemplate>): PolicyTemplate | null {
    const existing = this.getPolicy(policyId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id: existing.id, updated_at: new Date().toISOString() };
    this.db.prepare("UPDATE policy_templates SET data = ? WHERE id = ?").run(JSON.stringify(updated), policyId);
    return updated;
  }

  public deletePolicy(policyId: string): boolean {
    const result = this.db.prepare("DELETE FROM policy_templates WHERE id = ?").run(policyId);
    return result.changes > 0;
  }

  public listApiKeys(tenantId?: string): ConfigApiKeyEntry[] {
    const sql = tenantId
      ? "SELECT key_id, tenant_id, role, key_prefix, expiration, last_used_at, status, created_at FROM api_keys WHERE tenant_id = ?"
      : "SELECT key_id, tenant_id, role, key_prefix, expiration, last_used_at, status, created_at FROM api_keys";
    const params = tenantId ? [tenantId] : [];
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, string | undefined>>;
    return rows.map((r) => ({
      key_id: r.key_id!,
      tenant_id: r.tenant_id!,
      role: r.role!,
      key_prefix: r.key_prefix!,
      expiration: r.expiration ?? undefined,
      last_used_at: r.last_used_at ?? undefined,
      status: (r.status as "active" | "revoked") ?? "active",
      created_at: r.created_at!,
    }));
  }

  public createApiKey(entry: { tenant_id: string; role: string; expiration?: string }): {
    key_id: string;
    key: string;
  } {
    const key = `nc_${randomUUID()}`;
    const key_id = `key_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO api_keys (key_id, tenant_id, role, key_prefix, full_key, expiration, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
      )
      .run(key_id, entry.tenant_id, entry.role, key.slice(0, 7) + "..." + key.slice(-4), key, entry.expiration ?? null, now);
    return { key_id, key };
  }

  public revokeApiKey(keyId: string): boolean {
    const result = this.db.prepare("UPDATE api_keys SET status = 'revoked' WHERE key_id = ?").run(keyId);
    return result.changes > 0;
  }

  public close(): void {
    this.db.close();
  }
}
