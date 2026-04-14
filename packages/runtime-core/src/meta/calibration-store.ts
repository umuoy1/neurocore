import type { CalibrationBucketStats, CalibrationRecord } from "@neurocore/protocol";

export function summarizeCalibrationBucket(
  records: CalibrationRecord[],
  taskBucket: string,
  riskLevel?: string,
  predictorId?: string
): CalibrationBucketStats {
  const filtered = records.filter((record) => {
    if (record.task_bucket !== taskBucket) {
      return false;
    }
    if (riskLevel && record.risk_level !== riskLevel) {
      return false;
    }
    if (predictorId && record.predictor_id !== predictorId) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return {
      task_bucket: taskBucket,
      sample_count: 0,
      success_rate: 0.5,
      average_predicted_confidence: 0.5,
      average_calibrated_confidence: 0.5,
      average_confidence_gap: 0,
      bucket_reliability: 0.5,
      risk_level: riskLevel,
      predictor_id: predictorId
    };
  }

  const sampleCount = filtered.length;
  const successRate =
    filtered.filter((record) => record.observed_success).length / sampleCount;
  const averagePredictedConfidence =
    filtered.reduce((sum, record) => sum + record.predicted_confidence, 0) / sampleCount;
  const averageCalibratedConfidence =
    filtered.reduce((sum, record) => sum + record.calibrated_confidence, 0) / sampleCount;
  const averageConfidenceGap =
    filtered.reduce(
      (sum, record) => sum + Math.max(0, record.predicted_confidence - record.calibrated_confidence),
      0
    ) / sampleCount;
  const sampleWeight = Math.min(1, sampleCount / 8);
  const bucketReliability = clamp01(
    successRate * 0.6 +
      (1 - averageConfidenceGap) * 0.25 +
      sampleWeight * 0.15
  );

  return {
    task_bucket: taskBucket,
    sample_count: sampleCount,
    success_rate: clamp01(successRate),
    average_predicted_confidence: clamp01(averagePredictedConfidence),
    average_calibrated_confidence: clamp01(averageCalibratedConfidence),
    average_confidence_gap: clamp01(averageConfidenceGap),
    bucket_reliability: clamp01(bucketReliability),
    risk_level: riskLevel ?? filtered[filtered.length - 1]?.risk_level,
    predictor_id: predictorId ?? filtered[filtered.length - 1]?.predictor_id,
    last_updated_at: filtered[filtered.length - 1]?.created_at
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
