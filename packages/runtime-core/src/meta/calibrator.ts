import type {
  AgentProfile,
  CalibrationBucketStats,
  CalibrationRecord,
  CalibrationStore,
  CandidateAction,
  MetaAssessment,
  MetaSignalFrame,
  Prediction,
  UserInput
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";
import { InMemoryCalibrationStore } from "./in-memory-calibration-store.js";
import {
  buildCalibrationTaskBucket,
  type CalibrationTaskBucketDescriptor
} from "./task-bucket.js";

interface QueryCalibrationInput {
  profile?: AgentProfile;
  frame?: MetaSignalFrame;
  input?: UserInput;
  action?: CandidateAction;
  actions?: CandidateAction[];
  predictions?: Prediction[];
  metaState?: MetaAssessment["meta_state"];
  predictorId?: string;
}

interface CalibrateConfidenceInput {
  rawConfidence: number;
  bucketStats: CalibrationBucketStats;
  riskLevel?: string;
  strictness?: number;
}

interface RecordCalibrationInput {
  sessionId: string;
  cycleId: string;
  profile?: AgentProfile;
  input: UserInput;
  action: CandidateAction;
  observation: { status: string };
  predictions?: Prediction[];
  metaAssessment?: MetaAssessment;
}

export interface CalibrationQueryResult {
  descriptor: CalibrationTaskBucketDescriptor;
  stats: CalibrationBucketStats;
}

export class Calibrator {
  public constructor(
    private readonly store: CalibrationStore = new InMemoryCalibrationStore()
  ) {}

  public query(input: QueryCalibrationInput): CalibrationQueryResult {
    const descriptor = buildCalibrationTaskBucket({
      profile: input.profile,
      frame: input.frame,
      input: input.input,
      action: input.action,
      actions: input.actions,
      predictions: input.predictions,
      metaState: input.metaState,
      predictorId: input.predictorId
    });
    const stats = this.store.getBucketStats({
      taskBucket: descriptor.taskBucket,
      riskLevel: descriptor.riskLevel,
      predictorId: descriptor.predictorId
    });

    return {
      descriptor,
      stats
    };
  }

  public calibrate(input: CalibrateConfidenceInput) {
    const sampleWeight = Math.min(0.65, input.bucketStats.sample_count / (input.bucketStats.sample_count + 5));
    const historicalTarget =
      input.bucketStats.success_rate * 0.55 +
      input.bucketStats.average_calibrated_confidence * 0.3 +
      (1 - input.bucketStats.average_confidence_gap) * 0.15;
    let value =
      input.rawConfidence * (1 - sampleWeight) +
      historicalTarget * sampleWeight;

    const strictness = clamp01(input.strictness ?? 0.5);
    const reliabilityPenalty =
      (1 - input.bucketStats.bucket_reliability) * (0.15 + strictness * 0.15);
    const gapPenalty =
      input.bucketStats.average_confidence_gap * (0.1 + strictness * 0.1);

    value -= reliabilityPenalty + gapPenalty;

    if (input.riskLevel === "high") {
      value = Math.min(value, input.rawConfidence - Math.max(0.03, gapPenalty));
    } else if (input.riskLevel === "medium") {
      value = Math.min(value, input.rawConfidence - gapPenalty * 0.4);
    }

    return clamp01(value);
  }

  public record(input: RecordCalibrationInput): CalibrationRecord | null {
    const predictedConfidence =
      input.metaAssessment?.calibrated_confidence ??
      input.metaAssessment?.confidence.overall_confidence;

    if (predictedConfidence == null) {
      return null;
    }

    const query = this.query({
      profile: input.profile,
      input: input.input,
      action: input.action,
      predictions: input.predictions,
      metaState: input.metaAssessment?.meta_state
    });
    const calibratedConfidence = this.calibrate({
      rawConfidence: predictedConfidence,
      bucketStats: query.stats,
      riskLevel: query.descriptor.riskLevel,
      strictness: query.descriptor.riskLevel === "high" ? 1 : query.descriptor.riskLevel === "medium" ? 0.7 : 0.4
    });
    const record: CalibrationRecord = {
      record_id: generateId("cal"),
      task_bucket: query.descriptor.taskBucket,
      predicted_confidence: predictedConfidence,
      calibrated_confidence: calibratedConfidence,
      observed_success: input.observation.status === "success",
      risk_level: query.descriptor.riskLevel,
      predictor_id: query.descriptor.predictorId,
      deep_eval_used: input.metaAssessment?.deep_evaluation_used ?? false,
      session_id: input.sessionId,
      cycle_id: input.cycleId,
      action_id: input.action.action_id,
      meta_state: input.metaAssessment?.meta_state,
      created_at: nowIso()
    };

    this.store.append(record);
    return record;
  }

  public list(sessionId?: string) {
    return this.store.list(sessionId);
  }

  public deleteSession(sessionId: string) {
    this.store.deleteSession(sessionId);
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
