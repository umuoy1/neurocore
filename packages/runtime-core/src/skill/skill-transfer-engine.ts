import type { AgentProfile, SkillDefinition, SkillTransferEngine, SkillTransferResult } from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

export class DefaultSkillTransferEngine implements SkillTransferEngine {
  public transfer(input: {
    tenant_id: string;
    profile: AgentProfile;
    target_domain: string;
    skill: SkillDefinition;
  }): { result: SkillTransferResult; skill: SkillDefinition } | null {
    const sourceDomain = input.skill.applicable_domains?.[0];
    if (!sourceDomain || sourceDomain === input.target_domain) {
      return null;
    }

    const similarityScore = computeDomainSimilarity(sourceDomain, input.target_domain);
    const threshold = input.profile.rl_config?.transfer?.similarity_threshold ?? 0.72;
    if (similarityScore < threshold) {
      return null;
    }

    const confidencePenalty = input.profile.rl_config?.transfer?.confidence_penalty ?? 0.15;
    const validationUses = input.profile.rl_config?.transfer?.validation_uses ?? 3;
    const transferredSkillId = generateId("skl");
    const transferredSkill: SkillDefinition = {
      ...structuredClone(input.skill),
      skill_id: transferredSkillId,
      version: bumpMinorVersion(input.skill.version),
      status: "active",
      applicable_domains: [...new Set([...(input.skill.applicable_domains ?? []), input.target_domain])],
      metadata: {
        ...(input.skill.metadata ?? {}),
        tenant_id: input.tenant_id,
        transferred_from_skill_id: input.skill.skill_id,
        source_domain: sourceDomain,
        target_domain: input.target_domain,
        similarity_score: similarityScore,
        confidence_penalty: confidencePenalty,
        validation_remaining_uses: validationUses,
        transferred_at: nowIso()
      }
    };

    const result: SkillTransferResult = {
      transfer_id: generateId("trf"),
      tenant_id: input.tenant_id,
      source_skill_id: input.skill.skill_id,
      target_skill_id: transferredSkillId,
      source_domain: sourceDomain,
      target_domain: input.target_domain,
      similarity_score: similarityScore,
      created_at: nowIso()
    };

    return {
      result,
      skill: transferredSkill
    };
  }
}

function computeDomainSimilarity(left: string, right: string): number {
  const leftTerms = tokenize(left);
  const rightTerms = tokenize(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      overlap += 1;
    }
  }
  return overlap / Math.sqrt(leftTerms.size * rightTerms.size);
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function bumpMinorVersion(version: string) {
  const [major, minor = "0"] = version.split(".");
  const nextMinor = Number.parseInt(minor, 10);
  if (Number.isNaN(nextMinor)) {
    return `${version}.1`;
  }
  return `${major}.${nextMinor + 1}.0`;
}
