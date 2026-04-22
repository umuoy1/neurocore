import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RewardSignal, RewardStore } from "@neurocore/protocol";

export interface SqliteRewardStoreOptions {
  filename: string;
}

export class SqliteRewardStore implements RewardStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteRewardStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_reward_signals (
        signal_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        skill_id TEXT,
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        composite_reward REAL NOT NULL,
        metrics_json TEXT,
        baseline_metrics_json TEXT,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_reward_episode
        ON skill_reward_signals(episode_id);
      CREATE INDEX IF NOT EXISTS idx_skill_reward_tenant_skill
        ON skill_reward_signals(tenant_id, skill_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_skill_reward_tenant
        ON skill_reward_signals(tenant_id, timestamp DESC);
    `);
    ensureColumnExists(this.db, "skill_reward_signals", "metrics_json", "TEXT");
    ensureColumnExists(this.db, "skill_reward_signals", "baseline_metrics_json", "TEXT");
  }

  public save(signal: RewardSignal): void {
    this.db.prepare(`
      INSERT INTO skill_reward_signals (
        signal_id,
        episode_id,
        skill_id,
        session_id,
        tenant_id,
        dimensions_json,
        composite_reward,
        metrics_json,
        baseline_metrics_json,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signal_id) DO UPDATE SET
        episode_id = excluded.episode_id,
        skill_id = excluded.skill_id,
        session_id = excluded.session_id,
        tenant_id = excluded.tenant_id,
        dimensions_json = excluded.dimensions_json,
        composite_reward = excluded.composite_reward,
        metrics_json = excluded.metrics_json,
        baseline_metrics_json = excluded.baseline_metrics_json,
        timestamp = excluded.timestamp
    `).run(
      signal.signal_id,
      signal.episode_id,
      signal.skill_id ?? null,
      signal.session_id,
      signal.tenant_id,
      JSON.stringify(signal.dimensions),
      signal.composite_reward,
      signal.metrics ? JSON.stringify(signal.metrics) : null,
      signal.baseline_metrics ? JSON.stringify(signal.baseline_metrics) : null,
      signal.timestamp
    );
  }

  public getByEpisodeId(episodeId: string): RewardSignal | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM skill_reward_signals
      WHERE episode_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(episodeId) as SqliteRewardRow | undefined;
    return row ? toRewardSignal(row) : undefined;
  }

  public listBySkillId(tenantId: string, skillId: string): RewardSignal[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM skill_reward_signals
      WHERE tenant_id = ? AND skill_id = ?
      ORDER BY timestamp ASC
    `).all(tenantId, skillId) as unknown as SqliteRewardRow[];
    return rows.map(toRewardSignal);
  }

  public listByTenantId(tenantId: string): RewardSignal[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM skill_reward_signals
      WHERE tenant_id = ?
      ORDER BY timestamp ASC
    `).all(tenantId) as unknown as SqliteRewardRow[];
    return rows.map(toRewardSignal);
  }

  public getAverageMetrics(input: {
    tenant_id: string;
    skill_id?: string;
    window_size?: number;
  }): {
    avg_cycles?: number;
    avg_latency_ms?: number;
    avg_tokens?: number;
  } {
    const rows = (input.skill_id
      ? this.listBySkillId(input.tenant_id, input.skill_id)
      : this.listByTenantId(input.tenant_id)
    )
      .filter((signal) => signal.metrics)
      .slice(-(input.window_size ?? 20));
    return {
      avg_cycles: average(rows.map((signal) => signal.metrics?.cycle_index)),
      avg_latency_ms: average(rows.map((signal) => signal.metrics?.total_latency_ms)),
      avg_tokens: average(rows.map((signal) => signal.metrics?.total_tokens))
    };
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM skill_reward_signals WHERE session_id = ?").run(sessionId);
  }

  public close(): void {
    this.db.close();
  }
}

interface SqliteRewardRow {
  signal_id: string;
  episode_id: string;
  skill_id: string | null;
  session_id: string;
  tenant_id: string;
  dimensions_json: string;
  composite_reward: number;
  metrics_json: string | null;
  baseline_metrics_json: string | null;
  timestamp: string;
}

function toRewardSignal(row: SqliteRewardRow): RewardSignal {
  return {
    signal_id: row.signal_id,
    episode_id: row.episode_id,
    skill_id: row.skill_id ?? undefined,
    session_id: row.session_id,
    tenant_id: row.tenant_id,
    dimensions: JSON.parse(row.dimensions_json) as RewardSignal["dimensions"],
    composite_reward: Number(row.composite_reward),
    metrics: row.metrics_json ? JSON.parse(row.metrics_json) as RewardSignal["metrics"] : undefined,
    baseline_metrics: row.baseline_metrics_json ? JSON.parse(row.baseline_metrics_json) as RewardSignal["baseline_metrics"] : undefined,
    timestamp: row.timestamp
  };
}

function average(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function ensureColumnExists(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}
