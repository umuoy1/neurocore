import type { MemoryClaimStore, MemoryClaimStatus, PersonalMemoryClaim } from "./memory-claim-store.js";

export interface MemoryWikiClaim {
  claim_id: string;
  claim: string;
  status: MemoryClaimStatus;
  freshness_score: number;
  evidence_count: number;
  evidence_refs: Array<{
    ref_id: string;
    ref_type: string;
    session_id?: string;
    source_message_id?: string;
    summary?: string;
  }>;
  contradiction?: {
    contradicts_claim_ids: string[];
    score: number;
    summary: string;
  };
}

export interface MemoryWikiSection {
  subject: string;
  claims: MemoryWikiClaim[];
}

export interface MemoryWikiPage {
  user_id: string;
  title: string;
  sections: MemoryWikiSection[];
  markdown: string;
  rebuilt_at: string;
}

export function rebuildMemoryWikiPage(input: {
  store: MemoryClaimStore;
  user_id: string;
  statuses?: MemoryClaimStatus[];
  now?: string;
}): MemoryWikiPage {
  const rebuiltAt = input.now ?? new Date().toISOString();
  const claims = input.store.list({
    user_id: input.user_id,
    statuses: input.statuses ?? ["approved"],
    now: rebuiltAt
  });
  const sections = groupClaims(claims);
  const title = `Memory Wiki: ${input.user_id}`;
  return {
    user_id: input.user_id,
    title,
    sections,
    markdown: renderMarkdown(title, sections, rebuiltAt),
    rebuilt_at: rebuiltAt
  };
}

function groupClaims(claims: PersonalMemoryClaim[]): MemoryWikiSection[] {
  const grouped = new Map<string, PersonalMemoryClaim[]>();
  for (const claim of claims) {
    grouped.set(claim.subject, [...(grouped.get(claim.subject) ?? []), claim]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subject, items]) => ({
      subject,
      claims: items
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map(toWikiClaim)
    }));
}

function toWikiClaim(claim: PersonalMemoryClaim): MemoryWikiClaim {
  return {
    claim_id: claim.claim_id,
    claim: claim.claim,
    status: claim.status,
    freshness_score: claim.freshness.score,
    evidence_count: claim.evidence_refs.length,
    evidence_refs: claim.evidence_refs.map((ref) => ({
      ref_id: ref.ref_id,
      ref_type: ref.ref_type,
      session_id: ref.session_id,
      source_message_id: ref.source_message_id,
      summary: ref.summary
    })),
    contradiction: claim.contradiction
  };
}

function renderMarkdown(title: string, sections: MemoryWikiSection[], rebuiltAt: string): string {
  const lines = [`# ${title}`, "", `Rebuilt at: ${rebuiltAt}`];
  for (const section of sections) {
    lines.push("", `## ${section.subject}`);
    for (const claim of section.claims) {
      lines.push(`- ${claim.claim} (${claim.status}, freshness=${claim.freshness_score.toFixed(2)}, evidence=${claim.evidence_count})`);
      for (const ref of claim.evidence_refs) {
        const source = [ref.ref_type, ref.session_id, ref.source_message_id].filter(Boolean).join(":");
        lines.push(`  - evidence ${ref.ref_id}: ${source}${ref.summary ? ` - ${ref.summary}` : ""}`);
      }
      if (claim.contradiction && claim.contradiction.contradicts_claim_ids.length > 0) {
        lines.push(`  - contradiction: ${claim.contradiction.summary}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
