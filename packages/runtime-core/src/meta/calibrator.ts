import type {
  CalibrationRecord,
  CandidateAction,
  MetaAssessment,
  Observation,
  UserInput
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";
import { InMemoryCalibrationStore } from "./in-memory-calibration-store.js";

interface RecordCalibrationInput {
  sessionId: string;
  cycleId: string;
  input: UserInput;
  action: CandidateAction;
  observation: Observation;
  metaAssessment?: MetaAssessment;
}

export class Calibrator {
  public constructor(
    private readonly store: InMemoryCalibrationStore = new InMemoryCalibrationStore()
  ) {}

  public record(input: RecordCalibrationInput): CalibrationRecord | null {
    const predictedConfidence =
      input.metaAssessment?.calibrated_confidence ??
      input.metaAssessment?.confidence.overall_confidence;

    if (predictedConfidence == null) {
      return null;
    }

    const taskBucket = buildTaskBucket(input);
    const history = this.store.listByTaskBucket(taskBucket);
    const historicalSuccessRate =
      history.length === 0
        ? predictedConfidence
        : history.filter((record) => record.observed_success).length / history.length;
    const calibratedConfidence = clamp01(predictedConfidence * 0.7 + historicalSuccessRate * 0.3);
    const record: CalibrationRecord = {
      record_id: generateId("cal"),
      task_bucket: taskBucket,
      predicted_confidence: predictedConfidence,
      calibrated_confidence: calibratedConfidence,
      observed_success: input.observation.status === "success",
      risk_level: deriveRiskLevel(input.action, input.metaAssessment),
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

function buildTaskBucket(input: RecordCalibrationInput) {
  const tool = input.action.tool_name ?? "none";
  const metaState = input.metaAssessment?.meta_state ?? "unknown";
  const intent =
    typeof input.input.metadata?.intent === "string"
      ? input.input.metadata.intent
      : "generic";
  return `${input.action.action_type}:${tool}:${metaState}:${intent}`;
}

function deriveRiskLevel(action: CandidateAction, metaAssessment?: MetaAssessment) {
  if (metaAssessment?.meta_state === "high-risk" || action.side_effect_level === "high") {
    return "high";
  }
  if (
    metaAssessment?.meta_state === "high-conflict" ||
    metaAssessment?.meta_state === "evidence-insufficient" ||
    action.side_effect_level === "medium"
  ) {
    return "medium";
  }
  return "low";
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
