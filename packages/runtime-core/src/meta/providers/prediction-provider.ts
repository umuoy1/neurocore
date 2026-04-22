import type { PredictionMetaSignals } from "@neurocore/protocol";
import {
  average,
  clamp01,
  computeActionDivergence,
  computePredictorDisagreement,
  provenance,
  type MetaSignalInput,
  type MetaSignalProvider
} from "./provider.js";

export class HeuristicPredictionSignalProvider implements MetaSignalProvider<PredictionMetaSignals> {
  public readonly name = "heuristic-prediction-provider";
  public readonly family = "prediction" as const;

  public collect(input: MetaSignalInput) {
    const timestamp = input.ctx.services.now();
    const avgPredictionSuccess = average(
      input.predictions.map((prediction) => prediction.success_probability).filter((value): value is number => typeof value === "number")
    );
    const avgPredictionUncertainty = average(
      input.predictions.map((prediction) => prediction.uncertainty).filter((value): value is number => typeof value === "number")
    );
    const avgExpectedFreeEnergy = average(
      input.predictions
        .map((prediction) => prediction.expected_free_energy)
        .filter((value): value is number => typeof value === "number")
    );
    const predictorDisagreement = computePredictorDisagreement(input.predictions);
    const calibrationGap = clamp01(input.predictionErrorRate ?? 0);
    const predictorBucketReliability = clamp01(1 - calibrationGap * 0.8);
    const actionCount = Math.max(input.actions.length, 1);
    const highRiskActionCount = input.actions.filter((action) => action.side_effect_level === "high").length;
    const mediumRiskActionCount = input.actions.filter((action) => action.side_effect_level === "medium").length;
    const sideEffectSeverity = clamp01((highRiskActionCount + mediumRiskActionCount * 0.5) / actionCount);
    const divergence = computeActionDivergence(input.actions);
    const retrievalCoverage =
      input.workspace.memory_digest.length > 0
        ? clamp01(Math.min(1, input.workspace.memory_digest.length / Math.max(input.ctx.profile.memory_config.retrieval_top_k ?? 5, 1)))
        : 0;
    const familiarity = clamp01(
      (
        (Array.isArray(input.ctx.runtime_state.memory_recall_proposals)
          ? input.ctx.runtime_state.memory_recall_proposals.length
          : 0) *
          0.45 +
        (Array.isArray(input.ctx.runtime_state.skill_match_proposals)
          ? input.ctx.runtime_state.skill_match_proposals.length
          : 0) *
          0.55
      ) / 5
    );
    const novelty = clamp01(
      1 -
        familiarity +
        (input.actions.filter((action) => action.action_type === "call_tool").length > 1 ? 0.15 : 0) +
        (input.goals.length > 2 ? 0.1 : 0) +
        (highRiskActionCount > 0 ? 0.1 : 0)
    );
    const epistemic = clamp01((novelty + (1 - retrievalCoverage)) / 2);
    const aleatoric = clamp01(avgPredictionUncertainty * 0.8 + (input.predictionErrorRate ?? 0) * 0.2);

    return {
      signals: {
        predicted_success_probability: avgPredictionSuccess,
        predicted_downside_severity: sideEffectSeverity,
        expected_free_energy_score: avgExpectedFreeEnergy,
        uncertainty_decomposition: {
          epistemic,
          aleatoric,
          evidence_missing: clamp01(1 - retrievalCoverage),
          model_disagreement: clamp01((divergence + predictorDisagreement) / 2),
          simulator_unreliability: avgPredictionUncertainty,
          calibration_gap: calibrationGap
        },
        simulator_confidence: clamp01(1 - avgPredictionUncertainty),
        predictor_error_rate: clamp01(input.predictionErrorRate ?? avgPredictionUncertainty),
        predictor_bucket_reliability: predictorBucketReliability,
        predictor_calibration_bucket: toCalibrationBucket(calibrationGap),
        world_model_mismatch_score: clamp01(input.predictionErrorRate ?? avgPredictionUncertainty)
      },
      provenance: [
        provenance(
          "prediction",
          "predictor_error_rate",
          this.name,
          typeof input.predictionErrorRate === "number" ? "ok" : "fallback",
          timestamp
        ),
        provenance(
          "prediction",
          "predictor_bucket_reliability",
          this.name,
          input.predictions.length > 0 ? "ok" : "fallback",
          timestamp
        )
      ]
    };
  }
}

function toCalibrationBucket(calibrationGap: number): string {
  if (calibrationGap >= 0.7) {
    return "poor";
  }
  if (calibrationGap >= 0.4) {
    return "mixed";
  }
  return "stable";
}
