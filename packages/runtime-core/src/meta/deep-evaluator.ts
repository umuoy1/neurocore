import type {
  CalibrationBucketStats,
  CandidateAction,
  CounterfactualSimulator,
  FastMetaAssessment,
  MetaAssessment,
  MetaControlAction,
  MetaSignalFrame,
  MetaState,
  MetaTriggerTag,
  ModuleContext,
  PolicyDecision,
  Prediction,
  VerificationTrace,
  Verifier,
  VerifierInput,
  VerifierResult,
  VerifierRunRecord
} from "@neurocore/protocol";
import type { Calibrator } from "./calibrator.js";
import { DefaultCounterfactualSimulator } from "./counterfactual-simulator.js";
import { runSimulatorWithGuard, runVerifierWithGuard } from "./verifier.js";
import { DefaultEvidenceVerifier } from "./verifiers/evidence-verifier.js";
import { DefaultLogicVerifier } from "./verifiers/logic-verifier.js";
import { DefaultProcessVerifier } from "./verifiers/process-verifier.js";
import { DefaultSafetyVerifier } from "./verifiers/safety-verifier.js";
import { DefaultToolVerifier } from "./verifiers/tool-verifier.js";

interface DeepEvaluationInput {
  ctx: ModuleContext;
  workspace: import("@neurocore/protocol").WorkspaceSnapshot;
  frame: MetaSignalFrame;
  fastAssessment: FastMetaAssessment;
  actions: CandidateAction[];
  predictions: Prediction[];
  policies: PolicyDecision[];
  calibrator?: Calibrator;
  calibrationQuery?: {
    descriptor: { taskBucket: string; riskLevel: string };
    stats: CalibrationBucketStats;
  };
}

export interface DeepEvaluatorOptions {
  verifiers?: Verifier[];
  simulator?: CounterfactualSimulator | null;
}

export class DeepEvaluator {
  private readonly verifiers: Verifier[];
  private readonly simulator: CounterfactualSimulator | null;

  public constructor(options: DeepEvaluatorOptions = {}) {
    this.verifiers =
      options.verifiers ??
      [
        new DefaultLogicVerifier(),
        new DefaultEvidenceVerifier(),
        new DefaultToolVerifier(),
        new DefaultSafetyVerifier(),
        new DefaultProcessVerifier()
      ];
    this.simulator = options.simulator === undefined ? new DefaultCounterfactualSimulator() : options.simulator;
  }

  public async evaluate(input: DeepEvaluationInput): Promise<MetaAssessment> {
    const triggerTags = deriveTriggerTags(input.frame, input.fastAssessment);
    const confidence = buildConfidenceVector(input.frame);
    const processReliability = clamp01(
      (input.frame.reasoning_signals.step_consistency +
        (1 - input.frame.reasoning_signals.candidate_reasoning_divergence) +
        (1 - input.frame.reasoning_signals.contradiction_score)) / 3
    );
    const evidencePenalty =
      input.frame.evidence_signals.missing_critical_evidence_flags.length > 0
        ? 0.2
        : 0;
    const evidenceSufficiency = clamp01(
      ((input.frame.evidence_signals.retrieval_coverage +
        input.frame.evidence_signals.evidence_agreement_score +
        input.frame.evidence_signals.source_reliability_prior) / 3) - evidencePenalty
    );
    const simulationReliability = clamp01(
      (input.frame.prediction_signals.predicted_success_probability +
        input.frame.prediction_signals.simulator_confidence +
        (1 - input.frame.prediction_signals.world_model_mismatch_score)) / 3
    );
    const toolReadiness = clamp01(
      (input.frame.action_signals.tool_precondition_completeness +
        input.frame.action_signals.schema_confidence +
        input.frame.action_signals.observability_after_action) / 3
    );
    const conflictIndex = clamp01(
      (input.frame.reasoning_signals.candidate_reasoning_divergence +
        input.frame.reasoning_signals.contradiction_score +
        input.frame.prediction_signals.uncertainty_decomposition.model_disagreement) / 3
    );
    const controllabilityScore = clamp01(
      (input.frame.action_signals.reversibility_score +
        input.frame.action_signals.fallback_availability +
        input.frame.governance_signals.remaining_recovery_options) / 3
    );
    const verifierInput: VerifierInput = {
      ctx: input.ctx,
      workspace: input.workspace,
      frame: input.frame,
      fastAssessment: input.fastAssessment,
      actions: input.actions,
      predictions: input.predictions,
      policies: input.policies,
      triggerTags
    };

    const selectedVerifiers = selectVerifiers(this.verifiers, verifierInput);
    const verifierRuns = await Promise.all(
      selectedVerifiers.map((verifier) => runVerifierWithGuard(verifier, verifierInput))
    );
    const simulatorRun =
      this.simulator && shouldRunSimulator(this.simulator, verifierInput)
        ? await runSimulatorWithGuard(this.simulator, verifierInput)
        : null;
    const verificationTrace = buildVerificationTrace(verifierRuns, simulatorRun);
    const rawDeepConfidence = deriveRawDeepConfidence({
      base: confidence.overall_confidence,
      evidenceSufficiency,
      processReliability,
      simulationReliability,
      toolReadiness,
      conflictIndex,
      controllabilityScore,
      trace: verificationTrace
    });
    const calibratedConfidence =
      input.calibrator && input.calibrationQuery
        ? input.calibrator.calibrate({
            rawConfidence: rawDeepConfidence,
            bucketStats: input.calibrationQuery.stats,
            riskLevel: input.calibrationQuery.descriptor.riskLevel,
            strictness:
              input.calibrationQuery.descriptor.riskLevel === "high"
                ? 1
                : input.calibrationQuery.descriptor.riskLevel === "medium"
                  ? 0.75
                  : 0.5
          })
        : rawDeepConfidence;
    const metaState = deriveDeepMetaState(
      input.frame,
      input.fastAssessment.meta_state,
      calibratedConfidence,
      verificationTrace.final_verdict
    );
    const failureModes = deriveFailureModes(
      input.frame,
      verificationTrace.final_verdict,
      metaState,
      input.policies
    );
    const recommendedControlAction = recommendControlAction({
      frame: input.frame,
      triggerTags,
      metaState,
      verdict: verificationTrace.final_verdict,
      evidenceSufficiency,
      conflictIndex,
      toolReadiness,
      controllabilityScore
    });
    const recommendedCandidateActionId = recommendCandidateActionId(
      input.actions,
      input.predictions,
      recommendedControlAction
    );

    return {
      assessment_id: `${input.frame.frame_id}_meta`,
      session_id: input.frame.session_id,
      cycle_id: input.frame.cycle_id,
      meta_state: metaState,
      confidence,
      calibrated_confidence: calibratedConfidence,
      task_bucket: input.calibrationQuery?.descriptor.taskBucket,
      bucket_reliability: input.calibrationQuery?.stats.bucket_reliability,
      process_reliability: processReliability,
      evidence_sufficiency: evidenceSufficiency,
      simulation_reliability: simulationReliability,
      tool_readiness: toolReadiness,
      conflict_index: conflictIndex,
      controllability_score: controllabilityScore,
      uncertainty_decomposition: input.frame.prediction_signals.uncertainty_decomposition,
      failure_modes: failureModes,
      recommended_control_action: recommendedControlAction,
      recommended_candidate_action_id: recommendedCandidateActionId,
      verification_trace: verificationTrace,
      deep_evaluation_used: true,
      rationale: buildRationale({
        metaState,
        triggerTags,
        calibratedConfidence,
        evidenceSufficiency,
        processReliability,
        simulationReliability,
        toolReadiness,
        conflictIndex,
        verdict: verificationTrace.final_verdict
      }),
      created_at: input.frame.created_at
    };
  }
}

function buildConfidenceVector(frame: MetaSignalFrame) {
  const evidenceConfidence =
    (frame.evidence_signals.retrieval_coverage +
      frame.evidence_signals.evidence_agreement_score +
      frame.evidence_signals.source_reliability_prior) / 3;
  const processConfidence =
    (frame.reasoning_signals.step_consistency +
      (1 - frame.reasoning_signals.candidate_reasoning_divergence) +
      (1 - frame.reasoning_signals.contradiction_score)) / 3;
  const simulationConfidence =
    (frame.prediction_signals.predicted_success_probability +
      frame.prediction_signals.simulator_confidence +
      (1 - frame.prediction_signals.world_model_mismatch_score)) / 3;
  const actionSafetyConfidence =
    (1 - frame.action_signals.side_effect_severity + frame.action_signals.reversibility_score) / 2;
  const toolReadinessConfidence =
    (frame.action_signals.tool_precondition_completeness + frame.action_signals.schema_confidence) / 2;
  const calibrationConfidence = 1 - frame.prediction_signals.uncertainty_decomposition.calibration_gap;
  const answerConfidence = (processConfidence + evidenceConfidence + simulationConfidence) / 3;
  const overallConfidence =
    (answerConfidence +
      processConfidence +
      evidenceConfidence +
      simulationConfidence +
      actionSafetyConfidence +
      toolReadinessConfidence +
      calibrationConfidence) / 7;

  return {
    answer_confidence: clamp01(answerConfidence),
    process_confidence: clamp01(processConfidence),
    evidence_confidence: clamp01(evidenceConfidence),
    simulation_confidence: clamp01(simulationConfidence),
    action_safety_confidence: clamp01(actionSafetyConfidence),
    tool_readiness_confidence: clamp01(toolReadinessConfidence),
    calibration_confidence: clamp01(calibrationConfidence),
    overall_confidence: clamp01(overallConfidence)
  };
}

function selectVerifiers(verifiers: Verifier[], input: VerifierInput) {
  const budgetPressure = input.frame.governance_signals.budget_pressure;
  const highRisk =
    input.triggerTags.includes("risk_high") ||
    input.frame.governance_signals.need_for_human_accountability >= 0.7;
  const mustModes = new Set<string>();

  if (input.triggerTags.includes("evidence_gap")) {
    mustModes.add("evidence");
  }
  if (input.triggerTags.includes("tool_not_ready")) {
    mustModes.add("tool");
  }
  if (input.triggerTags.includes("risk_high")) {
    mustModes.add("safety");
  }
  if (input.triggerTags.includes("reasoning_conflict")) {
    mustModes.add("logic");
  }

  return verifiers.filter((verifier) => {
    const wantsRun = verifier.shouldRun?.(input) ?? true;
    if (!wantsRun) {
      return false;
    }
    if (highRisk) {
      return true;
    }
    if (budgetPressure >= 0.75) {
      return mustModes.has(verifier.mode);
    }
    return true;
  });
}

function shouldRunSimulator(simulator: CounterfactualSimulator, input: VerifierInput) {
  if (input.frame.governance_signals.budget_pressure >= 0.8 && !input.triggerTags.includes("risk_high")) {
    return false;
  }
  return simulator.shouldRun?.(input) ?? true;
}

function buildVerificationTrace(
  verifierRuns: Array<{ result?: VerifierResult; run: VerifierRunRecord }>,
  simulatorRun: { result?: VerifierResult; run: VerifierRunRecord } | null
): VerificationTrace {
  const allRuns = simulatorRun ? [...verifierRuns, simulatorRun] : verifierRuns;
  const results = allRuns.flatMap((entry) => (entry.result ? [entry.result] : []));
  const contestedSteps = results.flatMap((result) => result.contested_steps ?? []);
  const evidenceGaps = results.flatMap((result) => result.evidence_gaps ?? []);
  const counterfactualChecks = results.flatMap((result) => result.counterfactual_checks ?? []);
  const finalVerdict = aggregateVerdict(results);

  return {
    verifier_runs: allRuns.map((entry) => entry.run),
    contested_steps: contestedSteps,
    evidence_gaps: evidenceGaps,
    counterfactual_checks: counterfactualChecks,
    final_verdict: finalVerdict
  };
}

function aggregateVerdict(results: VerifierResult[]): VerificationTrace["final_verdict"] {
  if (results.some((result) => result.verdict === "fail")) {
    return "fail";
  }
  if (results.some((result) => result.verdict === "inconclusive")) {
    return "inconclusive";
  }
  if (results.some((result) => result.verdict === "weak-pass")) {
    return "weak-pass";
  }
  return "pass";
}

function deriveRawDeepConfidence(input: {
  base: number;
  evidenceSufficiency: number;
  processReliability: number;
  simulationReliability: number;
  toolReadiness: number;
  conflictIndex: number;
  controllabilityScore: number;
  trace: VerificationTrace;
}) {
  let value =
    input.base * 0.45 +
    input.evidenceSufficiency * 0.15 +
    input.processReliability * 0.15 +
    input.simulationReliability * 0.1 +
    input.toolReadiness * 0.1 +
    input.controllabilityScore * 0.05;

  value -= input.conflictIndex * 0.25;

  if (input.trace.final_verdict === "fail") {
    value -= 0.25;
  } else if (input.trace.final_verdict === "inconclusive") {
    value -= 0.15;
  } else if (input.trace.final_verdict === "weak-pass") {
    value -= 0.05;
  }

  return clamp01(value);
}

function deriveDeepMetaState(
  frame: MetaSignalFrame,
  fastMetaState: MetaState,
  calibratedConfidence: number,
  verdict: VerificationTrace["final_verdict"]
): MetaState {
  if (
    verdict === "fail" ||
    frame.action_signals.side_effect_severity >= 0.75 ||
    frame.governance_signals.need_for_human_accountability >= 0.75
  ) {
    return "high-risk";
  }

  if (
    verdict === "inconclusive" &&
    (frame.evidence_signals.retrieval_coverage < 0.45 ||
      frame.evidence_signals.missing_critical_evidence_flags.length > 0)
  ) {
    return "evidence-insufficient";
  }

  if (
    verdict === "inconclusive" &&
    (frame.reasoning_signals.contradiction_score >= 0.45 ||
      frame.reasoning_signals.candidate_reasoning_divergence >= 0.55)
  ) {
    return "high-conflict";
  }

  if (calibratedConfidence < 0.45) {
    return "needs-deep-eval";
  }

  if (fastMetaState === "needs-deep-eval" && calibratedConfidence >= 0.6) {
    return "novel-but-manageable";
  }

  return fastMetaState;
}

function deriveFailureModes(
  frame: MetaSignalFrame,
  verdict: VerificationTrace["final_verdict"],
  metaState: MetaState,
  policies: PolicyDecision[]
) {
  const modes = new Set<import("@neurocore/protocol").FailureMode>();

  if (frame.evidence_signals.retrieval_coverage < 0.4) {
    modes.add("insufficient_evidence");
  }
  if (frame.evidence_signals.missing_critical_evidence_flags.length > 0) {
    modes.add("retrieval_miss");
  }
  if (frame.reasoning_signals.contradiction_score >= 0.45) {
    modes.add("wrong_assumption");
  }
  if (frame.reasoning_signals.candidate_reasoning_divergence >= 0.55) {
    modes.add("bad_plan");
  }
  if (frame.prediction_signals.world_model_mismatch_score >= 0.5) {
    modes.add("prediction_drift");
  }
  if (frame.action_signals.tool_precondition_completeness < 0.5) {
    modes.add("tool_failure");
  }
  if (policies.some((policy) => policy.level === "block" || policy.level === "warn")) {
    modes.add("policy_block");
  }
  if (
    verdict !== "pass" &&
    frame.prediction_signals.uncertainty_decomposition.calibration_gap >= 0.45
  ) {
    modes.add("overconfidence");
  }
  if (metaState === "routine-uncertain" && modes.size === 0) {
    modes.add("underconfidence");
  }

  return Array.from(modes);
}

function recommendControlAction(input: {
  frame: MetaSignalFrame;
  triggerTags: MetaTriggerTag[];
  metaState: MetaState;
  verdict: VerificationTrace["final_verdict"];
  evidenceSufficiency: number;
  conflictIndex: number;
  toolReadiness: number;
  controllabilityScore: number;
}): MetaControlAction {
  if (
    input.verdict === "fail" &&
    input.frame.action_signals.side_effect_severity >= 0.8 &&
    input.frame.action_signals.reversibility_score <= 0.35
  ) {
    return "abort";
  }

  if (input.verdict === "fail") {
    return "switch-to-safe-response";
  }

  if (
    input.evidenceSufficiency < 0.45 ||
    input.metaState === "evidence-insufficient"
  ) {
    return "request-more-evidence";
  }

  if (
    input.triggerTags.includes("tool_not_ready") &&
    input.toolReadiness < 0.6
  ) {
    return "replan";
  }

  if (
    input.triggerTags.includes("reasoning_conflict") &&
    input.conflictIndex >= 0.55
  ) {
    return "decompose-goal";
  }

  if (
    input.metaState === "high-risk" ||
    input.frame.governance_signals.need_for_human_accountability >= 0.7
  ) {
    if (input.verdict === "inconclusive") {
      return "ask-human";
    }
    return "execute-with-approval";
  }

  if (input.verdict === "inconclusive" && input.conflictIndex >= 0.5) {
    return "switch-to-safe-response";
  }

  if (input.toolReadiness < 0.5 || input.controllabilityScore < 0.45) {
    return "switch-to-safe-response";
  }

  return "execute-now";
}

function recommendCandidateActionId(
  actions: CandidateAction[],
  predictions: Prediction[],
  recommendedAction: MetaControlAction
) {
  if (actions.length === 0) {
    return undefined;
  }

  if (recommendedAction === "request-more-evidence" || recommendedAction === "ask-human") {
    return actions.find((action) => action.action_type === "ask_user")?.action_id;
  }

  if (recommendedAction === "switch-to-safe-response") {
    return safestAction(actions)?.action_id;
  }

  return topPredictedAction(actions, predictions)?.action_id ?? safestAction(actions)?.action_id;
}

function safestAction(actions: CandidateAction[]) {
  return [...actions].sort((left, right) => compareSafety(left, right))[0];
}

function compareSafety(left: CandidateAction, right: CandidateAction) {
  return safetyRank(left) - safetyRank(right);
}

function safetyRank(action: CandidateAction) {
  const typeRank =
    action.action_type === "respond"
      ? 0
      : action.action_type === "ask_user"
        ? 1
        : action.action_type === "call_tool"
          ? 2
          : 3;
  const sideEffectRank =
    action.side_effect_level === "high"
      ? 3
      : action.side_effect_level === "medium"
        ? 2
        : action.side_effect_level === "low"
          ? 1
          : 0;
  return typeRank * 10 + sideEffectRank;
}

function topPredictedAction(actions: CandidateAction[], predictions: Prediction[]) {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.action_id, prediction]));
  return [...actions].sort((left, right) => {
    const leftPrediction = predictionMap.get(left.action_id);
    const rightPrediction = predictionMap.get(right.action_id);
    return (rightPrediction?.success_probability ?? 0) - (leftPrediction?.success_probability ?? 0);
  })[0];
}

function buildRationale(input: {
  metaState: MetaState;
  triggerTags: MetaTriggerTag[];
  calibratedConfidence: number;
  evidenceSufficiency: number;
  processReliability: number;
  simulationReliability: number;
  toolReadiness: number;
  conflictIndex: number;
  verdict: VerificationTrace["final_verdict"];
}) {
  return [
    `meta_state=${input.metaState}`,
    `verdict=${input.verdict}`,
    `calibrated_confidence=${input.calibratedConfidence.toFixed(2)}`,
    `evidence=${input.evidenceSufficiency.toFixed(2)}`,
    `process=${input.processReliability.toFixed(2)}`,
    `simulation=${input.simulationReliability.toFixed(2)}`,
    `tool=${input.toolReadiness.toFixed(2)}`,
    `conflict=${input.conflictIndex.toFixed(2)}`,
    `tags=${input.triggerTags.join(",") || "none"}`
  ].join("; ");
}

function deriveTriggerTags(frame: MetaSignalFrame, fastAssessment: FastMetaAssessment) {
  return fastAssessment.trigger_tags ?? [];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
