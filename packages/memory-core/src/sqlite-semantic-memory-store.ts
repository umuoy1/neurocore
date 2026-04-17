import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Episode,
  SemanticMemoryContribution,
  SemanticMemorySnapshot
} from "@neurocore/protocol";

export interface SqliteSemanticMemoryStoreOptions {
  filename: string;
}

export interface SqliteSemanticMemoryRecord {
  memory_id: string;
  tenant_id: string;
  summary: string;
  relevance: number;
  occurrence_count: number;
  source_episode_ids: string[];
  session_ids: string[];
  pattern_key: string;
  valence: "positive" | "negative";
  last_updated_at: string;
}

export class SqliteSemanticMemoryStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteSemanticMemoryStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_patterns (
        tenant_id TEXT NOT NULL,
        pattern_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        relevance REAL NOT NULL,
        occurrence_count INTEGER NOT NULL,
        last_updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, pattern_key)
      );
      CREATE TABLE IF NOT EXISTS semantic_session_contributions (
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        pattern_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_episode_ids_json TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, pattern_key)
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_tenant_occurrence
        ON semantic_patterns(tenant_id, occurrence_count DESC, last_updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_semantic_session_tenant
        ON semantic_session_contributions(session_id, tenant_id);
    `);
  }

  public appendEpisode(sessionId: string, tenantId: string, episode: Episode, includeNegative = false): void {
    if (!shouldStoreSemanticEpisode(episode, includeNegative)) {
      return;
    }

    const next = mergeEpisodeIntoContributions(
      this.listSessionContributions(sessionId),
      tenantId,
      sessionId,
      episode
    );
    this.replaceSession(sessionId, tenantId, next);
  }

  public replaceSession(
    sessionId: string,
    tenantId: string,
    episodesOrContributions: Episode[] | SemanticMemoryContribution[],
    includeNegative = false
  ): void {
    const contributions = isSemanticContributionArray(episodesOrContributions)
      ? episodesOrContributions
      : buildContributionsFromEpisodes(
          tenantId,
          sessionId,
          episodesOrContributions.filter((episode) => shouldStoreSemanticEpisode(episode, includeNegative))
        );

    this.db
      .prepare("DELETE FROM semantic_session_contributions WHERE session_id = ?")
      .run(sessionId);

    for (const contribution of contributions) {
      this.db
        .prepare(`
          INSERT INTO semantic_session_contributions (
            session_id,
            tenant_id,
            pattern_key,
            summary,
            source_episode_ids_json,
            last_updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          contribution.session_id,
          contribution.tenant_id,
          contribution.pattern_key,
          contribution.summary,
          JSON.stringify(contribution.source_episode_ids),
          contribution.last_updated_at
        );
    }

    this.rebuildTenantPatterns(tenantId);
  }

  public restoreSnapshot(sessionId: string, tenantId: string, snapshot?: SemanticMemorySnapshot): void {
    this.replaceSession(sessionId, tenantId, structuredClone(snapshot?.contributions ?? []));
  }

  public buildSnapshot(sessionId: string): SemanticMemorySnapshot {
    return {
      contributions: this.listSessionContributions(sessionId)
    };
  }

  public deleteSession(sessionId: string): void {
    const tenantRow = this.db
      .prepare(`
        SELECT tenant_id
        FROM semantic_session_contributions
        WHERE session_id = ?
        LIMIT 1
      `)
      .get(sessionId) as { tenant_id: string } | undefined;

    this.db
      .prepare("DELETE FROM semantic_session_contributions WHERE session_id = ?")
      .run(sessionId);

    if (tenantRow) {
      this.rebuildTenantPatterns(tenantRow.tenant_id);
    }
  }

  public list(tenantId: string, excludeSessionId?: string): SqliteSemanticMemoryRecord[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM semantic_patterns
        WHERE tenant_id = ?
        ORDER BY occurrence_count DESC, last_updated_at DESC
      `)
      .all(tenantId) as Array<{
        tenant_id: string;
        pattern_key: string;
        summary: string;
        relevance: number;
        occurrence_count: number;
        last_updated_at: string;
      }>;

    const excludedPatternKeys = new Set(
      excludeSessionId
        ? this.listSessionContributions(excludeSessionId).map((contribution) => contribution.pattern_key)
        : []
    );

    return rows
      .filter((row) => !excludedPatternKeys.has(row.pattern_key))
      .map((row) => {
        const contributions = this.listPatternContributions(tenantId, row.pattern_key);
        const sourceEpisodeIds = new Set<string>();
        const sessionIds = new Set<string>();

        for (const contribution of contributions) {
          sessionIds.add(contribution.session_id);
          for (const episodeId of contribution.source_episode_ids) {
            sourceEpisodeIds.add(episodeId);
          }
        }

        return {
          memory_id: semanticMemoryId(row.pattern_key),
          tenant_id: row.tenant_id,
          summary: row.summary,
          relevance: Number(row.relevance),
          occurrence_count: Number(row.occurrence_count),
          source_episode_ids: [...sourceEpisodeIds],
          session_ids: [...sessionIds],
          pattern_key: row.pattern_key,
          valence: deriveContributionValence(row.pattern_key),
          last_updated_at: row.last_updated_at
        };
      })
      .filter((record) => record.occurrence_count >= 2);
  }

  public close(): void {
    this.db.close();
  }

  private listSessionContributions(sessionId: string): SemanticMemoryContribution[] {
    const rows = this.db
      .prepare(`
        SELECT session_id, tenant_id, pattern_key, summary, source_episode_ids_json, last_updated_at
        FROM semantic_session_contributions
        WHERE session_id = ?
        ORDER BY last_updated_at DESC, pattern_key ASC
      `)
      .all(sessionId) as Array<{
        session_id: string;
        tenant_id: string;
        pattern_key: string;
        summary: string;
        source_episode_ids_json: string;
        last_updated_at: string;
      }>;

    return rows.map((row) => ({
      session_id: row.session_id,
      tenant_id: row.tenant_id,
      pattern_key: row.pattern_key,
      summary: row.summary,
      source_episode_ids: parseStringArray(row.source_episode_ids_json),
      last_updated_at: row.last_updated_at
    }));
  }

  private listPatternContributions(tenantId: string, patternKey: string): SemanticMemoryContribution[] {
    const rows = this.db
      .prepare(`
        SELECT session_id, tenant_id, pattern_key, summary, source_episode_ids_json, last_updated_at
        FROM semantic_session_contributions
        WHERE tenant_id = ? AND pattern_key = ?
        ORDER BY last_updated_at DESC, session_id ASC
      `)
      .all(tenantId, patternKey) as Array<{
        session_id: string;
        tenant_id: string;
        pattern_key: string;
        summary: string;
        source_episode_ids_json: string;
        last_updated_at: string;
      }>;

    return rows.map((row) => ({
      session_id: row.session_id,
      tenant_id: row.tenant_id,
      pattern_key: row.pattern_key,
      summary: row.summary,
      source_episode_ids: parseStringArray(row.source_episode_ids_json),
      last_updated_at: row.last_updated_at
    }));
  }

  private rebuildTenantPatterns(tenantId: string): void {
    const rows = this.db
      .prepare(`
        SELECT session_id, tenant_id, pattern_key, summary, source_episode_ids_json, last_updated_at
        FROM semantic_session_contributions
        WHERE tenant_id = ?
        ORDER BY last_updated_at DESC, session_id ASC
      `)
      .all(tenantId) as Array<{
        session_id: string;
        tenant_id: string;
        pattern_key: string;
        summary: string;
        source_episode_ids_json: string;
        last_updated_at: string;
      }>;

    this.db.prepare("DELETE FROM semantic_patterns WHERE tenant_id = ?").run(tenantId);

    const grouped = new Map<string, SemanticMemoryContribution[]>();
    for (const row of rows) {
      const group = grouped.get(row.pattern_key) ?? [];
      group.push({
        session_id: row.session_id,
        tenant_id: row.tenant_id,
        pattern_key: row.pattern_key,
        summary: row.summary,
        source_episode_ids: parseStringArray(row.source_episode_ids_json),
        last_updated_at: row.last_updated_at
      });
      grouped.set(row.pattern_key, group);
    }

    for (const [patternKey, contributions] of grouped.entries()) {
      const sourceEpisodeIds = new Set<string>();
      let latestSummary = contributions[0]?.summary ?? patternKey;
      let latestUpdatedAt = contributions[0]?.last_updated_at ?? new Date(0).toISOString();

      for (const contribution of contributions) {
        for (const episodeId of contribution.source_episode_ids) {
          sourceEpisodeIds.add(episodeId);
        }
        if (Date.parse(contribution.last_updated_at) > Date.parse(latestUpdatedAt)) {
          latestSummary = contribution.summary;
          latestUpdatedAt = contribution.last_updated_at;
        }
      }

      const occurrenceCount = sourceEpisodeIds.size;
      const relevance = deriveContributionValence(patternKey) === "negative"
        ? Math.min(0.9, 0.56 + occurrenceCount * 0.06)
        : Math.min(0.98, 0.68 + occurrenceCount * 0.08);

      this.db
        .prepare(`
          INSERT INTO semantic_patterns (
            tenant_id,
            pattern_key,
            summary,
            relevance,
            occurrence_count,
            last_updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          tenantId,
          patternKey,
          latestSummary,
          relevance,
          occurrenceCount,
          latestUpdatedAt
        );
    }
  }
}

function isSemanticContributionArray(
  value: Episode[] | SemanticMemoryContribution[]
): value is SemanticMemoryContribution[] {
  if (value.length === 0) {
    return true;
  }
  return "pattern_key" in value[0];
}

function buildContributionsFromEpisodes(
  tenantId: string,
  sessionId: string,
  episodes: Episode[]
): SemanticMemoryContribution[] {
  const contributions = new Map<string, SemanticMemoryContribution>();
  const orderedEpisodes = episodes
    .slice()
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

  for (const episode of orderedEpisodes) {
    const patternKey = deriveSemanticPatternKey(episode);
    const existing = contributions.get(patternKey);

    if (!existing) {
      contributions.set(patternKey, {
        tenant_id: tenantId,
        session_id: sessionId,
        pattern_key: patternKey,
        summary: deriveSemanticSummary(episode),
        source_episode_ids: [episode.episode_id],
        last_updated_at: episode.created_at
      });
      continue;
    }

    if (!existing.source_episode_ids.includes(episode.episode_id)) {
      existing.source_episode_ids.push(episode.episode_id);
    }
    if (Date.parse(episode.created_at) > Date.parse(existing.last_updated_at)) {
      existing.summary = deriveSemanticSummary(episode);
      existing.last_updated_at = episode.created_at;
    }
  }

  return [...contributions.values()];
}

function mergeEpisodeIntoContributions(
  current: SemanticMemoryContribution[],
  tenantId: string,
  sessionId: string,
  episode: Episode
): SemanticMemoryContribution[] {
  const patternKey = deriveSemanticPatternKey(episode);
  const next = current.map((contribution) => structuredClone(contribution));
  const existing = next.find((contribution) => contribution.pattern_key === patternKey);

  if (!existing) {
    next.push({
      tenant_id: tenantId,
      session_id: sessionId,
      pattern_key: patternKey,
      summary: deriveSemanticSummary(episode),
      source_episode_ids: [episode.episode_id],
      last_updated_at: episode.created_at
    });
    return next;
  }

  if (!existing.source_episode_ids.includes(episode.episode_id)) {
    existing.source_episode_ids.push(episode.episode_id);
  }
  if (Date.parse(episode.created_at) > Date.parse(existing.last_updated_at)) {
    existing.summary = deriveSemanticSummary(episode);
    existing.last_updated_at = episode.created_at;
  }

  return next;
}

function deriveSemanticPatternKey(episode: Episode): string {
  const polarity = episode.outcome === "failure" || episode.valence === "negative" ? "negative" : "positive";
  const toolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : "runtime";
  const normalizedStrategy = episode.selected_strategy.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48);
  return `${polarity}:${toolName}:${normalizedStrategy}`;
}

function shouldStoreSemanticEpisode(episode: Episode, includeNegative: boolean): boolean {
  if (episode.outcome === "success") {
    return true;
  }
  return includeNegative && (episode.outcome === "failure" || episode.valence === "negative");
}

function deriveSemanticSummary(episode: Episode): string {
  if (episode.outcome === "failure" || episode.valence === "negative") {
    return `Avoid: ${episode.outcome_summary}`;
  }
  return episode.outcome_summary;
}

function deriveContributionValence(patternKey: string): "positive" | "negative" {
  return patternKey.startsWith("negative:") ? "negative" : "positive";
}

function semanticMemoryId(patternKey: string): string {
  return patternKey.startsWith("positive:")
    ? `sem_${patternKey.slice("positive:".length)}`
    : `sem_${patternKey}`;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === "string");
}
