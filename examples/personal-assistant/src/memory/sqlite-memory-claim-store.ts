import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateMemoryClaimInput,
  MemoryClaimContradiction,
  MemoryClaimCorrectionInput,
  MemoryClaimEvidenceRef,
  MemoryClaimFreshness,
  MemoryClaimListQuery,
  MemoryClaimReviewInput,
  MemoryClaimStatus,
  MemoryClaimStore,
  PersonalMemoryClaim
} from "./memory-claim-store.js";
import { computeClaimFreshness } from "./memory-claim-store.js";

export interface SqliteMemoryClaimStoreOptions {
  filename: string;
}

export class SqliteMemoryClaimStore implements MemoryClaimStore {
  private readonly db: DatabaseSync;

  public constructor(options: SqliteMemoryClaimStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_memory_claims (
        claim_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        claim TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        freshness_json TEXT NOT NULL,
        contradiction_json TEXT,
        correction_of TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewer_id TEXT,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_memory_claims_user_status
        ON personal_memory_claims(user_id, status, updated_at DESC, claim_id DESC);
      CREATE INDEX IF NOT EXISTS idx_personal_memory_claims_user_subject
        ON personal_memory_claims(user_id, subject, status, updated_at DESC);
    `);
  }

  public create(input: CreateMemoryClaimInput): PersonalMemoryClaim {
    const now = input.created_at ?? new Date().toISOString();
    const evidenceRefs = input.evidence_refs ?? [];
    const freshness = computeClaimFreshness({
      observed_at: input.observed_at ?? evidenceRefs[0]?.created_at ?? now,
      ttl_days: input.ttl_days,
      now
    });
    const claim: PersonalMemoryClaim = {
      claim_id: `pmc_${randomUUID()}`,
      user_id: input.user_id,
      subject: normalizeSubject(input.subject),
      claim: input.claim.trim(),
      status: input.status ?? "candidate",
      evidence_refs: evidenceRefs,
      freshness,
      contradiction: this.detectContradiction(input.user_id, normalizeSubject(input.subject), input.claim, input.correction_of),
      correction_of: input.correction_of,
      created_at: now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    this.insert(claim);
    return claim;
  }

  public get(claimId: string): PersonalMemoryClaim | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM personal_memory_claims
      WHERE claim_id = ?
    `).get(claimId) as unknown as MemoryClaimRow | undefined;
    return row ? toClaim(row) : undefined;
  }

  public list(query: MemoryClaimListQuery): PersonalMemoryClaim[] {
    const statuses = query.statuses && query.statuses.length > 0
      ? query.statuses
      : query.include_retired
        ? ["candidate", "approved", "corrected", "retired"] as MemoryClaimStatus[]
        : ["candidate", "approved"] as MemoryClaimStatus[];
    const clauses = ["user_id = ?", `status IN (${statuses.map(() => "?").join(", ")})`];
    const params: string[] = [query.user_id, ...statuses];

    if (query.subject) {
      clauses.push("subject = ?");
      params.push(normalizeSubject(query.subject));
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM personal_memory_claims
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC, claim_id DESC
    `).all(...params) as unknown as MemoryClaimRow[];
    return rows.map(toClaim).map((claim) => refreshClaim(claim, query.now));
  }

  public approve(claimId: string, input: MemoryClaimReviewInput): PersonalMemoryClaim | undefined {
    return this.updateReview(claimId, "approved", input);
  }

  public correct(
    claimId: string,
    input: MemoryClaimCorrectionInput
  ): { retired: PersonalMemoryClaim; claim: PersonalMemoryClaim } | undefined {
    const existing = this.get(claimId);
    if (!existing) {
      return undefined;
    }
    const reviewedAt = input.reviewed_at ?? new Date().toISOString();
    const retired = this.updateReview(claimId, "corrected", {
      reviewer_id: input.reviewer_id,
      reviewed_at: reviewedAt
    });
    if (!retired) {
      return undefined;
    }
    const claim = this.create({
      user_id: existing.user_id,
      subject: existing.subject,
      claim: input.claim,
      status: "approved",
      evidence_refs: input.evidence_refs ?? existing.evidence_refs,
      observed_at: reviewedAt,
      correction_of: existing.claim_id,
      created_at: reviewedAt,
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {})
      }
    });
    this.updateReviewer(claim.claim_id, input.reviewer_id, reviewedAt);
    return {
      retired,
      claim: this.get(claim.claim_id) ?? claim
    };
  }

  public retire(claimId: string, input: MemoryClaimReviewInput): PersonalMemoryClaim | undefined {
    return this.updateReview(claimId, "retired", input);
  }

  public close(): void {
    this.db.close();
  }

  private insert(claim: PersonalMemoryClaim): void {
    this.db.prepare(`
      INSERT INTO personal_memory_claims (
        claim_id,
        user_id,
        subject,
        claim,
        status,
        evidence_refs_json,
        freshness_json,
        contradiction_json,
        correction_of,
        created_at,
        updated_at,
        reviewed_at,
        reviewer_id,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      claim.claim_id,
      claim.user_id,
      claim.subject,
      claim.claim,
      claim.status,
      JSON.stringify(claim.evidence_refs),
      JSON.stringify(claim.freshness),
      claim.contradiction ? JSON.stringify(claim.contradiction) : null,
      claim.correction_of ?? null,
      claim.created_at,
      claim.updated_at,
      claim.reviewed_at ?? null,
      claim.reviewer_id ?? null,
      JSON.stringify(claim.metadata)
    );
  }

  private updateReview(
    claimId: string,
    status: MemoryClaimStatus,
    input: MemoryClaimReviewInput
  ): PersonalMemoryClaim | undefined {
    const reviewedAt = input.reviewed_at ?? new Date().toISOString();
    this.db.prepare(`
      UPDATE personal_memory_claims
      SET status = ?,
          reviewed_at = ?,
          reviewer_id = ?,
          updated_at = ?
      WHERE claim_id = ?
    `).run(status, reviewedAt, input.reviewer_id, reviewedAt, claimId);
    return this.get(claimId);
  }

  private updateReviewer(claimId: string, reviewerId: string, reviewedAt: string): void {
    this.db.prepare(`
      UPDATE personal_memory_claims
      SET reviewed_at = ?, reviewer_id = ?, updated_at = ?
      WHERE claim_id = ?
    `).run(reviewedAt, reviewerId, reviewedAt, claimId);
  }

  private detectContradiction(
    userId: string,
    subject: string,
    claim: string,
    correctionOf: string | undefined
  ): MemoryClaimContradiction | undefined {
    const rows = this.db.prepare(`
      SELECT claim_id, claim
      FROM personal_memory_claims
      WHERE user_id = ?
        AND subject = ?
        AND status IN ('candidate', 'approved')
      ORDER BY updated_at DESC
      LIMIT 8
    `).all(userId, subject) as unknown as Array<{ claim_id: string; claim: string }>;
    const normalized = normalizeClaimText(claim);
    const contradicted = rows.filter((row) =>
      row.claim_id !== correctionOf &&
      normalizeClaimText(row.claim) !== normalized
    );
    if (contradicted.length === 0) {
      return undefined;
    }
    return {
      contradicts_claim_ids: contradicted.map((row) => row.claim_id),
      score: 0.8,
      summary: `Claim differs from ${contradicted.length} active claim(s) for subject "${subject}".`
    };
  }
}

interface MemoryClaimRow {
  claim_id: string;
  user_id: string;
  subject: string;
  claim: string;
  status: string;
  evidence_refs_json: string;
  freshness_json: string;
  contradiction_json: string | null;
  correction_of: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  metadata_json: string;
}

function toClaim(row: MemoryClaimRow): PersonalMemoryClaim {
  return {
    claim_id: row.claim_id,
    user_id: row.user_id,
    subject: row.subject,
    claim: row.claim,
    status: normalizeStatus(row.status),
    evidence_refs: parseArray(row.evidence_refs_json).map(toEvidenceRef),
    freshness: toFreshness(parseRecord(row.freshness_json), row.created_at),
    contradiction: row.contradiction_json ? toContradiction(parseRecord(row.contradiction_json)) : undefined,
    correction_of: row.correction_of ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at ?? undefined,
    reviewer_id: row.reviewer_id ?? undefined,
    metadata: parseRecord(row.metadata_json)
  };
}

function refreshClaim(claim: PersonalMemoryClaim, now: string | undefined): PersonalMemoryClaim {
  if (!now) {
    return claim;
  }
  return {
    ...claim,
    freshness: computeClaimFreshness({
      observed_at: claim.freshness.observed_at,
      ttl_days: claim.freshness.ttl_days,
      expires_at: claim.freshness.expires_at,
      now
    })
  };
}

function toEvidenceRef(value: unknown): MemoryClaimEvidenceRef {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const refType = item.ref_type === "personal_memory" || item.ref_type === "session_search" || item.ref_type === "external"
    ? item.ref_type
    : "manual";
  return {
    ref_id: typeof item.ref_id === "string" ? item.ref_id : `ev_${randomUUID()}`,
    ref_type: refType,
    summary: typeof item.summary === "string" ? item.summary : undefined,
    session_id: typeof item.session_id === "string" ? item.session_id : undefined,
    source_message_id: typeof item.source_message_id === "string" ? item.source_message_id : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    created_at: typeof item.created_at === "string" ? item.created_at : undefined
  };
}

function toFreshness(value: Record<string, unknown>, fallbackObservedAt: string): MemoryClaimFreshness {
  return {
    observed_at: typeof value.observed_at === "string" ? value.observed_at : fallbackObservedAt,
    score: typeof value.score === "number" ? value.score : 1,
    ttl_days: typeof value.ttl_days === "number" ? value.ttl_days : undefined,
    expires_at: typeof value.expires_at === "string" ? value.expires_at : undefined
  };
}

function toContradiction(value: Record<string, unknown>): MemoryClaimContradiction {
  return {
    contradicts_claim_ids: Array.isArray(value.contradicts_claim_ids)
      ? value.contradicts_claim_ids.filter((item): item is string => typeof item === "string")
      : [],
    score: typeof value.score === "number" ? value.score : 0,
    summary: typeof value.summary === "string" ? value.summary : ""
  };
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeSubject(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeClaimText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeStatus(value: string): MemoryClaimStatus {
  if (value === "approved" || value === "corrected" || value === "retired") {
    return value;
  }
  return "candidate";
}
