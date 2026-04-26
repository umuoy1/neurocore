import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IMPlatform } from "../im-gateway/types.js";
import { isIMPlatform } from "../im-gateway/types.js";

export interface SessionSearchEntry {
  entry_id: string;
  tenant_id: string;
  user_id?: string;
  session_id: string;
  cycle_id?: string;
  trace_id?: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  source_platform?: IMPlatform;
  source_chat_id?: string;
  source_message_id?: string;
  metadata: Record<string, unknown>;
}

export interface AddSessionSearchEntryInput {
  tenant_id: string;
  user_id?: string;
  session_id: string;
  cycle_id?: string;
  trace_id?: string;
  role: SessionSearchEntry["role"];
  content: string;
  created_at?: string;
  source_platform?: IMPlatform;
  source_chat_id?: string;
  source_message_id?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionSearchQuery {
  tenant_id: string;
  user_id?: string;
  query?: string;
  semantic_text?: string;
  start_at?: string;
  end_at?: string;
  limit?: number;
}

export interface SessionSearchResult extends SessionSearchEntry {
  score: number;
  keyword_score: number;
  semantic_score: number;
  recency_score: number;
  match_reasons: string[];
  provenance: {
    session_id: string;
    cycle_id?: string;
    trace_id?: string;
    source_platform?: IMPlatform;
    source_chat_id?: string;
    source_message_id?: string;
    created_at: string;
  };
}

export interface SessionSearchStore {
  addEntry(input: AddSessionSearchEntryInput): SessionSearchEntry;
  search(query: SessionSearchQuery): SessionSearchResult[];
  close?(): void;
}

export interface SqliteSessionSearchStoreOptions {
  filename: string;
}

export class SqliteSessionSearchStore implements SessionSearchStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteSessionSearchStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_search_entries (
        entry_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT NOT NULL,
        cycle_id TEXT,
        trace_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source_platform TEXT,
        source_chat_id TEXT,
        source_message_id TEXT,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_search_tenant_time
        ON session_search_entries(tenant_id, created_at DESC, entry_id DESC);
      CREATE INDEX IF NOT EXISTS idx_session_search_user_time
        ON session_search_entries(tenant_id, user_id, created_at DESC, entry_id DESC);
      CREATE INDEX IF NOT EXISTS idx_session_search_session_time
        ON session_search_entries(tenant_id, session_id, created_at DESC, entry_id DESC);
    `);
  }

  public addEntry(input: AddSessionSearchEntryInput): SessionSearchEntry {
    const entry: SessionSearchEntry = {
      entry_id: `sse_${randomUUID()}`,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      session_id: input.session_id,
      cycle_id: input.cycle_id,
      trace_id: input.trace_id,
      role: input.role,
      content: input.content,
      created_at: input.created_at ?? new Date().toISOString(),
      source_platform: input.source_platform,
      source_chat_id: input.source_chat_id,
      source_message_id: input.source_message_id,
      metadata: input.metadata ?? {}
    };
    this.db.prepare(`
      INSERT INTO session_search_entries (
        entry_id,
        tenant_id,
        user_id,
        session_id,
        cycle_id,
        trace_id,
        role,
        content,
        created_at,
        source_platform,
        source_chat_id,
        source_message_id,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.entry_id,
      entry.tenant_id,
      entry.user_id ?? null,
      entry.session_id,
      entry.cycle_id ?? null,
      entry.trace_id ?? null,
      entry.role,
      entry.content,
      entry.created_at,
      entry.source_platform ?? null,
      entry.source_chat_id ?? null,
      entry.source_message_id ?? null,
      JSON.stringify(entry.metadata)
    );
    return entry;
  }

  public search(query: SessionSearchQuery): SessionSearchResult[] {
    const rows = this.loadCandidateRows(query).map(toEntry);
    const queryTokens = tokenize(query.query ?? "");
    const semanticTokens = tokenize(query.semantic_text ?? query.query ?? "");
    const phrase = normalizeText(query.query ?? "");
    return rows
      .map((entry, index) => scoreEntry(entry, queryTokens, semanticTokens, phrase, index))
      .filter((result) => result.score > 0 || (!query.query && !query.semantic_text))
      .sort((left, right) => right.score - left.score || right.created_at.localeCompare(left.created_at))
      .slice(0, Math.max(1, query.limit ?? 8));
  }

  public close(): void {
    this.db.close();
  }

  private loadCandidateRows(query: SessionSearchQuery): SessionSearchEntryRow[] {
    const clauses = ["tenant_id = ?"];
    const params: Array<string | number | null> = [query.tenant_id];
    if (query.user_id) {
      clauses.push("user_id = ?");
      params.push(query.user_id);
    }
    if (query.start_at) {
      clauses.push("created_at >= ?");
      params.push(query.start_at);
    }
    if (query.end_at) {
      clauses.push("created_at <= ?");
      params.push(query.end_at);
    }
    params.push(Math.max(25, (query.limit ?? 8) * 8));
    return this.db.prepare(`
      SELECT *
      FROM session_search_entries
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC, entry_id DESC
      LIMIT ?
    `).all(...params) as unknown as SessionSearchEntryRow[];
  }
}

interface SessionSearchEntryRow {
  entry_id: string;
  tenant_id: string;
  user_id: string | null;
  session_id: string;
  cycle_id: string | null;
  trace_id: string | null;
  role: string;
  content: string;
  created_at: string;
  source_platform: string | null;
  source_chat_id: string | null;
  source_message_id: string | null;
  metadata_json: string;
}

function scoreEntry(
  entry: SessionSearchEntry,
  queryTokens: Set<string>,
  semanticTokens: Set<string>,
  phrase: string,
  index: number
): SessionSearchResult {
  const contentTokens = tokenize(entry.content);
  const normalizedContent = normalizeText(entry.content);
  const phraseScore = phrase && normalizedContent.includes(phrase) ? 1 : 0;
  const keywordScore = Math.max(overlapScore(contentTokens, queryTokens), phraseScore);
  const semanticScore = overlapScore(contentTokens, semanticTokens);
  const recencyScore = 1 / (index + 1);
  const matchReasons = [
    ...(keywordScore > 0 ? ["keyword"] : []),
    ...(semanticScore > 0 ? ["semantic"] : []),
    ...(!phrase && queryTokens.size === 0 && semanticTokens.size === 0 ? ["recent"] : [])
  ];
  const score = keywordScore * 0.55 + semanticScore * 0.35 + recencyScore * 0.1;
  return {
    ...entry,
    score,
    keyword_score: keywordScore,
    semantic_score: semanticScore,
    recency_score: recencyScore,
    match_reasons: matchReasons,
    provenance: {
      session_id: entry.session_id,
      cycle_id: entry.cycle_id,
      trace_id: entry.trace_id,
      source_platform: entry.source_platform,
      source_chat_id: entry.source_chat_id,
      source_message_id: entry.source_message_id,
      created_at: entry.created_at
    }
  };
}

function overlapScore(contentTokens: Set<string>, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / queryTokens.size;
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean));
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim();
}

function toEntry(row: SessionSearchEntryRow): SessionSearchEntry {
  const sourcePlatform = isIMPlatform(row.source_platform) ? row.source_platform : undefined;
  return {
    entry_id: row.entry_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id ?? undefined,
    session_id: row.session_id,
    cycle_id: row.cycle_id ?? undefined,
    trace_id: row.trace_id ?? undefined,
    role: normalizeRole(row.role),
    content: row.content,
    created_at: row.created_at,
    source_platform: sourcePlatform,
    source_chat_id: row.source_chat_id ?? undefined,
    source_message_id: row.source_message_id ?? undefined,
    metadata: parseMetadata(row.metadata_json)
  };
}

function normalizeRole(value: string): SessionSearchEntry["role"] {
  return value === "assistant" || value === "system" || value === "tool" ? value : "user";
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
