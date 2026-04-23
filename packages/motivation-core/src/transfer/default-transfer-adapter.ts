import type {
  AgentProfile,
  DomainDescriptor,
  DomainSimilarity,
  SkillDefinition,
  TransferAdapter,
  TransferResult
} from "@neurocore/protocol";

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function similarity(left: string, right: string): number {
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

export class DefaultTransferAdapter implements TransferAdapter {
  public readonly name = "default-transfer-adapter";

  public async transfer(ctx: import("@neurocore/protocol").ModuleContext, state: import("@neurocore/protocol").AutonomyState): Promise<TransferResult | null> {
    const targetDomain = this.describeTargetDomain(ctx.profile);
    const sourceDomainId =
      state.latest_transfer?.source_domain.domain_id ??
      ctx.profile.domain ??
      state.active_plan?.title ??
      "general";
    const source: DomainDescriptor = {
      domain_id: sourceDomainId,
      label: sourceDomainId,
      tags: tokenize(sourceDomainId).size > 0 ? [...tokenize(sourceDomainId)] : ["general"]
    };
    const similarityResult: DomainSimilarity = {
      source_domain: source.domain_id,
      target_domain: targetDomain.domain_id,
      similarity_score: similarity(source.domain_id, targetDomain.domain_id),
      source_domain_id: source.domain_id,
      target_domain_id: targetDomain.domain_id,
      score: similarity(source.domain_id, targetDomain.domain_id),
      evidence: ["token overlap"]
    };
    if (similarityResult.score < 0.2) {
      return null;
    }

    return {
      transfer_id: ctx.services.generateId("atr"),
      session_id: ctx.session.session_id,
      source_domain: source,
      target_domain: targetDomain,
      similarity: similarityResult,
      validation_status: similarityResult.score >= 0.5 ? "validated" : "pending",
      reusable_asset_ids: ctx.profile.skill_refs.slice(0, 3),
      confidence: similarityResult.score,
      summary: `Transfer assets from ${source.label} to ${targetDomain.label}.`,
      created_at: ctx.services.now()
    };
  }

  private describeTargetDomain(profile: AgentProfile): DomainDescriptor {
    const domainId = profile.domain ?? profile.role ?? "general";
    return {
      domain_id: domainId,
      label: domainId,
      tags: tokenize(domainId).size > 0 ? [...tokenize(domainId)] : ["general"]
    };
  }
}
