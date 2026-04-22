import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SkillPolicyState } from "@neurocore/protocol";
import type { SkillPolicyStateStore } from "./skill-policy-store.js";

export interface SqliteSkillPolicyStateStoreOptions {
  filename: string;
}

export class SqliteSkillPolicyStateStore implements SkillPolicyStateStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteSkillPolicyStateStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_policy_context_states (
        tenant_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        context_key TEXT NOT NULL,
        goal_type TEXT,
        domain TEXT,
        action_type TEXT,
        tool_name TEXT,
        risk_level TEXT,
        q_value REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        average_reward REAL NOT NULL,
        selection_count INTEGER NOT NULL,
        exploit_count INTEGER NOT NULL,
        explore_count INTEGER NOT NULL,
        last_selected_at TEXT,
        last_reward_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, skill_id, context_key)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_policy_context_tenant_updated
        ON skill_policy_context_states(tenant_id, updated_at DESC);
    `);
  }

  public save(state: SkillPolicyState): void {
    this.db.prepare(`
      INSERT INTO skill_policy_context_states (
        tenant_id,
        skill_id,
        context_key,
        goal_type,
        domain,
        action_type,
        tool_name,
        risk_level,
        q_value,
        sample_count,
        success_count,
        failure_count,
        average_reward,
        selection_count,
        exploit_count,
        explore_count,
        last_selected_at,
        last_reward_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, skill_id, context_key) DO UPDATE SET
        goal_type = excluded.goal_type,
        domain = excluded.domain,
        action_type = excluded.action_type,
        tool_name = excluded.tool_name,
        risk_level = excluded.risk_level,
        q_value = excluded.q_value,
        sample_count = excluded.sample_count,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        average_reward = excluded.average_reward,
        selection_count = excluded.selection_count,
        exploit_count = excluded.exploit_count,
        explore_count = excluded.explore_count,
        last_selected_at = excluded.last_selected_at,
        last_reward_at = excluded.last_reward_at,
        updated_at = excluded.updated_at
    `).run(
      state.tenant_id,
      state.skill_id,
      state.context_key ?? "__global__",
      state.goal_type ?? null,
      state.domain ?? null,
      state.action_type ?? null,
      state.tool_name ?? null,
      state.risk_level ?? null,
      state.q_value,
      state.sample_count,
      state.success_count,
      state.failure_count,
      state.average_reward,
      state.selection_count,
      state.exploit_count,
      state.explore_count,
      state.last_selected_at ?? null,
      state.last_reward_at ?? null,
      state.updated_at
    );
  }

  public get(tenantId: string, skillId: string, contextKey?: string): SkillPolicyState | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM skill_policy_context_states
      WHERE tenant_id = ? AND skill_id = ? AND context_key = ?
    `).get(tenantId, skillId, contextKey ?? "__global__") as SqliteSkillPolicyRow | undefined;
    return row ? toPolicyState(row) : undefined;
  }

  public list(tenantId: string): SkillPolicyState[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM skill_policy_context_states
      WHERE tenant_id = ?
      ORDER BY updated_at DESC, skill_id ASC
    `).all(tenantId) as unknown as SqliteSkillPolicyRow[];
    return rows.map(toPolicyState);
  }

  public deleteTenant(tenantId: string): void {
    this.db.prepare("DELETE FROM skill_policy_context_states WHERE tenant_id = ?").run(tenantId);
  }

  public close(): void {
    this.db.close();
  }
}

interface SqliteSkillPolicyRow {
  tenant_id: string;
  skill_id: string;
  context_key: string;
  goal_type: string | null;
  domain: string | null;
  action_type: string | null;
  tool_name: string | null;
  risk_level: string | null;
  q_value: number;
  sample_count: number;
  success_count: number;
  failure_count: number;
  average_reward: number;
  selection_count: number;
  exploit_count: number;
  explore_count: number;
  last_selected_at: string | null;
  last_reward_at: string | null;
  updated_at: string;
}

function toPolicyState(row: SqliteSkillPolicyRow): SkillPolicyState {
  return {
    tenant_id: row.tenant_id,
    skill_id: row.skill_id,
    context_key: row.context_key === "__global__" ? undefined : row.context_key,
    goal_type: row.goal_type ?? undefined,
    domain: row.domain ?? undefined,
    action_type: row.action_type ?? undefined,
    tool_name: row.tool_name ?? undefined,
    risk_level: row.risk_level as SkillPolicyState["risk_level"] | null ?? undefined,
    q_value: Number(row.q_value),
    sample_count: Number(row.sample_count),
    success_count: Number(row.success_count),
    failure_count: Number(row.failure_count),
    average_reward: Number(row.average_reward),
    selection_count: Number(row.selection_count),
    exploit_count: Number(row.exploit_count),
    explore_count: Number(row.explore_count),
    last_selected_at: row.last_selected_at ?? undefined,
    last_reward_at: row.last_reward_at ?? undefined,
    updated_at: row.updated_at
  };
}
