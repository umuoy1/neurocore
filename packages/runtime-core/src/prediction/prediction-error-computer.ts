import type { ActionExecution, Observation, Prediction, PredictionError } from "@neurocore/protocol";

export interface ComputePredictionErrorsInput {
  predictions: Prediction[];
  observation: Observation;
  execution?: ActionExecution;
  generateId: (prefix: string) => string;
  now: () => string;
}

export function computePredictionErrors(input: ComputePredictionErrorsInput): PredictionError[] {
  const { predictions, observation, execution, generateId, now } = input;
  const errors: PredictionError[] = [];
  const timestamp = now();

  for (const prediction of predictions) {
    if (prediction.action_id !== observation.source_action_id) continue;

    if (prediction.success_probability != null) {
      const succeeded = observation.status === "success";
      const failed = observation.status === "failure";

      if (prediction.success_probability >= 0.7 && failed) {
        errors.push({
          prediction_error_id: generateId("pe"),
          prediction_id: prediction.prediction_id,
          action_id: prediction.action_id,
          session_id: prediction.session_id,
          cycle_id: prediction.cycle_id,
          error_type: "outcome_mismatch",
          severity: prediction.success_probability >= 0.9 ? "high" : "medium",
          expected: { success_probability: prediction.success_probability, expected_status: "success" },
          actual: { status: observation.status },
          impact_summary: `Predicted success (p=${prediction.success_probability}) but action failed.`,
          created_at: timestamp
        });
      } else if (prediction.success_probability <= 0.3 && succeeded) {
        errors.push({
          prediction_error_id: generateId("pe"),
          prediction_id: prediction.prediction_id,
          action_id: prediction.action_id,
          session_id: prediction.session_id,
          cycle_id: prediction.cycle_id,
          error_type: "outcome_mismatch",
          severity: "medium",
          expected: { success_probability: prediction.success_probability, expected_status: "failure" },
          actual: { status: observation.status },
          impact_summary: `Predicted failure (p=${prediction.success_probability}) but action succeeded.`,
          created_at: timestamp
        });
      }
    }

    if (prediction.estimated_duration_ms != null && execution?.metrics?.latency_ms != null) {
      const ratio = execution.metrics.latency_ms / prediction.estimated_duration_ms;
      if (ratio > 2 || ratio < 0.5) {
        errors.push({
          prediction_error_id: generateId("pe"),
          prediction_id: prediction.prediction_id,
          action_id: prediction.action_id,
          session_id: prediction.session_id,
          cycle_id: prediction.cycle_id,
          error_type: "duration_mismatch",
          severity: ratio > 5 ? "high" : "medium",
          expected: { estimated_duration_ms: prediction.estimated_duration_ms },
          actual: { latency_ms: execution.metrics.latency_ms, ratio },
          impact_summary: `Duration ratio ${ratio.toFixed(1)}x (expected ${prediction.estimated_duration_ms}ms, actual ${execution.metrics.latency_ms}ms).`,
          created_at: timestamp
        });
      }
    }

    if (prediction.side_effects && prediction.side_effects.length > 0) {
      const observedSideEffects = observation.side_effects ?? [];
      const predictedSet = new Set(prediction.side_effects);
      const observedSet = new Set(observedSideEffects);
      const unexpected = observedSideEffects.filter((se) => !predictedSet.has(se));
      const missing = prediction.side_effects.filter((se) => !observedSet.has(se));

      if (unexpected.length > 0 || missing.length > 0) {
        errors.push({
          prediction_error_id: generateId("pe"),
          prediction_id: prediction.prediction_id,
          action_id: prediction.action_id,
          session_id: prediction.session_id,
          cycle_id: prediction.cycle_id,
          error_type: "side_effect_mismatch",
          severity: unexpected.length > 0 ? "high" : "low",
          expected: { side_effects: prediction.side_effects },
          actual: { side_effects: observedSideEffects, unexpected, missing },
          impact_summary: `Side effect mismatch: ${unexpected.length} unexpected, ${missing.length} missing.`,
          created_at: timestamp
        });
      }
    }
  }

  return errors;
}
