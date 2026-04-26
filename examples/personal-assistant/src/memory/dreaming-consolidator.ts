import { randomUUID } from "node:crypto";
import type { MemoryClaimEvidenceRef, MemoryClaimStore, PersonalMemoryClaim } from "./memory-claim-store.js";
import type { SessionSearchResult, SessionSearchStore } from "./session-search-store.js";

export type DreamingCandidateStatus = "proposed" | "rejected" | "approved";

export interface DreamingSafetyCheck {
  name: "duplicate" | "conflict" | "privacy" | "injection";
  passed: boolean;
  reason?: string;
  related_claim_ids?: string[];
}

export interface DreamingMemoryCandidate {
  candidate_id: string;
  user_id: string;
  subject: string;
  claim: string;
  status: DreamingCandidateStatus;
  review_status: "pending" | "approved" | "rejected";
  evidence_refs: MemoryClaimEvidenceRef[];
  source_entry_ids: string[];
  safety_checks: DreamingSafetyCheck[];
  rejection_reasons: string[];
  confidence: number;
  created_at: string;
}

export interface DreamingBatch {
  batch_id: string;
  tenant_id: string;
  user_id: string;
  status: "reviewable";
  candidates: DreamingMemoryCandidate[];
  safety_summary: {
    proposed_count: number;
    rejected_count: number;
    duplicate_count: number;
    conflict_count: number;
    privacy_count: number;
    injection_count: number;
  };
  created_at: string;
}

export interface DreamingRunInput {
  tenant_id: string;
  user_id: string;
  since?: string;
  limit?: number;
  now?: string;
}

export class DreamingConsolidator {
  public constructor(
    private readonly sessionSearchStore: SessionSearchStore,
    private readonly claimStore: MemoryClaimStore
  ) {}

  public run(input: DreamingRunInput): DreamingBatch {
    const now = input.now ?? new Date().toISOString();
    const entries = this.sessionSearchStore.search({
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      start_at: input.since,
      limit: input.limit ?? 50
    });
    const candidates = entries
      .map((entry) => this.toCandidate(input.user_id, entry, now))
      .filter((candidate): candidate is DreamingMemoryCandidate => Boolean(candidate));
    return {
      batch_id: `drm_${randomUUID()}`,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      status: "reviewable",
      candidates,
      safety_summary: summarize(candidates),
      created_at: now
    };
  }

  public approveCandidate(
    candidate: DreamingMemoryCandidate,
    reviewer_id: string,
    reviewed_at = new Date().toISOString()
  ): PersonalMemoryClaim {
    if (candidate.status !== "proposed") {
      throw new Error(`Candidate ${candidate.candidate_id} is not eligible for approval.`);
    }
    const claim = this.claimStore.create({
      user_id: candidate.user_id,
      subject: candidate.subject,
      claim: candidate.claim,
      status: "approved",
      evidence_refs: candidate.evidence_refs,
      observed_at: candidate.evidence_refs[0]?.created_at ?? candidate.created_at,
      created_at: reviewed_at,
      metadata: {
        dreaming_candidate_id: candidate.candidate_id,
        source_entry_ids: candidate.source_entry_ids,
        safety_checks: candidate.safety_checks
      }
    });
    this.claimStore.approve(claim.claim_id, {
      reviewer_id,
      reviewed_at
    });
    return this.claimStore.get(claim.claim_id) ?? claim;
  }

  private toCandidate(
    userId: string,
    entry: SessionSearchResult,
    now: string
  ): DreamingMemoryCandidate | undefined {
    const claimText = normalizeClaim(entry.content);
    if (!claimText || claimText.length < 8) {
      return undefined;
    }
    const subject = deriveSubject(claimText);
    const evidence: MemoryClaimEvidenceRef[] = [
      {
        ref_id: entry.entry_id,
        ref_type: "session_search",
        session_id: entry.session_id,
        source_message_id: entry.source_message_id,
        summary: claimText,
        created_at: entry.created_at
      }
    ];
    const safetyChecks = this.runSafetyChecks(userId, subject, claimText);
    const rejectionReasons = safetyChecks
      .filter((check) => !check.passed)
      .map((check) => check.reason ?? check.name);
    return {
      candidate_id: `dmc_${randomUUID()}`,
      user_id: userId,
      subject,
      claim: claimText,
      status: rejectionReasons.length > 0 ? "rejected" : "proposed",
      review_status: "pending",
      evidence_refs: evidence,
      source_entry_ids: [entry.entry_id],
      safety_checks: safetyChecks,
      rejection_reasons: rejectionReasons,
      confidence: rejectionReasons.length > 0 ? 0.2 : 0.74,
      created_at: now
    };
  }

  private runSafetyChecks(userId: string, subject: string, claim: string): DreamingSafetyCheck[] {
    const activeClaims = this.claimStore.list({
      user_id: userId,
      statuses: ["candidate", "approved"]
    });
    const normalized = normalizeForCompare(claim);
    const duplicates = activeClaims.filter((item) => normalizeForCompare(item.claim) === normalized);
    const conflicts = activeClaims.filter((item) =>
      item.subject === subject &&
      normalizeForCompare(item.claim) !== normalized
    );
    const privacyReason = detectPrivacyRisk(claim);
    const injectionReason = detectInjectionRisk(claim);

    return [
      {
        name: "duplicate",
        passed: duplicates.length === 0,
        reason: duplicates.length > 0 ? "Duplicate active claim already exists." : undefined,
        related_claim_ids: duplicates.map((item) => item.claim_id)
      },
      {
        name: "conflict",
        passed: conflicts.length === 0,
        reason: conflicts.length > 0 ? "Candidate conflicts with active claim for the same subject." : undefined,
        related_claim_ids: conflicts.map((item) => item.claim_id)
      },
      {
        name: "privacy",
        passed: !privacyReason,
        reason: privacyReason
      },
      {
        name: "injection",
        passed: !injectionReason,
        reason: injectionReason
      }
    ];
  }
}

function summarize(candidates: DreamingMemoryCandidate[]): DreamingBatch["safety_summary"] {
  return {
    proposed_count: candidates.filter((candidate) => candidate.status === "proposed").length,
    rejected_count: candidates.filter((candidate) => candidate.status === "rejected").length,
    duplicate_count: countFailed(candidates, "duplicate"),
    conflict_count: countFailed(candidates, "conflict"),
    privacy_count: countFailed(candidates, "privacy"),
    injection_count: countFailed(candidates, "injection")
  };
}

function countFailed(candidates: DreamingMemoryCandidate[], name: DreamingSafetyCheck["name"]): number {
  return candidates.filter((candidate) =>
    candidate.safety_checks.some((check) => check.name === name && !check.passed)
  ).length;
}

function normalizeClaim(value: string): string {
  return value
    .replace(/^assistant:\s*/i, "")
    .replace(/^user:\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function deriveSubject(claim: string): string {
  const lower = claim.toLowerCase();
  if (/(prefer|prefers|like|likes|favorite|favourite)/.test(lower)) {
    return "preference";
  }
  if (/(timezone|time zone|location|city|country)/.test(lower)) {
    return "identity";
  }
  if (/(project|draft|codename|deadline)/.test(lower)) {
    return "project";
  }
  return lower.split(/[.!?]/)[0].slice(0, 48).trim() || "general";
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function detectPrivacyRisk(value: string): string | undefined {
  const lower = value.toLowerCase();
  if (/\b(api[_ -]?key|password|secret|token|ssn|social security)\b/.test(lower)) {
    return "Candidate contains sensitive credential or identity keywords.";
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) {
    return "Candidate appears to contain a US SSN.";
  }
  if (/\b(?:\d[ -]*?){13,16}\b/.test(value)) {
    return "Candidate appears to contain a payment card number.";
  }
  return undefined;
}

function detectInjectionRisk(value: string): string | undefined {
  const lower = value.toLowerCase();
  if (/(ignore previous|system prompt|developer message|reveal hidden|tool call|<\/?script)/.test(lower)) {
    return "Candidate contains prompt or tool injection language.";
  }
  return undefined;
}
