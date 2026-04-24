import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActivationTrace, Episode, MemoryLifecycleState } from "@neurocore/protocol";

export interface SqliteEpisodicMemoryStoreOptions {
  filename: string;
}

export class SqliteEpisodicMemoryStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteEpisodicMemoryStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_episodes (
        episode_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL DEFAULT '1.0.0',
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        trigger_summary TEXT NOT NULL,
        goal_refs_json TEXT NOT NULL,
        plan_refs_json TEXT,
        context_digest TEXT NOT NULL,
        selected_strategy TEXT NOT NULL,
        action_refs_json TEXT NOT NULL,
        observation_refs_json TEXT NOT NULL,
        evidence_refs_json TEXT,
        artifact_refs_json TEXT,
        temporal_refs_json TEXT,
        causal_links_json TEXT,
        activation_trace_json TEXT,
        lifecycle_state_json TEXT,
        outcome TEXT NOT NULL,
        outcome_summary TEXT NOT NULL,
        valence TEXT,
        lessons_json TEXT,
        promoted_to_skill INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episode_session_created
        ON episodic_episodes(session_id, created_at DESC, episode_id DESC);
      CREATE INDEX IF NOT EXISTS idx_episode_tenant_created
        ON episodic_episodes(tenant_id, created_at DESC, episode_id DESC);
    `);
    ensureColumn(this.db, "episodic_episodes", "schema_version", "TEXT NOT NULL DEFAULT '1.0.0'");
    ensureColumn(this.db, "episodic_episodes", "plan_refs_json", "TEXT");
    ensureColumn(this.db, "episodic_episodes", "evidence_refs_json", "TEXT");
    ensureColumn(this.db, "episodic_episodes", "artifact_refs_json", "TEXT");
    ensureColumn(this.db, "episodic_episodes", "temporal_refs_json", "TEXT");
    ensureColumn(this.db, "episodic_episodes", "causal_links_json", "TEXT");
    ensureColumn(this.db, "episodic_episodes", "activation_trace_json", "TEXT");
    ensureColumn(this.db, "episodic_episodes", "lifecycle_state_json", "TEXT");
  }

  public write(sessionId: string, tenantId: string, episode: Episode): void {
    this.db
      .prepare(`
        INSERT INTO episodic_episodes (
          episode_id,
          schema_version,
          tenant_id,
          session_id,
          trigger_summary,
          goal_refs_json,
          plan_refs_json,
          context_digest,
          selected_strategy,
          action_refs_json,
          observation_refs_json,
          evidence_refs_json,
          artifact_refs_json,
          temporal_refs_json,
          causal_links_json,
          activation_trace_json,
          lifecycle_state_json,
          outcome,
          outcome_summary,
          valence,
          lessons_json,
          promoted_to_skill,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          tenant_id = excluded.tenant_id,
          session_id = excluded.session_id,
          trigger_summary = excluded.trigger_summary,
          goal_refs_json = excluded.goal_refs_json,
          plan_refs_json = excluded.plan_refs_json,
          context_digest = excluded.context_digest,
          selected_strategy = excluded.selected_strategy,
          action_refs_json = excluded.action_refs_json,
          observation_refs_json = excluded.observation_refs_json,
          evidence_refs_json = excluded.evidence_refs_json,
          artifact_refs_json = excluded.artifact_refs_json,
          temporal_refs_json = excluded.temporal_refs_json,
          causal_links_json = excluded.causal_links_json,
          activation_trace_json = excluded.activation_trace_json,
          lifecycle_state_json = excluded.lifecycle_state_json,
          outcome = excluded.outcome,
          outcome_summary = excluded.outcome_summary,
          valence = excluded.valence,
          lessons_json = excluded.lessons_json,
          promoted_to_skill = excluded.promoted_to_skill,
          metadata_json = excluded.metadata_json,
          created_at = excluded.created_at
      `)
      .run(
        episode.episode_id,
        episode.schema_version,
        tenantId,
        sessionId,
        episode.trigger_summary,
        JSON.stringify(episode.goal_refs),
        episode.plan_refs ? JSON.stringify(episode.plan_refs) : null,
        episode.context_digest,
        episode.selected_strategy,
        JSON.stringify(episode.action_refs),
        JSON.stringify(episode.observation_refs),
        episode.evidence_refs ? JSON.stringify(episode.evidence_refs) : null,
        episode.artifact_refs ? JSON.stringify(episode.artifact_refs) : null,
        episode.temporal_refs ? JSON.stringify(episode.temporal_refs) : null,
        episode.causal_links ? JSON.stringify(episode.causal_links) : null,
        episode.activation_trace ? JSON.stringify(episode.activation_trace) : null,
        episode.lifecycle_state ? JSON.stringify(episode.lifecycle_state) : null,
        episode.outcome,
        episode.outcome_summary,
        episode.valence ?? null,
        episode.lessons ? JSON.stringify(episode.lessons) : null,
        episode.promoted_to_skill ? 1 : 0,
        episode.metadata ? JSON.stringify(episode.metadata) : null,
        episode.created_at
      );
  }

  public list(sessionId: string): Episode[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM episodic_episodes
        WHERE session_id = ?
        ORDER BY created_at ASC, episode_id ASC
      `)
      .all(sessionId) as unknown as SqliteEpisodeRow[];

    return rows.map(toEpisode);
  }

  public getLatest(sessionId: string): Episode | undefined {
    const row = this.db
      .prepare(`
        SELECT *
        FROM episodic_episodes
        WHERE session_id = ?
        ORDER BY created_at DESC, episode_id DESC
        LIMIT 1
      `)
      .get(sessionId) as SqliteEpisodeRow | undefined;
    return row ? toEpisode(row) : undefined;
  }

  public listByTenant(tenantId: string, excludeSessionId?: string): Episode[] {
    const rows = excludeSessionId
      ? (this.db
          .prepare(`
            SELECT *
            FROM episodic_episodes
            WHERE tenant_id = ? AND session_id <> ?
            ORDER BY created_at DESC, episode_id DESC
          `)
          .all(tenantId, excludeSessionId) as unknown as SqliteEpisodeRow[])
      : (this.db
          .prepare(`
            SELECT *
            FROM episodic_episodes
            WHERE tenant_id = ?
            ORDER BY created_at DESC, episode_id DESC
          `)
          .all(tenantId) as unknown as SqliteEpisodeRow[]);

    return rows.map(toEpisode);
  }

  public replace(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.deleteSession(sessionId);
    for (const episode of episodes) {
      this.write(sessionId, tenantId, episode);
    }
  }

  public markActivated(
    sessionId: string,
    tenantId: string,
    episodeIds: string[],
    input: {
      cycleId?: string;
      scope: ActivationTrace["last_scope"];
      activatedAt: string;
    }
  ): void {
    for (const episodeId of episodeIds) {
      const existing = this.getEpisode(sessionId, episodeId);
      if (!existing) {
        continue;
      }
      this.write(sessionId, tenantId, {
        ...existing,
        activation_trace: nextActivationTrace(existing.activation_trace, sessionId, input)
      });
    }
  }

  public markLifecycle(
    sessionId: string,
    tenantId: string,
    episodeId: string,
    lifecycleState: MemoryLifecycleState
  ): void {
    const existing = this.getEpisode(sessionId, episodeId);
    if (!existing) {
      return;
    }
    this.write(sessionId, tenantId, {
      ...existing,
      lifecycle_state: structuredClone(lifecycleState)
    });
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM episodic_episodes WHERE session_id = ?").run(sessionId);
  }

  public close(): void {
    this.db.close();
  }

  private getEpisode(sessionId: string, episodeId: string): Episode | undefined {
    const row = this.db
      .prepare(`
        SELECT *
        FROM episodic_episodes
        WHERE session_id = ? AND episode_id = ?
        LIMIT 1
      `)
      .get(sessionId, episodeId) as SqliteEpisodeRow | undefined;
    return row ? toEpisode(row) : undefined;
  }
}

interface SqliteEpisodeRow {
  episode_id: string;
  schema_version: string;
  session_id: string;
  trigger_summary: string;
  goal_refs_json: string;
  plan_refs_json: string | null;
  context_digest: string;
  selected_strategy: string;
  action_refs_json: string;
  observation_refs_json: string;
  evidence_refs_json: string | null;
  artifact_refs_json: string | null;
  temporal_refs_json: string | null;
  causal_links_json: string | null;
  activation_trace_json: string | null;
  lifecycle_state_json: string | null;
  outcome: "success" | "partial" | "failure";
  outcome_summary: string;
  valence: Episode["valence"] | null;
  lessons_json: string | null;
  promoted_to_skill: number;
  metadata_json: string | null;
  created_at: string;
}

function toEpisode(row: SqliteEpisodeRow): Episode {
  return {
    episode_id: row.episode_id,
    schema_version: row.schema_version || "1.0.0",
    session_id: row.session_id,
    trigger_summary: row.trigger_summary,
    goal_refs: parseStringArray(row.goal_refs_json),
    plan_refs: row.plan_refs_json ? parseStringArray(row.plan_refs_json) : undefined,
    context_digest: row.context_digest,
    selected_strategy: row.selected_strategy,
    action_refs: parseStringArray(row.action_refs_json),
    observation_refs: parseStringArray(row.observation_refs_json),
    evidence_refs: row.evidence_refs_json ? parseArray(row.evidence_refs_json) : undefined,
    artifact_refs: row.artifact_refs_json ? parseArray(row.artifact_refs_json) : undefined,
    temporal_refs: row.temporal_refs_json ? parseArray(row.temporal_refs_json) : undefined,
    causal_links: row.causal_links_json ? parseArray(row.causal_links_json) : undefined,
    activation_trace: row.activation_trace_json ? parseObject<ActivationTrace>(row.activation_trace_json) : undefined,
    lifecycle_state: row.lifecycle_state_json ? parseObject<MemoryLifecycleState>(row.lifecycle_state_json) : undefined,
    outcome: row.outcome,
    outcome_summary: row.outcome_summary,
    valence: row.valence ?? undefined,
    lessons: row.lessons_json ? parseStringArray(row.lessons_json) : undefined,
    promoted_to_skill: row.promoted_to_skill === 1,
    metadata: row.metadata_json ? parseRecord(row.metadata_json) : undefined,
    created_at: row.created_at
  };
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function parseArray<T>(value: string): T[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function parseObject<T>(value: string): T | undefined {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as T;
}

function nextActivationTrace(
  current: ActivationTrace | undefined,
  sessionId: string,
  input: {
    cycleId?: string;
    scope: ActivationTrace["last_scope"];
    activatedAt: string;
  }
): ActivationTrace {
  return {
    activation_count: (current?.activation_count ?? 0) + 1,
    citation_count: (current?.citation_count ?? 0) + 1,
    last_activated_at: input.activatedAt,
    last_session_id: sessionId,
    last_cycle_id: input.cycleId,
    last_scope: input.scope,
    activation_sources: [...new Set([...(current?.activation_sources ?? []), input.scope ?? "session"])]
  };
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
