export interface MemoryCausalRegressionCase {
  case_id: string;
  intervention: "remove_episode" | "tombstone_episode" | "inject_suspect" | "promote_skill";
  baseline_score: number;
  perturbed_score: number;
  expected_direction: "degrade" | "stable" | "improve";
}

export interface MemoryCausalRegressionReport {
  case_count: number;
  direction_accuracy: number;
  average_effect_size: number;
  signed_effect_mean: number;
  causal_score: number;
}

export function evaluateMemoryCausalRegression(
  cases: MemoryCausalRegressionCase[]
): MemoryCausalRegressionReport {
  if (cases.length === 0) {
    return {
      case_count: 0,
      direction_accuracy: 0,
      average_effect_size: 0,
      signed_effect_mean: 0,
      causal_score: 0
    };
  }

  const signedEffects = cases.map((item) => item.perturbed_score - item.baseline_score);
  const directionAccuracy = average(
    cases.map((item, index) => matchesDirection(signedEffects[index], item.expected_direction) ? 1 : 0)
  );
  const averageEffectSize = average(signedEffects.map((value) => Math.abs(value)));
  const signedEffectMean = average(signedEffects);

  return {
    case_count: cases.length,
    direction_accuracy: directionAccuracy,
    average_effect_size: averageEffectSize,
    signed_effect_mean: signedEffectMean,
    causal_score: clamp01(directionAccuracy * 0.7 + (1 - Math.min(1, averageEffectSize)) * 0.3)
  };
}

function matchesDirection(effect: number, expected: MemoryCausalRegressionCase["expected_direction"]): boolean {
  if (expected === "stable") {
    return Math.abs(effect) <= 0.05;
  }
  if (expected === "degrade") {
    return effect < -0.05;
  }
  return effect > 0.05;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
