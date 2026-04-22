import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SkillDefinition, SkillStore, TriggerCondition } from "@neurocore/protocol";

export interface SqliteSkillStoreOptions {
  filename: string;
}

export class SqliteSkillStore implements SkillStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteSkillStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS procedural_skills (
        skill_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT,
        kind TEXT NOT NULL,
        description TEXT,
        required_inputs_json TEXT,
        applicable_domains_json TEXT,
        risk_level TEXT,
        execution_template_json TEXT NOT NULL,
        fallback_policy_json TEXT,
        evaluation_metrics_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS procedural_skill_triggers (
        skill_id TEXT NOT NULL,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        value_text TEXT,
        value_number REAL,
        value_bool INTEGER,
        PRIMARY KEY (skill_id, field, operator, value_text, value_number, value_bool)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_tenant_kind
        ON procedural_skills(tenant_id, kind, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_skill_trigger_lookup
        ON procedural_skill_triggers(skill_id, field, operator);
    `);
    ensureColumn(this.db, "procedural_skills", "status", "TEXT");
    ensureColumn(this.db, "procedural_skills", "required_inputs_json", "TEXT");
    ensureColumn(this.db, "procedural_skills", "applicable_domains_json", "TEXT");
    ensureColumn(this.db, "procedural_skills", "fallback_policy_json", "TEXT");
    ensureColumn(this.db, "procedural_skills", "evaluation_metrics_json", "TEXT");
  }

  public save(skill: SkillDefinition): void {
    const tenantId = readTenantId(skill);
    const now = new Date().toISOString();
    const existingCreatedAt = this.db
      .prepare("SELECT created_at FROM procedural_skills WHERE skill_id = ?")
      .get(skill.skill_id) as { created_at: string } | undefined;

    this.db
      .prepare(`
        INSERT INTO procedural_skills (
          skill_id,
          tenant_id,
          name,
          version,
          status,
          kind,
          description,
          required_inputs_json,
          applicable_domains_json,
          risk_level,
          execution_template_json,
          fallback_policy_json,
          evaluation_metrics_json,
          metadata_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          name = excluded.name,
          version = excluded.version,
          status = excluded.status,
          kind = excluded.kind,
          description = excluded.description,
          required_inputs_json = excluded.required_inputs_json,
          applicable_domains_json = excluded.applicable_domains_json,
          risk_level = excluded.risk_level,
          execution_template_json = excluded.execution_template_json,
          fallback_policy_json = excluded.fallback_policy_json,
          evaluation_metrics_json = excluded.evaluation_metrics_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `)
      .run(
        skill.skill_id,
        tenantId,
        skill.name,
        skill.version,
        skill.status ?? null,
        skill.kind,
        skill.description ?? null,
        skill.required_inputs ? JSON.stringify(skill.required_inputs) : null,
        skill.applicable_domains ? JSON.stringify(skill.applicable_domains) : null,
        skill.risk_level ?? null,
        JSON.stringify(skill.execution_template),
        skill.fallback_policy ? JSON.stringify(skill.fallback_policy) : null,
        skill.evaluation_metrics ? JSON.stringify(skill.evaluation_metrics) : null,
        skill.metadata ? JSON.stringify(skill.metadata) : null,
        existingCreatedAt?.created_at ?? now,
        now
      );

    this.db
      .prepare("DELETE FROM procedural_skill_triggers WHERE skill_id = ?")
      .run(skill.skill_id);

    for (const condition of skill.trigger_conditions) {
      const normalized = normalizeTriggerValue(condition);
      this.db
        .prepare(`
          INSERT INTO procedural_skill_triggers (
            skill_id,
            field,
            operator,
            value_text,
            value_number,
            value_bool
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          skill.skill_id,
          condition.field,
          condition.operator,
          normalized.valueText,
          normalized.valueNumber,
          normalized.valueBool
        );
    }
  }

  public get(skillId: string): SkillDefinition | undefined {
    const row = this.db
      .prepare("SELECT * FROM procedural_skills WHERE skill_id = ?")
      .get(skillId) as SqliteSkillRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.toSkill(row);
  }

  public list(tenantId: string): SkillDefinition[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM procedural_skills
        WHERE tenant_id = ?
        ORDER BY updated_at DESC, skill_id ASC
      `)
      .all(tenantId) as unknown as SqliteSkillRow[];

    return rows.map((row) => this.toSkill(row));
  }

  public findByTrigger(tenantId: string, context: Record<string, unknown>): SkillDefinition[] {
    const matched: SkillDefinition[] = [];
    for (const skill of this.list(tenantId)) {
      if (skill.status === "deprecated" || skill.status === "pruned") {
        continue;
      }
      if (skill.trigger_conditions.length === 0) {
        continue;
      }
      if (skill.trigger_conditions.every((condition) => matchesTrigger(condition, context))) {
        matched.push(skill);
      }
    }
    return matched;
  }

  public delete(skillId: string): void {
    this.db.prepare("DELETE FROM procedural_skill_triggers WHERE skill_id = ?").run(skillId);
    this.db.prepare("DELETE FROM procedural_skills WHERE skill_id = ?").run(skillId);
  }

  public deleteByTenant(tenantId: string): void {
    const rows = this.db
      .prepare("SELECT skill_id FROM procedural_skills WHERE tenant_id = ?")
      .all(tenantId) as Array<{ skill_id: string }>;
    for (const row of rows) {
      this.delete(row.skill_id);
    }
  }

  public close(): void {
    this.db.close();
  }

  private toSkill(row: SqliteSkillRow): SkillDefinition {
    const triggerRows = this.db
      .prepare(`
        SELECT field, operator, value_text, value_number, value_bool
        FROM procedural_skill_triggers
        WHERE skill_id = ?
        ORDER BY field ASC, operator ASC
      `)
      .all(row.skill_id) as Array<{
        field: string;
        operator: TriggerCondition["operator"];
        value_text: string | null;
        value_number: number | null;
        value_bool: number | null;
      }>;

    return {
      skill_id: row.skill_id,
      schema_version: "1.0.0",
      name: row.name,
      version: row.version,
      status: row.status as SkillDefinition["status"] | null ?? undefined,
      kind: row.kind as SkillDefinition["kind"],
      description: row.description ?? undefined,
      trigger_conditions: triggerRows.map((trigger) => ({
        field: trigger.field,
        operator: trigger.operator,
        value:
          trigger.value_text !== null
            ? trigger.value_text
            : trigger.value_number !== null
              ? Number(trigger.value_number)
              : trigger.value_bool === 1
                ? true
                : false
      })),
      required_inputs: row.required_inputs_json
        ? JSON.parse(row.required_inputs_json) as SkillDefinition["required_inputs"]
        : undefined,
      execution_template: JSON.parse(row.execution_template_json) as SkillDefinition["execution_template"],
      applicable_domains: row.applicable_domains_json
        ? JSON.parse(row.applicable_domains_json) as SkillDefinition["applicable_domains"]
        : undefined,
      risk_level: row.risk_level as SkillDefinition["risk_level"] | null ?? undefined,
      fallback_policy: row.fallback_policy_json
        ? JSON.parse(row.fallback_policy_json) as SkillDefinition["fallback_policy"]
        : undefined,
      evaluation_metrics: row.evaluation_metrics_json
        ? JSON.parse(row.evaluation_metrics_json) as SkillDefinition["evaluation_metrics"]
        : undefined,
      metadata: row.metadata_json ? parseRecord(row.metadata_json) : undefined
    };
  }
}

interface SqliteSkillRow {
  skill_id: string;
  name: string;
  version: string;
  status: string | null;
  kind: string;
  description: string | null;
  required_inputs_json: string | null;
  applicable_domains_json: string | null;
  risk_level: string | null;
  execution_template_json: string;
  fallback_policy_json: string | null;
  evaluation_metrics_json: string | null;
  metadata_json: string | null;
}

function readTenantId(skill: SkillDefinition): string {
  const metadata =
    skill.metadata && typeof skill.metadata === "object"
      ? (skill.metadata as Record<string, unknown>)
      : undefined;
  return typeof metadata?.tenant_id === "string" ? metadata.tenant_id : "default";
}

function normalizeTriggerValue(condition: TriggerCondition): {
  valueText: string | null;
  valueNumber: number | null;
  valueBool: number | null;
} {
  return {
    valueText: typeof condition.value === "string" ? condition.value : null,
    valueNumber: typeof condition.value === "number" ? condition.value : null,
    valueBool: typeof condition.value === "boolean" ? (condition.value ? 1 : 0) : null
  };
}

function matchesTrigger(condition: TriggerCondition, context: Record<string, unknown>): boolean {
  const actual = context[condition.field];
  if (actual === undefined) {
    return false;
  }

  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "contains":
      return typeof actual === "string" && typeof condition.value === "string" && actual.includes(condition.value);
    case "gt":
      return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "lt":
      return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    default:
      return false;
  }
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}
