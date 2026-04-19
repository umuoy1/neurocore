import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  MetaSignalProviderReliabilityRecord,
  MetaSignalProviderReliabilityStore
} from "@neurocore/protocol";
import { summarizeProviderReliability } from "./provider-reliability-store.js";

export interface SqliteProviderReliabilityStoreOptions {
  filename: string;
}

export class SqliteProviderReliabilityStore implements MetaSignalProviderReliabilityStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteProviderReliabilityStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta_provider_reliability_records (
        record_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        family TEXT NOT NULL,
        provider_status TEXT NOT NULL,
        observed_success INTEGER NOT NULL,
        session_id TEXT,
        cycle_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_provider_reliability_provider
        ON meta_provider_reliability_records(provider, family, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_meta_provider_reliability_session
        ON meta_provider_reliability_records(session_id, created_at DESC);
    `);
  }

  public append(record: MetaSignalProviderReliabilityRecord) {
    this.db.prepare(`
      INSERT INTO meta_provider_reliability_records (
        record_id,
        provider,
        family,
        provider_status,
        observed_success,
        session_id,
        cycle_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.record_id,
      record.provider,
      record.family,
      record.provider_status,
      record.observed_success ? 1 : 0,
      record.session_id ?? null,
      record.cycle_id ?? null,
      record.created_at
    );
  }

  public list(sessionId?: string) {
    const rows = sessionId
      ? this.db.prepare(`
          SELECT *
          FROM meta_provider_reliability_records
          WHERE session_id = ?
          ORDER BY created_at ASC, record_id ASC
        `).all(sessionId) as unknown as ProviderReliabilityRow[]
      : this.db.prepare(`
          SELECT *
          FROM meta_provider_reliability_records
          ORDER BY created_at ASC, record_id ASC
        `).all() as unknown as ProviderReliabilityRow[];

    return rows.map(toRecord);
  }

  public listByProvider(provider: string, family?: string) {
    const rows = family
      ? this.db.prepare(`
          SELECT *
          FROM meta_provider_reliability_records
          WHERE provider = ? AND family = ?
          ORDER BY created_at ASC, record_id ASC
        `).all(provider, family) as unknown as ProviderReliabilityRow[]
      : this.db.prepare(`
          SELECT *
          FROM meta_provider_reliability_records
          WHERE provider = ?
          ORDER BY created_at ASC, record_id ASC
        `).all(provider) as unknown as ProviderReliabilityRow[];

    return rows.map(toRecord);
  }

  public getProfile(input: { provider: string; family: string }) {
    return summarizeProviderReliability(
      this.listByProvider(input.provider, input.family),
      input.provider,
      input.family
    );
  }

  public deleteSession(sessionId: string) {
    this.db.prepare("DELETE FROM meta_provider_reliability_records WHERE session_id = ?").run(sessionId);
  }

  public close() {
    this.db.close();
  }
}

interface ProviderReliabilityRow {
  record_id: string;
  provider: string;
  family: string;
  provider_status: MetaSignalProviderReliabilityRecord["provider_status"];
  observed_success: number;
  session_id: string | null;
  cycle_id: string | null;
  created_at: string;
}

function toRecord(row: ProviderReliabilityRow): MetaSignalProviderReliabilityRecord {
  return {
    record_id: row.record_id,
    provider: row.provider,
    family: row.family,
    provider_status: row.provider_status,
    observed_success: row.observed_success === 1,
    session_id: row.session_id ?? undefined,
    cycle_id: row.cycle_id ?? undefined,
    created_at: row.created_at
  };
}
