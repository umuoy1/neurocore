import type {
  CandidateAction,
  FastMetaAssessment,
  MetaAssessment,
  MetaControlAction,
  MetaSignalFrame,
  MetaState,
  MetaTriggerTag,
  PolicyDecision,
  Prediction,
  VerificationTrace
} from "@neurocore/protocol";

interface DeepEvaluationInput {
  frame: MetaSignalFrame;
  fastAssessment: FastMetaAssessment;
  actions: CandidateAction[];
  predictions: Prediction[];
  policies: PolicyDecision[];
}

export class DeepEvaluator {
  public evaluate(input: DeepEvaluationInput): MetaAssessment {
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
    const verificationTrace = buildVerificationTrace(
      input.frame,
      input.actions,
      input.predictions,
      input.policies,
      triggerTags
    );
    const calibratedConfidence = calibrateConfidence({
      base: confidence.overall_confidence,
      evidenceSufficiency,
      processReliability,
      simulationReliability,
      toolReadiness,
      conflictIndex,
      controllabilityScore,
      trace: verificationTrace
    });
    const metaState = deriveDeepMetaState(input.frame, input.fastAssessment.meta_state, calibratedConfidence, verificationTrace.final_verdict);
    const failureModes = deriveFailureModes(input.frame, verificationTrace.final_verdict, metaState, input.policies);
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
      confidence: {
        ...confidence,
        overall_confidence: calibratedConfidence
      },
      calibrated_confidence: calibratedConfidence,
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
  const answerConfidence =
    (processConfidence + evidenceConfidence + simulationConfidence) / 3;
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

function buildVerificationTrace(
  frame: MetaSignalFrame,
  actions: CandidateAction[],
  predictions: Prediction[],
  policies: PolicyDecision[],
  triggerTags: MetaTriggerTag[]
): VerificationTrace {
  const verifierRuns: Array<Record<string, unknown>> = [];
  const addRun = (verifier: string, payload: Record<string, unknown>) => {
    verifierRuns.push({
      verifier,
      ...payload
    });
  };

  if (triggerTags.includes("reasoning_conflict") || triggerTags.includes("task_novel") || triggerTags.includes("ood_detected")) {
    addRun("multi-sample-deliberation", {
      candidate_count: actions.length,
      contradiction_score: frame.reasoning_signals.contradiction_score
    });
  }
  if (triggerTags.includes("reasoning_conflict") || triggerTags.includes("calibration_weak")) {
    addRun("logic-verifier", {
      contradiction_score: frame.reasoning_signals.contradiction_score,
      unsupported_leap_count: frame.reasoning_signals.unsupported_leap_count
    });
  }
  if (triggerTags.includes("evidence_gap") || triggerTags.includes("policy_warned")) {
    addRun("evidence-verifier", {
      retrieval_coverage: frame.evidence_signals.retrieval_coverage,
      missing_count: frame.evidence_signals.missing_critical_evidence_flags.length
    });
  }
  if (triggerTags.includes("tool_not_ready") || triggerTags.includes("risk_high")) {
    addRun("tool-verifier", {
      tool_precondition_completeness: frame.action_signals.tool_precondition_completeness,
      schema_confidence: frame.action_signals.schema_confidence,
      fallback_availability: frame.action_signals.fallback_availability
    });
  }
  if (triggerTags.includes("risk_high") || triggerTags.includes("policy_warned")) {
    addRun("safety-verifier", {
      side_effect_severity: frame.action_signals.side_effect_severity,
      reversibility_score: frame.action_signals.reversibility_score,
      accountability: frame.governance_signals.need_for_human_accountability
    });
  }
  if (triggerTags.includes("simulation_unreliable") || triggerTags.includes("risk_high")) {
    addRun("counterfactual-simulator", {
      simulator_confidence: frame.prediction_signals.simulator_confidence,
      world_model_mismatch_score: frame.prediction_signals.world_model_mismatch_score,
      predictor_count: new Set(predictions.map((prediction) => prediction.predictor_name)).size
    });
  }
  if (verifierRuns.length === 0) {
    addRun("deep-evaluator", {
      candidate_count: actions.length,
      predictor_count: new Set(predictions.map((prediction) => prediction.predictor_name)).size
    });
  }

  const contestedSteps = actions
    .filter((action) =>
      frame.reasoning_signals.contradiction_score >= 0.45 ||
      frame.reasoning_signals.candidate_reasoning_divergence >= 0.55 ||
      action.side_effect_level === "high"
    )
    .map((action) => ({
      action_id: action.action_id,
      action_type: action.action_type,
      label:
        action.side_effect_level === "high"
          ? "dangerous"
          : frame.reasoning_signals.contradiction_score >= 0.45
            ? "contradictory"
            : "unsupported",
      summary: action.title
    }));

  const evidenceGaps = frame.evidence_signals.missing_critical_evidence_flags.map((flag) => ({
    key: flag,
    severity: flag.includes("low") ? "medium" : "high"
  }));

  const counterfactualChecks =
    frame.action_signals.side_effect_severity >= 0.55 || frame.action_signals.reversibility_score <= 0.45
      ? [
          {
            check: "safe-alternative-available",
            result:
              actions.some((action) => action.action_type === "respond" || action.action_type === "ask_user")
                ? "yes"
                : "no"
          }
        ]
      : [];

  const warnCount = policies.filter((policy) => policy.level === "warn").length;
  const finalVerdict = deriveFinalVerdict(frame, contestedSteps.length, evidenceGaps.length, warnCount, triggerTags);

  return {
    verifier_runs: verifierRuns,
    contested_steps: contestedSteps,
    evidence_gaps: evidenceGaps,
    counterfactual_checks: counterfactualChecks,
    final_verdict: finalVerdict
  };
}

function deriveFinalVerdict(
  frame: MetaSignalFrame,
  contestedStepCount: number,
  evidenceGapCount: number,
  warnCount: number,
  triggerTags: MetaTriggerTag[]
): VerificationTrace["final_verdict"] {
  if (
    frame.action_signals.side_effect_severity >= 0.85 ||
    (frame.action_signals.tool_precondition_completeness < 0.3 &&
      frame.action_signals.schema_confidence < 0.35) ||
    (triggerTags.includes("risk_high") &&
      frame.action_signals.reversibility_score <= 0.3 &&
      frame.governance_signals.need_for_human_accountability >= 0.8)
  ) {
    return "fail";
  }

  if (
    evidenceGapCount > 0 ||
    frame.reasoning_signals.contradiction_score >= 0.5 ||
    frame.reasoning_signals.candidate_reasoning_divergence >= 0.65
  ) {
    return "inconclusive";
  }

  if (
    contestedStepCount > 0 ||
    warnCount > 0 ||
    frame.prediction_signals.uncertainty_decomposition.calibration_gap >= 0.45 ||
    triggerTags.includes("tool_not_ready")
  ) {
    return "weak-pass";
  }

  return "pass";
}

function calibrateConfidence(input: {
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

  if (
    input.toolReadiness < 0.5 ||
    input.controllabilityScore < 0.45
  ) {
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

function topPredictedAction(actions: CandidateAction[], predictions: Prediction[]) {
  return [...actions]
    .map((action) => {
      const prediction = predictions.find((row) => row.action_id === action.action_id);
      const success = prediction?.success_probability ?? 0.5;
      const uncertainty = prediction?.uncertainty ?? 0.5;
      const sideEffectPenalty =
        action.side_effect_level === "high"
          ? 0.3
          : action.side_effect_level === "medium"
            ? 0.1
            : 0;
      return {
        action,
        score: success * 0.6 + (1 - uncertainty) * 0.4 - sideEffectPenalty
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.action;
}

function safestAction(actions: CandidateAction[]) {
  return [...actions]
    .sort((left, right) => rankSafety(right) - rankSafety(left))[0];
}

function rankSafety(action: CandidateAction) {
  const sideEffectScore =
    action.side_effect_level === "high"
      ? 0
      : action.side_effect_level === "medium"
        ? 0.35
        : action.side_effect_level === "low"
          ? 0.7
          : 1;
  const typeScore =
    action.action_type === "ask_user"
      ? 1
      : action.action_type === "respond"
        ? 0.85
        : action.action_type === "wait"
          ? 0.75
          : action.action_type === "call_tool"
            ? 0.2
            : 0.5;
  return sideEffectScore * 0.55 + typeScore * 0.45;
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
    `trigger_tags=${input.triggerTags.join(",") || "none"}`,
    `verdict=${input.verdict}`,
    `calibrated_confidence=${input.calibratedConfidence.toFixed(2)}`,
    `evidence=${input.evidenceSufficiency.toFixed(2)}`,
    `process=${input.processReliability.toFixed(2)}`,
    `simulation=${input.simulationReliability.toFixed(2)}`,
    `tool=${input.toolReadiness.toFixed(2)}`,
    `conflict=${input.conflictIndex.toFixed(2)}`
  ].join("; ");
}

function deriveTriggerTags(frame: MetaSignalFrame, fastAssessment: FastMetaAssessment): MetaTriggerTag[] {
  if (Array.isArray(fastAssessment.trigger_tags) && fastAssessment.trigger_tags.length > 0) {
    return fastAssessment.trigger_tags;
  }

  const tags = new Set<MetaTriggerTag>();

  if (
    frame.action_signals.side_effect_severity >= 0.75 ||
    frame.governance_signals.need_for_human_accountability >= 0.75
  ) tags.add("risk_high");
  if (
    frame.evidence_signals.retrieval_coverage < 0.35 ||
    frame.evidence_signals.missing_critical_evidence_flags.length > 0
  ) tags.add("evidence_gap");
  if (
    frame.reasoning_signals.contradiction_score >= 0.45 ||
    frame.reasoning_signals.candidate_reasoning_divergence >= 0.65
  ) tags.add("reasoning_conflict");
  if (
    frame.prediction_signals.uncertainty_decomposition.model_disagreement >= 0.6 ||
    frame.prediction_signals.simulator_confidence < 0.4
  ) tags.add("simulation_unreliable");
  if (frame.task_signals.task_novelty >= 0.7) tags.add("task_novel");
  if (frame.task_signals.ood_score >= 0.65) tags.add("ood_detected");
  if ((fastAssessment.confidence?.calibration_confidence ?? 1) < 0.45) tags.add("calibration_weak");
  if (
    frame.action_signals.tool_precondition_completeness < 0.5 ||
    frame.action_signals.schema_confidence < 0.5
  ) tags.add("tool_not_ready");
  if (frame.governance_signals.budget_pressure >= 0.75) tags.add("budget_tight");
  if (frame.governance_signals.policy_warning_density > 0) tags.add("policy_warned");

  return Array.from(tags);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
