import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface AuditEntry {
  entry_id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AuditQueryFilter {
  tenant_id?: string;
  user_id?: string;
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditStore {
  record(entry: Omit<AuditEntry, "entry_id" | "timestamp">): AuditEntry;
  query(filter?: AuditQueryFilter): { entries: AuditEntry[]; total: number };
}

let idCounter = 0;

export class InMemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  public record(entry: Omit<AuditEntry, "entry_id" | "timestamp">): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      entry_id: `audit_${Date.now()}_${++idCounter}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);
    return full;
  }

  public query(filter?: AuditQueryFilter): { entries: AuditEntry[]; total: number } {
    let results = this.entries;

    if (filter?.tenant_id) {
      results = results.filter((e) => e.tenant_id === filter.tenant_id);
    }
    if (filter?.user_id) {
      results = results.filter((e) => e.user_id === filter.user_id);
    }
    if (filter?.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter?.target_type) {
      results = results.filter((e) => e.target_type === filter.target_type);
    }
    if (filter?.from) {
      const from = new Date(filter.from).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= from);
    }
    if (filter?.to) {
      const to = new Date(filter.to).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= to);
    }

    const total = results.length;
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;

    return {
      entries: results.slice(offset, offset + limit).reverse(),
      total,
    };
  }
}

export class SqliteAuditStore implements AuditStore {
  private readonly db: DatabaseSync;

  public constructor(options: { filename: string }) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        entry_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details TEXT NOT NULL
      );
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);`);
  }

  public record(entry: Omit<AuditEntry, "entry_id" | "timestamp">): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      entry_id: `audit_${Date.now()}_${++idCounter}`,
      timestamp: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO audit_log (entry_id, tenant_id, user_id, action, target_type, target_id, timestamp, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.entry_id,
        full.tenant_id,
        full.user_id,
        full.action,
        full.target_type,
        full.target_id,
        full.timestamp,
        JSON.stringify(full.details),
      );
    return full;
  }

  public query(filter?: AuditQueryFilter): { entries: AuditEntry[]; total: number } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.tenant_id) {
      conditions.push("tenant_id = ?");
      params.push(filter.tenant_id);
    }
    if (filter?.user_id) {
      conditions.push("user_id = ?");
      params.push(filter.user_id);
    }
    if (filter?.action) {
      conditions.push("action = ?");
      params.push(filter.action);
    }
    if (filter?.target_type) {
      conditions.push("target_type = ?");
      params.push(filter.target_type);
    }
    if (filter?.from) {
      conditions.push("timestamp >= ?");
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push("timestamp <= ?");
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`).get(...params) as {
      cnt: number;
    };
    const total = countRow.cnt;

    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;
    params.push(limit, offset);

    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params) as Array<Record<string, string>>;

    const entries: AuditEntry[] = rows.map((row) => ({
      entry_id: row.entry_id,
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      details: JSON.parse(row.details),
      timestamp: row.timestamp,
    }));

    return { entries, total };
  }

  public close(): void {
    this.db.close();
  }
}
