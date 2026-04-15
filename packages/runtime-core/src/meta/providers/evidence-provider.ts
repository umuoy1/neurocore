import type { EvidenceMetaSignals } from "@neurocore/protocol";
import {
  clamp01,
  isTimeSensitiveInput,
  provenance,
  type MetaSignalInput,
  type MetaSignalProvider
} from "./provider.js";

export class HeuristicEvidenceSignalProvider implements MetaSignalProvider<EvidenceMetaSignals> {
  public readonly name = "heuristic-evidence-provider";
  public readonly family = "evidence" as const;

  public collect(input: MetaSignalInput) {
    const timestamp = input.ctx.services.now();
    const warnCount = input.policies.filter((decision) => decision.level === "warn").length;
    const blockCount = input.policies.filter((decision) => decision.level === "block").length;
    const memoryRecallProposals = Array.isArray(input.ctx.runtime_state.memory_recall_proposals)
      ? input.ctx.runtime_state.memory_recall_proposals.length
      : 0;
    const retrievalTopK = Math.max(input.ctx.profile.memory_config.retrieval_top_k ?? 5, 1);
    const retrievalCoverage = clamp01(
      input.workspace.memory_digest.length > 0
        ? Math.min(1, input.workspace.memory_digest.length / retrievalTopK)
        : memoryRecallProposals > 0
          ? Math.min(1, memoryRecallProposals / retrievalTopK)
          : 0
    );
    const evidenceFreshness = computeEvidenceFreshness(input, retrievalCoverage);
    const evidenceAgreement = computeEvidenceAgreement(input, warnCount, blockCount);
    const sourceReliabilityPrior = computeSourceReliabilityPrior(input, retrievalCoverage);
    const missingCriticalEvidenceFlags = buildMissingEvidenceFlags(input, retrievalCoverage);

    return {
      signals: {
        retrieval_coverage: retrievalCoverage,
        evidence_freshness: evidenceFreshness,
        evidence_agreement_score: evidenceAgreement,
        source_reliability_prior: sourceReliabilityPrior,
        missing_critical_evidence_flags: missingCriticalEvidenceFlags
      },
      provenance: [
        provenance(
          "evidence",
          "retrieval_coverage",
          this.name,
          memoryRecallProposals > 0 ? "ok" : "fallback",
          timestamp
        ),
        provenance(
          "evidence",
          "evidence_freshness",
          this.name,
          evidenceFreshness >= 0.5 ? "degraded" : "fallback",
          timestamp
        ),
        provenance(
          "evidence",
          "source_reliability_prior",
          this.name,
          sourceReliabilityPrior > 0 ? "degraded" : "fallback",
          timestamp
        )
      ]
    };
  }
}

function buildMissingEvidenceFlags(input: MetaSignalInput, retrievalCoverage: number) {
  const flags: string[] = [];
  if (retrievalCoverage < 0.35) {
    flags.push("low_retrieval_coverage");
  }
  if (input.actions.some((action) => action.action_type === "call_tool" && !action.tool_name)) {
    flags.push("missing_tool_name");
  }
  if ((input.workspace.competition_log?.conflicts.length ?? 0) > 0 && retrievalCoverage < 0.5) {
    flags.push("conflict_without_supporting_evidence");
  }
  if (isTimeSensitiveInput(input.ctx.runtime_state.current_input_content) && retrievalCoverage < 0.5) {
    flags.push("missing_current_grounding");
  }
  if (
    input.actions.some(
      (action) => action.action_type === "call_tool" && (!action.tool_args || Object.keys(action.tool_args).length === 0)
    )
  ) {
    flags.push("missing_tool_schema");
  }
  return flags;
}

function computeEvidenceFreshness(input: MetaSignalInput, retrievalCoverage: number) {
  if (isTimeSensitiveInput(input.ctx.runtime_state.current_input_content)) {
    return retrievalCoverage > 0.5 ? 0.65 : 0.25;
  }
  if (input.workspace.memory_digest.length > 0) {
    return 0.75;
  }
  return 0.5;
}

function computeEvidenceAgreement(input: MetaSignalInput, warnCount: number, blockCount: number) {
  const conflictPenalty =
    (input.workspace.competition_log?.conflicts.length ?? 0) /
    Math.max(input.workspace.competition_log?.entries.length ?? 1, 1);
  const governancePenalty = clamp01(warnCount * 0.1 + blockCount * 0.2);
  return clamp01(1 - conflictPenalty - governancePenalty);
}

function computeSourceReliabilityPrior(input: MetaSignalInput, retrievalCoverage: number) {
  const semanticRatio =
    input.workspace.memory_digest.length === 0
      ? 0
      : input.workspace.memory_digest.filter((row) => row.memory_type === "semantic" || row.memory_type === "procedural").length /
        input.workspace.memory_digest.length;
  return clamp01(
    0.45 +
      retrievalCoverage * 0.25 +
      semanticRatio * 0.15 -
      (input.predictionErrorRate ?? 0) * 0.15
  );
}
