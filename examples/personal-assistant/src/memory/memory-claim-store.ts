export type MemoryClaimStatus = "candidate" | "approved" | "corrected" | "retired";

export type MemoryClaimEvidenceType = "personal_memory" | "session_search" | "manual" | "external";

export interface MemoryClaimEvidenceRef {
  ref_id: string;
  ref_type: MemoryClaimEvidenceType;
  summary?: string;
  session_id?: string;
  source_message_id?: string;
  url?: string;
  created_at?: string;
}

export interface MemoryClaimFreshness {
  observed_at: string;
  score: number;
  ttl_days?: number;
  expires_at?: string;
}

export interface MemoryClaimContradiction {
  contradicts_claim_ids: string[];
  score: number;
  summary: string;
}

export interface PersonalMemoryClaim {
  claim_id: string;
  user_id: string;
  subject: string;
  claim: string;
  status: MemoryClaimStatus;
  evidence_refs: MemoryClaimEvidenceRef[];
  freshness: MemoryClaimFreshness;
  contradiction?: MemoryClaimContradiction;
  correction_of?: string;
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  reviewer_id?: string;
  metadata: Record<string, unknown>;
}

export interface CreateMemoryClaimInput {
  user_id: string;
  subject: string;
  claim: string;
  status?: MemoryClaimStatus;
  evidence_refs?: MemoryClaimEvidenceRef[];
  observed_at?: string;
  ttl_days?: number;
  correction_of?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryClaimListQuery {
  user_id: string;
  statuses?: MemoryClaimStatus[];
  subject?: string;
  include_retired?: boolean;
  now?: string;
}

export interface MemoryClaimReviewInput {
  reviewer_id: string;
  reviewed_at?: string;
}

export interface MemoryClaimCorrectionInput extends MemoryClaimReviewInput {
  claim: string;
  evidence_refs?: MemoryClaimEvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface MemoryClaimStore {
  create(input: CreateMemoryClaimInput): PersonalMemoryClaim;
  get(claimId: string): PersonalMemoryClaim | undefined;
  list(query: MemoryClaimListQuery): PersonalMemoryClaim[];
  approve(claimId: string, input: MemoryClaimReviewInput): PersonalMemoryClaim | undefined;
  correct(claimId: string, input: MemoryClaimCorrectionInput): { retired: PersonalMemoryClaim; claim: PersonalMemoryClaim } | undefined;
  retire(claimId: string, input: MemoryClaimReviewInput): PersonalMemoryClaim | undefined;
  close?(): void;
}

export function computeClaimFreshness(input: {
  observed_at: string;
  ttl_days?: number;
  now?: string;
  expires_at?: string;
}): MemoryClaimFreshness {
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const observedMs = Date.parse(input.observed_at);
  const safeObservedMs = Number.isFinite(observedMs) ? observedMs : nowMs;
  const ttlDays = input.ttl_days ?? 90;
  const ageDays = Number.isFinite(nowMs) && Number.isFinite(observedMs)
    ? Math.max(0, (nowMs - observedMs) / 86_400_000)
    : 0;
  const score = Math.max(0, Math.min(1, 1 - ageDays / ttlDays));
  const expiresAt = input.expires_at ?? new Date(safeObservedMs + ttlDays * 86_400_000).toISOString();
  return {
    observed_at: input.observed_at,
    score,
    ttl_days: ttlDays,
    expires_at: expiresAt
  };
}
