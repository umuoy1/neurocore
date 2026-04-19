import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ReflectionRule, ReflectionStore } from "@neurocore/protocol";

export interface SqliteReflectionStoreOptions {
  filename: string;
}

export class SqliteReflectionStore implements ReflectionStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteReflectionStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta_reflection_rules (
        rule_id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        task_bucket TEXT,
        risk_level TEXT,
        trigger_conditions_json TEXT NOT NULL,
        failure_modes_json TEXT,
        recommended_control_action TEXT NOT NULL,
        strength REAL NOT NULL,
        evidence_count INTEGER NOT NULL,
        session_id TEXT,
        cycle_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_meta_reflection_task_bucket
        ON meta_reflection_rules(task_bucket, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_meta_reflection_session
        ON meta_reflection_rules(session_id, updated_at DESC);
    `);
  }

  public save(rule: ReflectionRule) {
    this.db.prepare(`
      INSERT INTO meta_reflection_rules (
        rule_id,
        pattern,
        task_bucket,
        risk_level,
        trigger_conditions_json,
        failure_modes_json,
        recommended_control_action,
        strength,
        evidence_count,
        session_id,
        cycle_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rule_id) DO UPDATE SET
        pattern = excluded.pattern,
        task_bucket = excluded.task_bucket,
        risk_level = excluded.risk_level,
        trigger_conditions_json = excluded.trigger_conditions_json,
        failure_modes_json = excluded.failure_modes_json,
        recommended_control_action = excluded.recommended_control_action,
        strength = excluded.strength,
        evidence_count = excluded.evidence_count,
        session_id = excluded.session_id,
        cycle_id = excluded.cycle_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      rule.rule_id,
      rule.pattern,
      rule.task_bucket ?? null,
      rule.risk_level ?? null,
      JSON.stringify(rule.trigger_conditions ?? []),
      JSON.stringify(rule.failure_modes ?? []),
      rule.recommended_control_action,
      rule.strength,
      rule.evidence_count,
      rule.session_id ?? null,
      rule.cycle_id ?? null,
      rule.created_at ?? null,
      rule.updated_at ?? null
    );
  }

  public list(sessionId?: string) {
    const rows = sessionId
      ? this.db.prepare(`
          SELECT *
          FROM meta_reflection_rules
          WHERE session_id = ?
          ORDER BY updated_at DESC, rule_id DESC
        `).all(sessionId) as unknown as ReflectionRuleRow[]
      : this.db.prepare(`
          SELECT *
          FROM meta_reflection_rules
          ORDER BY updated_at DESC, rule_id DESC
        `).all() as unknown as ReflectionRuleRow[];
    return rows.map(toReflectionRule);
  }

  public findByTaskBucket(taskBucket: string, riskLevel?: string) {
    const rows = riskLevel
      ? this.db.prepare(`
          SELECT *
          FROM meta_reflection_rules
          WHERE task_bucket = ? AND (risk_level = ? OR risk_level IS NULL)
          ORDER BY strength DESC, updated_at DESC
        `).all(taskBucket, riskLevel) as unknown as ReflectionRuleRow[]
      : this.db.prepare(`
          SELECT *
          FROM meta_reflection_rules
          WHERE task_bucket = ?
          ORDER BY strength DESC, updated_at DESC
        `).all(taskBucket) as unknown as ReflectionRuleRow[];
    return rows.map(toReflectionRule);
  }

  public deleteSession(sessionId: string) {
    this.db.prepare("DELETE FROM meta_reflection_rules WHERE session_id = ?").run(sessionId);
  }

  public close() {
    this.db.close();
  }
}

interface ReflectionRuleRow {
  rule_id: string;
  pattern: string;
  task_bucket: string | null;
  risk_level: string | null;
  trigger_conditions_json: string;
  failure_modes_json: string | null;
  recommended_control_action: ReflectionRule["recommended_control_action"];
  strength: number;
  evidence_count: number;
  session_id: string | null;
  cycle_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function toReflectionRule(row: ReflectionRuleRow): ReflectionRule {
  return {
    rule_id: row.rule_id,
    pattern: row.pattern,
    task_bucket: row.task_bucket ?? undefined,
    risk_level: row.risk_level ?? undefined,
    trigger_conditions: JSON.parse(row.trigger_conditions_json),
    failure_modes: row.failure_modes_json ? JSON.parse(row.failure_modes_json) : undefined,
    recommended_control_action: row.recommended_control_action,
    strength: Number(row.strength),
    evidence_count: Number(row.evidence_count),
    session_id: row.session_id ?? undefined,
    cycle_id: row.cycle_id ?? undefined,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined
  };
}
