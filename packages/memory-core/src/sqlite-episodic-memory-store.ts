import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Episode } from "@neurocore/protocol";

export interface SqliteEpisodicMemoryStoreOptions {
  filename: string;
}

export class SqliteEpisodicMemoryStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteEpisodicMemoryStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_episodes (
        episode_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        trigger_summary TEXT NOT NULL,
        goal_refs_json TEXT NOT NULL,
        context_digest TEXT NOT NULL,
        selected_strategy TEXT NOT NULL,
        action_refs_json TEXT NOT NULL,
        observation_refs_json TEXT NOT NULL,
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
  }

  public write(sessionId: string, tenantId: string, episode: Episode): void {
    this.db
      .prepare(`
        INSERT INTO episodic_episodes (
          episode_id,
          tenant_id,
          session_id,
          trigger_summary,
          goal_refs_json,
          context_digest,
          selected_strategy,
          action_refs_json,
          observation_refs_json,
          outcome,
          outcome_summary,
          valence,
          lessons_json,
          promoted_to_skill,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          session_id = excluded.session_id,
          trigger_summary = excluded.trigger_summary,
          goal_refs_json = excluded.goal_refs_json,
          context_digest = excluded.context_digest,
          selected_strategy = excluded.selected_strategy,
          action_refs_json = excluded.action_refs_json,
          observation_refs_json = excluded.observation_refs_json,
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
        tenantId,
        sessionId,
        episode.trigger_summary,
        JSON.stringify(episode.goal_refs),
        episode.context_digest,
        episode.selected_strategy,
        JSON.stringify(episode.action_refs),
        JSON.stringify(episode.observation_refs),
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

  public deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM episodic_episodes WHERE session_id = ?").run(sessionId);
  }

  public close(): void {
    this.db.close();
  }
}

interface SqliteEpisodeRow {
  episode_id: string;
  session_id: string;
  trigger_summary: string;
  goal_refs_json: string;
  context_digest: string;
  selected_strategy: string;
  action_refs_json: string;
  observation_refs_json: string;
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
    schema_version: "1.0.0",
    session_id: row.session_id,
    trigger_summary: row.trigger_summary,
    goal_refs: parseStringArray(row.goal_refs_json),
    context_digest: row.context_digest,
    selected_strategy: row.selected_strategy,
    action_refs: parseStringArray(row.action_refs_json),
    observation_refs: parseStringArray(row.observation_refs_json),
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
