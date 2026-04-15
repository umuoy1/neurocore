import type { ReasoningMetaSignals } from "@neurocore/protocol";
import {
  clamp01,
  computeActionDivergence,
  countAssumptions,
  provenance,
  type MetaSignalInput,
  type MetaSignalProvider
} from "./provider.js";

export class HeuristicReasoningSignalProvider implements MetaSignalProvider<ReasoningMetaSignals> {
  public readonly name = "heuristic-reasoning-provider";
  public readonly family = "reasoning" as const;

  public collect(input: MetaSignalInput) {
    const timestamp = input.ctx.services.now();
    const warnCount = input.policies.filter((decision) => decision.level === "warn").length;
    const blockCount = input.policies.filter((decision) => decision.level === "block").length;
    const divergence = computeActionDivergence(input.actions);
    const contradictionScore = clamp01(
      ((input.workspace.competition_log?.conflicts.length ?? 0) * 0.35) +
        (warnCount > 0 ? 0.15 : 0) +
        blockCount * 0.2 +
        (input.predictionErrorRate ?? 0) * 0.3
    );
    const retrievalCoverage =
      input.workspace.memory_digest.length > 0
        ? clamp01(Math.min(1, input.workspace.memory_digest.length / Math.max(input.ctx.profile.memory_config.retrieval_top_k ?? 5, 1)))
        : 0;

    return {
      signals: {
        candidate_reasoning_divergence: divergence,
        step_consistency: clamp01(1 - contradictionScore),
        contradiction_score: contradictionScore,
        assumption_count: countAssumptions(input.actions),
        unsupported_leap_count: retrievalCoverage < 0.35 ? 1 : 0,
        self_consistency_margin: clamp01(1 - divergence)
      },
      provenance: [
        provenance("reasoning", "candidate_reasoning_divergence", this.name, "ok", timestamp),
        provenance("reasoning", "contradiction_score", this.name, "ok", timestamp)
      ]
    };
  }
}
