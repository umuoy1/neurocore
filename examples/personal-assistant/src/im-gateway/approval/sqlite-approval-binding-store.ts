import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ApprovalBinding, IMPlatform } from "../types.js";
import type { ApprovalBindingStore } from "./approval-binding-store.js";

export interface SqliteApprovalBindingStoreOptions {
  filename: string;
}

export class SqliteApprovalBindingStore implements ApprovalBindingStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteApprovalBindingStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_bindings (
        platform TEXT NOT NULL,
        platform_message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, platform_message_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_bindings_approval
        ON approval_bindings (approval_id);
    `);
  }

  public upsertBinding(binding: ApprovalBinding): void {
    this.db
      .prepare(`
        INSERT INTO approval_bindings (
          platform, platform_message_id, session_id, approval_id, chat_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, platform_message_id) DO UPDATE SET
          session_id = excluded.session_id,
          approval_id = excluded.approval_id,
          chat_id = excluded.chat_id,
          updated_at = excluded.updated_at
      `)
      .run(
        binding.platform,
        binding.platform_message_id,
        binding.session_id,
        binding.approval_id,
        binding.chat_id,
        binding.created_at,
        binding.updated_at
      );
  }

  public getBinding(platform: IMPlatform, platformMessageId: string): ApprovalBinding | undefined {
    return this.db
      .prepare(`
        SELECT platform, platform_message_id, session_id, approval_id, chat_id, created_at, updated_at
        FROM approval_bindings
        WHERE platform = ? AND platform_message_id = ?
      `)
      .get(platform, platformMessageId) as ApprovalBinding | undefined;
  }

  public getBindingByApprovalId(approvalId: string): ApprovalBinding | undefined {
    return this.db
      .prepare(`
        SELECT platform, platform_message_id, session_id, approval_id, chat_id, created_at, updated_at
        FROM approval_bindings
        WHERE approval_id = ?
      `)
      .get(approvalId) as ApprovalBinding | undefined;
  }

  public deleteByApprovalId(approvalId: string): void {
    this.db
      .prepare("DELETE FROM approval_bindings WHERE approval_id = ?")
      .run(approvalId);
  }
}
