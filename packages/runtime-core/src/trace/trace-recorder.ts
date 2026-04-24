import type {
  ActionExecution,
  AutonomyDecision,
  AutonomyState,
  CalibrationRecord,
  CandidateAction,
  CycleTrace,
  CycleTraceRecord,
  FastMetaAssessment,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MetaAssessment,
  MetaDecisionV2,
  MetaSignalFrame,
  Observation,
  PolicyDecision,
  Prediction,
  PredictionError,
  Proposal,
  ReflectionRule,
  SelfEvaluationReport,
  TraceStore,
  UserInput,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";
import { InMemoryTraceStore } from "./in-memory-trace-store.js";

export interface RecordTraceInput {
  sessionId: string;
  cycleId: string;
  input: UserInput;
  proposals: Proposal[];
  memoryRetrievalPlan?: MemoryRetrievalPlan;
  memoryRecallBundle?: MemoryRecallBundle;
  candidateActions: CandidateAction[];
  predictions: Prediction[];
  policyDecisions: PolicyDecision[];
  predictionErrors?: PredictionError[];
  selectedAction?: CandidateAction;
  selectedActionId?: string;
  actionExecution?: ActionExecution;
  observation?: Observation;
  workspace?: WorkspaceSnapshot;
  metaSignalFrame?: MetaSignalFrame;
  fastMetaAssessment?: FastMetaAssessment;
  metaAssessment?: MetaAssessment;
  metaDecisionV2?: MetaDecisionV2;
  selfEvaluationReport?: SelfEvaluationReport;
  calibrationRecord?: CalibrationRecord;
  appliedReflectionRule?: ReflectionRule;
  createdReflectionRule?: ReflectionRule;
  autonomyState?: AutonomyState;
  autonomyDecision?: AutonomyDecision;
  startedAt: string;
  endedAt?: string;
}

export class TraceRecorder {
  public constructor(
    private readonly traceStore: TraceStore = new InMemoryTraceStore()
  ) {}

  public record(input: RecordTraceInput): CycleTrace {
    const endedAt = input.endedAt ?? nowIso();
    const predictionErrors = input.predictionErrors ?? [];
    const trace: CycleTrace = {
      trace_id: generateId("trc"),
      session_id: input.sessionId,
      cycle_id: input.cycleId,
      started_at: input.startedAt,
      ended_at: endedAt,
      input_refs: [input.input.input_id],
      proposal_refs: input.proposals.map((proposal) => proposal.proposal_id),
      prediction_refs: input.predictions.map((prediction) => prediction.prediction_id),
      policy_decision_refs: input.policyDecisions.map((decision) => decision.decision_id),
      prediction_error_refs: predictionErrors.map((e) => e.prediction_error_id),
      selected_action_ref: input.selectedAction?.action_id ?? input.selectedActionId,
      observation_refs: input.observation ? [input.observation.observation_id] : [],
      metrics: {
        total_latency_ms: computeLatencyMs(input.startedAt, endedAt)
      }
    };

    const record: CycleTraceRecord = {
      trace,
      inputs: [input.input],
      proposals: input.proposals,
      memory_retrieval_plan: input.memoryRetrievalPlan,
      memory_recall_bundle: input.memoryRecallBundle,
      candidate_actions: input.candidateActions,
      predictions: input.predictions,
      policy_decisions: input.policyDecisions,
      prediction_errors: predictionErrors,
      selected_action: input.selectedAction,
      action_execution: input.actionExecution,
      observation: input.observation,
      workspace: input.workspace,
      meta_signal_frame: input.metaSignalFrame,
      fast_meta_assessment: input.fastMetaAssessment,
      meta_assessment: input.metaAssessment,
      meta_decision_v2: input.metaDecisionV2,
      self_evaluation_report: input.selfEvaluationReport,
      calibration_record: input.calibrationRecord,
      applied_reflection_rule: input.appliedReflectionRule,
      created_reflection_rule: input.createdReflectionRule,
      autonomy_state: input.autonomyState,
      autonomy_decision: input.autonomyDecision
    };

    this.traceStore.append(record);

    debugLog("trace", "Recorded cycle trace", {
      sessionId: input.sessionId,
      cycleId: input.cycleId,
      traceId: trace.trace_id,
      proposalCount: trace.proposal_refs.length,
      predictionCount: trace.prediction_refs.length,
      observationCount: trace.observation_refs.length
    });

    return trace;
  }

  public list(sessionId: string): CycleTrace[] {
    return this.traceStore.listTraces(sessionId);
  }

  public listRecords(sessionId: string): CycleTraceRecord[] {
    return this.traceStore.list(sessionId);
  }

  public getStore(): TraceStore {
    return this.traceStore;
  }
}

function computeLatencyMs(startedAt: string, endedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return undefined;
  }
  return Math.max(0, end - start);
}
