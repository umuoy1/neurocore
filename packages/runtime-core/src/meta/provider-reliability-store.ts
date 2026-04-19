import type {
  MetaSignalProviderProfile,
  MetaSignalProviderReliabilityRecord
} from "@neurocore/protocol";

export function summarizeProviderReliability(
  records: MetaSignalProviderReliabilityRecord[],
  provider: string,
  family: string
): MetaSignalProviderProfile {
  const filtered = records.filter((record) => record.provider === provider && record.family === family);

  if (filtered.length === 0) {
    return {
      provider,
      family,
      sample_count: 0,
      success_rate: 0.5,
      availability_rate: 0.5,
      degraded_rate: 0,
      fallback_rate: 0,
      reliability_score: 0.5,
      confidence_score: 0.35
    };
  }

  const sampleCount = filtered.length;
  const successRate = filtered.filter((record) => record.observed_success).length / sampleCount;
  const okCount = filtered.filter((record) => record.provider_status === "ok").length;
  const degradedCount = filtered.filter((record) => record.provider_status === "degraded").length;
  const fallbackCount = filtered.filter(
    (record) => record.provider_status === "fallback" || record.provider_status === "missing"
  ).length;
  const availabilityRate = clamp01((okCount + degradedCount * 0.5) / sampleCount);
  const degradedRate = clamp01(degradedCount / sampleCount);
  const fallbackRate = clamp01(fallbackCount / sampleCount);
  const sampleWeight = Math.min(1, sampleCount / 8);
  const reliabilityScore = clamp01(
    successRate * 0.55 +
      availabilityRate * 0.3 +
      sampleWeight * 0.15 -
      degradedRate * 0.05 -
      fallbackRate * 0.1
  );
  const confidenceScore = clamp01(
    availabilityRate * 0.45 +
      (1 - fallbackRate) * 0.3 +
      sampleWeight * 0.25
  );

  return {
    provider,
    family,
    sample_count: sampleCount,
    success_rate: clamp01(successRate),
    availability_rate: availabilityRate,
    degraded_rate: degradedRate,
    fallback_rate: fallbackRate,
    reliability_score: reliabilityScore,
    confidence_score: confidenceScore,
    last_updated_at: filtered[filtered.length - 1]?.created_at
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
