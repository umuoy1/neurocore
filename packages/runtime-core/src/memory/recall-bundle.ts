import type {
  Episode,
  MemoryDigest,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  ProceduralSkillSpec,
  Proposal,
  SemanticCard
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

export function createMemoryRecallBundle(input: {
  plan: MemoryRetrievalPlan;
  digests: MemoryDigest[];
  proposals: Proposal[];
  episodicEpisodes?: Episode[];
  semanticCards?: SemanticCard[];
  skillSpecs?: ProceduralSkillSpec[];
  warnings?: MemoryWarning[];
}): MemoryRecallBundle {
  return {
    bundle_id: generateId("mrb"),
    session_id: input.plan.session_id,
    cycle_id: input.plan.cycle_id,
    plan_id: input.plan.plan_id,
    digests: input.digests,
    proposals: input.proposals,
    episodic_episodes: input.episodicEpisodes,
    semantic_cards: input.semanticCards,
    skill_specs: input.skillSpecs,
    warnings: input.warnings,
    created_at: nowIso()
  };
}
