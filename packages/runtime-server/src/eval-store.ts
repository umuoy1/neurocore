import type { EvalRunReport } from "@neurocore/eval-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface EvalStore {
  save(report: EvalRunReport): void;
  get(runId: string): EvalRunReport | undefined;
  list(filter?: { tenant_id?: string; agent_id?: string; limit?: number; offset?: number }): EvalRunReport[];
  delete(runId: string): void;
}

export class InMemoryEvalStore implements EvalStore {
  private readonly reports = new Map<string, EvalRunReport>();

  public save(report: EvalRunReport): void {
    this.reports.set(report.run_id, report);
  }

  public get(runId: string): EvalRunReport | undefined {
    return this.reports.get(runId);
  }

  public list(filter?: { tenant_id?: string; agent_id?: string; limit?: number; offset?: number }): EvalRunReport[] {
    let results = Array.from(this.reports.values());

    if (filter?.tenant_id) {
      results = results.filter((r) => r.tenant_id === filter.tenant_id);
    }
    if (filter?.agent_id) {
      results = results.filter((r) => r.agent_id === filter.agent_id);
    }

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  public delete(runId: string): void {
    this.reports.delete(runId);
  }
}

export class SqliteEvalStore implements EvalStore {
  private readonly db: DatabaseSync;

  public constructor(options: { filename: string }) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_runs (
        run_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
  }

  public save(report: EvalRunReport): void {
    const status = report.pass_rate === 1 ? "passed" : "failed";
    this.db
      .prepare(`
        INSERT INTO eval_runs (run_id, tenant_id, agent_id, status, created_at, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          agent_id = excluded.agent_id,
          status = excluded.status,
          data = excluded.data
      `)
      .run(
        report.run_id,
        report.tenant_id ?? "",
        report.agent_id ?? "",
        status,
        report.started_at,
        JSON.stringify(report)
      );
  }

  public get(runId: string): EvalRunReport | undefined {
    const row = this.db
      .prepare("SELECT data FROM eval_runs WHERE run_id = ?")
      .get(runId) as { data: string } | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.data) as EvalRunReport;
  }

  public list(filter?: { tenant_id?: string; agent_id?: string; limit?: number; offset?: number }): EvalRunReport[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.tenant_id) {
      conditions.push("tenant_id = ?");
      params.push(filter.tenant_id);
    }
    if (filter?.agent_id) {
      conditions.push("agent_id = ?");
      params.push(filter.agent_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const sql = `SELECT data FROM eval_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as EvalRunReport);
  }

  public delete(runId: string): void {
    this.db.prepare("DELETE FROM eval_runs WHERE run_id = ?").run(runId);
  }

  public close(): void {
    this.db.close();
  }
}
