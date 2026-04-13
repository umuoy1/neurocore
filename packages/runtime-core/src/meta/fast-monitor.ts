import type {
  ConfidenceVector,
  FastMetaAssessment,
  MetaAssessment,
  MetaControlAction,
  MetaSignalFrame,
  MetaState,
  MetaTriggerTag,
  SelfEvaluationReport,
  VerificationTrace
} from "@neurocore/protocol";

interface BuildAssessmentInput {
  frame: MetaSignalFrame;
  selectedMetaActions?: MetaControlAction[];
  selectedControlMode?: string;
  verificationTrace?: VerificationTrace;
}

export class FastMonitor {
  public assess(frame: MetaSignalFrame): FastMetaAssessment {
    const confidence = this.buildConfidenceVector(frame);
    const triggerTags = this.deriveTriggerTags(frame, confidence);
    const metaState = this.deriveMetaState(triggerTags, confidence);
    const recommendedControlActions = this.recommendActions(frame, triggerTags, metaState);
    const triggerDeepEval = this.shouldTriggerDeepEval(frame, triggerTags);

    return {
      assessment_id: `${frame.frame_id}_fast`,
      session_id: frame.session_id,
      cycle_id: frame.cycle_id,
      meta_state: metaState,
      provisional_confidence: confidence.overall_confidence,
      confidence,
      trigger_tags: triggerTags,
      trigger_deep_eval: triggerDeepEval,
      recommended_control_actions: recommendedControlActions,
      rationale: this.buildRationale(frame, metaState, triggerTags, confidence),
      created_at: frame.created_at
    };
  }

  public buildMetaAssessment(input: BuildAssessmentInput): MetaAssessment {
    const confidence = this.buildConfidenceVector(input.frame);
    const triggerTags = this.deriveTriggerTags(input.frame, confidence);
    const metaState = this.deriveMetaState(triggerTags, confidence);
    const recommendedControlAction =
      input.selectedMetaActions?.[0] ??
      this.recommendActions(input.frame, triggerTags, metaState)[0] ??
      "execute-now";

    return {
      assessment_id: `${input.frame.frame_id}_meta`,
      session_id: input.frame.session_id,
      cycle_id: input.frame.cycle_id,
      meta_state: metaState,
      confidence,
      uncertainty_decomposition: input.frame.prediction_signals.uncertainty_decomposition,
      failure_modes: deriveFailureModes(input.frame, metaState),
      recommended_control_action: recommendedControlAction,
      rationale: this.buildRationale(input.frame, metaState, triggerTags, confidence),
      created_at: input.frame.created_at
    };
  }

  public buildSelfEvaluationReport(input: BuildAssessmentInput): SelfEvaluationReport {
    const confidence = this.buildConfidenceVector(input.frame);
    const triggerTags = this.deriveTriggerTags(input.frame, confidence);
    const metaState = this.deriveMetaState(triggerTags, confidence);

    return {
      report_id: `${input.frame.frame_id}_report`,
      session_id: input.frame.session_id,
      cycle_id: input.frame.cycle_id,
      stage_scores: {
        retrieval_quality: input.frame.evidence_signals.retrieval_coverage,
        evidence_sufficiency:
          (input.frame.evidence_signals.retrieval_coverage + input.frame.evidence_signals.evidence_agreement_score) / 2,
        plan_coherence:
          (1 - input.frame.reasoning_signals.candidate_reasoning_divergence + input.frame.reasoning_signals.step_consistency) / 2,
        execution_readiness:
          (input.frame.action_signals.tool_precondition_completeness + input.frame.action_signals.schema_confidence) / 2,
        recovery_readiness:
          (input.frame.action_signals.fallback_availability + input.frame.governance_signals.remaining_recovery_options) / 2
      },
      contradictions: buildContradictions(input.frame),
      missing_evidence: input.frame.evidence_signals.missing_critical_evidence_flags.map((flag) => ({
        key: flag,
        summary: flag.replaceAll("_", " "),
        severity: flag.includes("low") ? "medium" : "high"
      })),
      failure_diagnosis: {
        dominant_failure_mode: deriveFailureModes(input.frame, metaState)[0] ?? "underconfidence",
        failure_modes: deriveFailureModes(input.frame, metaState),
        summary: this.buildRationale(input.frame, metaState, triggerTags, confidence)
      },
      verification_trace: input.verificationTrace,
      selected_control_mode: input.selectedControlMode ?? toControlMode(metaState),
      selected_meta_actions: input.selectedMetaActions ?? this.recommendActions(input.frame, triggerTags, metaState),
      explanation: this.buildRationale(input.frame, metaState, triggerTags, confidence),
      created_at: input.frame.created_at
    };
  }

  private buildConfidenceVector(frame: MetaSignalFrame): ConfidenceVector {
    const evidenceConfidence = mean([
      frame.evidence_signals.retrieval_coverage,
      frame.evidence_signals.evidence_agreement_score,
      frame.evidence_signals.source_reliability_prior
    ]);
    const processConfidence = mean([
      frame.reasoning_signals.step_consistency,
      1 - frame.reasoning_signals.candidate_reasoning_divergence,
      1 - frame.reasoning_signals.contradiction_score
    ]);
    const simulationConfidence = mean([
      frame.prediction_signals.predicted_success_probability,
      frame.prediction_signals.simulator_confidence,
      1 - frame.prediction_signals.world_model_mismatch_score
    ]);
    const actionSafetyConfidence = mean([
      1 - frame.action_signals.side_effect_severity,
      frame.action_signals.reversibility_score
    ]);
    const toolReadinessConfidence = mean([
      frame.action_signals.tool_precondition_completeness,
      frame.action_signals.schema_confidence
    ]);
    const calibrationConfidence = 1 - frame.prediction_signals.uncertainty_decomposition.calibration_gap;
    const answerConfidence = mean([
      processConfidence,
      evidenceConfidence,
      simulationConfidence
    ]);
    const overallConfidence = weightedMean([
      [answerConfidence, 0.15],
      [processConfidence, 0.15],
      [evidenceConfidence, 0.2],
      [simulationConfidence, 0.15],
      [actionSafetyConfidence, 0.15],
      [toolReadinessConfidence, 0.1],
      [calibrationConfidence, 0.1]
    ]);

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

  private deriveTriggerTags(frame: MetaSignalFrame, confidence: ConfidenceVector): MetaTriggerTag[] {
    const tags = new Set<MetaTriggerTag>();

    if (
      frame.action_signals.side_effect_severity >= 0.75 ||
      frame.governance_signals.need_for_human_accountability >= 0.75
    ) {
      tags.add("risk_high");
    }

    if (
      frame.evidence_signals.retrieval_coverage < 0.35 ||
      frame.evidence_signals.missing_critical_evidence_flags.length > 0
    ) {
      tags.add("evidence_gap");
    }

    if (
      frame.reasoning_signals.contradiction_score >= 0.45 ||
      frame.reasoning_signals.candidate_reasoning_divergence >= 0.65
    ) {
      tags.add("reasoning_conflict");
    }

    if (
      frame.prediction_signals.uncertainty_decomposition.model_disagreement >= 0.6 ||
      frame.prediction_signals.simulator_confidence < 0.4
    ) {
      tags.add("simulation_unreliable");
    }

    if (frame.task_signals.task_novelty >= 0.7) {
      tags.add("task_novel");
    }

    if (frame.task_signals.ood_score >= 0.65) {
      tags.add("ood_detected");
    }

    if (confidence.calibration_confidence < 0.45) {
      tags.add("calibration_weak");
    }

    if (
      frame.action_signals.tool_precondition_completeness < 0.5 ||
      frame.action_signals.schema_confidence < 0.5
    ) {
      tags.add("tool_not_ready");
    }

    if (frame.governance_signals.budget_pressure >= 0.75) {
      tags.add("budget_tight");
    }

    if (frame.governance_signals.policy_warning_density > 0) {
      tags.add("policy_warned");
    }

    return Array.from(tags);
  }

  private deriveMetaState(triggerTags: MetaTriggerTag[], confidence: ConfidenceVector): MetaState {
    if (triggerTags.includes("risk_high")) {
      return "high-risk";
    }
    if (triggerTags.includes("evidence_gap")) {
      return "evidence-insufficient";
    }
    if (triggerTags.includes("reasoning_conflict")) {
      return "high-conflict";
    }
    if (triggerTags.includes("simulation_unreliable")) {
      return "simulation-unreliable";
    }
    if (
      triggerTags.includes("task_novel") ||
      triggerTags.includes("ood_detected") ||
      triggerTags.includes("calibration_weak") ||
      triggerTags.includes("tool_not_ready")
    ) {
      return "needs-deep-eval";
    }
    if (confidence.overall_confidence < 0.65) {
      return "routine-uncertain";
    }
    return "routine-safe";
  }

  private shouldTriggerDeepEval(frame: MetaSignalFrame, triggerTags: MetaTriggerTag[]): boolean {
    if (triggerTags.includes("risk_high")) {
      return true;
    }
    if (triggerTags.includes("reasoning_conflict")) {
      return true;
    }
    if (triggerTags.includes("simulation_unreliable")) {
      return true;
    }
    if (triggerTags.includes("evidence_gap") && triggerTags.includes("policy_warned")) {
      return true;
    }
    if (triggerTags.includes("task_novel") && triggerTags.includes("ood_detected")) {
      return true;
    }
    const riskLevel = this.deriveRiskLevel(frame);
    if (
      triggerTags.includes("calibration_weak") &&
      (riskLevel === "high" || riskLevel === "critical")
    ) {
      return true;
    }
    return false;
  }

  private recommendActions(
    frame: MetaSignalFrame,
    triggerTags: MetaTriggerTag[],
    metaState: MetaState
  ): MetaControlAction[] {
    const actions = new Set<MetaControlAction>();

    for (const tag of triggerTags) {
      switch (tag) {
        case "risk_high":
          actions.add("execute-with-approval");
          actions.add("invoke-verifier");
          break;
        case "evidence_gap":
          actions.add("request-more-evidence");
          break;
        case "reasoning_conflict":
          actions.add("invoke-verifier");
          actions.add("run-more-samples");
          break;
        case "simulation_unreliable":
          actions.add("run-more-samples");
          actions.add("replan");
          break;
        case "task_novel":
          actions.add("run-more-samples");
          break;
        case "ood_detected":
          actions.add("invoke-verifier");
          actions.add("replan");
          break;
        case "calibration_weak":
          actions.add("invoke-verifier");
          break;
        case "tool_not_ready":
          actions.add("replan");
          actions.add("switch-to-safe-response");
          break;
        case "budget_tight":
          actions.add("switch-to-safe-response");
          break;
        case "policy_warned":
          actions.add("invoke-verifier");
          break;
      }
    }

    if (actions.size === 0) {
      if (metaState === "routine-safe") {
        actions.add("execute-now");
      } else if (metaState === "routine-uncertain") {
        actions.add("request-more-evidence");
      }
    }

    let ordered = Array.from(actions);

    if (triggerTags.includes("evidence_gap")) {
      ordered = ordered.filter((action) => action !== "run-more-samples");
    }
    if (triggerTags.includes("budget_tight") && !triggerTags.includes("risk_high")) {
      ordered = ordered.filter((action) => action !== "run-more-samples" && action !== "invoke-verifier");
    }
    if (triggerTags.includes("risk_high")) {
      ordered.sort((left, right) => priorityOfAction(left, frame) - priorityOfAction(right, frame));
      return dedupeOrdered(["execute-with-approval", ...ordered]);
    }

    ordered.sort((left, right) => priorityOfAction(left, frame) - priorityOfAction(right, frame));
    return ordered.length > 0 ? ordered : ["execute-now"];
  }

  private deriveRiskLevel(frame: MetaSignalFrame): "low" | "medium" | "high" | "critical" {
    if (
      frame.action_signals.side_effect_severity >= 0.9 ||
      frame.governance_signals.need_for_human_accountability >= 0.9
    ) {
      return "critical";
    }
    if (
      frame.action_signals.side_effect_severity >= 0.75 ||
      frame.governance_signals.need_for_human_accountability >= 0.75
    ) {
      return "high";
    }
    if (
      frame.action_signals.side_effect_severity >= 0.45 ||
      frame.governance_signals.policy_warning_density > 0
    ) {
      return "medium";
    }
    return "low";
  }

  private buildRationale(
    frame: MetaSignalFrame,
    metaState: MetaState,
    triggerTags: MetaTriggerTag[],
    confidence: ConfidenceVector
  ): string {
    const parts = [
      `primary_state=${metaState}`,
      `trigger_tags=${triggerTags.join(",") || "none"}`,
      `overall_confidence=${confidence.overall_confidence.toFixed(2)}`,
      `evidence_confidence=${confidence.evidence_confidence.toFixed(2)}`,
      `process_confidence=${confidence.process_confidence.toFixed(2)}`,
      `simulation_confidence=${confidence.simulation_confidence.toFixed(2)}`,
      `action_safety_confidence=${confidence.action_safety_confidence.toFixed(2)}`,
      `retrieval_coverage=${frame.evidence_signals.retrieval_coverage.toFixed(2)}`,
      `contradiction_score=${frame.reasoning_signals.contradiction_score.toFixed(2)}`,
      `side_effect_severity=${frame.action_signals.side_effect_severity.toFixed(2)}`
    ];
    return parts.join("; ");
  }
}

function deriveFailureModes(frame: MetaSignalFrame, metaState: MetaState) {
  const modes = new Set<import("@neurocore/protocol").FailureMode>();

  if (frame.evidence_signals.retrieval_coverage < 0.35) {
    modes.add("insufficient_evidence");
  }
  if (frame.reasoning_signals.contradiction_score >= 0.45) {
    modes.add("wrong_assumption");
  }
  if (frame.prediction_signals.world_model_mismatch_score >= 0.5) {
    modes.add("prediction_drift");
  }
  if (frame.action_signals.tool_precondition_completeness < 0.5) {
    modes.add("tool_failure");
  }
  if (frame.prediction_signals.uncertainty_decomposition.calibration_gap >= 0.5) {
    modes.add("overconfidence");
  }
  if (metaState === "routine-uncertain" && modes.size === 0) {
    modes.add("underconfidence");
  }

  return Array.from(modes);
}

function buildContradictions(frame: MetaSignalFrame) {
  const rows: import("@neurocore/protocol").ContradictionRecord[] = [];

  if (frame.reasoning_signals.contradiction_score >= 0.45) {
    rows.push({
      source: "reasoning",
      conflict_type: "candidate_divergence",
      summary: "Candidate reasoning paths show material disagreement."
    });
  }

  if (frame.prediction_signals.world_model_mismatch_score >= 0.5) {
    rows.push({
      source: "prediction",
      conflict_type: "world_model_mismatch",
      summary: "Prediction signals indicate elevated mismatch with expected world behavior."
    });
  }

  if (frame.governance_signals.policy_warning_density > 0) {
    rows.push({
      source: "governance",
      conflict_type: "policy_warning",
      summary: "Policy evaluation emitted warnings for one or more candidate actions."
    });
  }

  return rows;
}

function toControlMode(metaState: MetaState): string {
  switch (metaState) {
    case "high-risk":
      return "escalation_path";
    case "high-conflict":
    case "evidence-insufficient":
    case "simulation-unreliable":
    case "needs-deep-eval":
      return "slow_path";
    default:
      return "fast_path";
  }
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedMean(entries: Array<[number, number]>): number {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  const total = entries.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return clamp01(total / totalWeight);
}

function priorityOfAction(action: MetaControlAction, frame: MetaSignalFrame): number {
  if (action === "request-more-evidence") return 0;
  if (action === "execute-with-approval") return 1;
  if (action === "invoke-verifier") return frame.governance_signals.budget_pressure >= 0.75 ? 6 : 2;
  if (action === "replan") return 3;
  if (action === "run-more-samples") return frame.governance_signals.budget_pressure >= 0.75 ? 7 : 4;
  if (action === "switch-to-safe-response") return 5;
  if (action === "ask-human") return 8;
  if (action === "abort") return 9;
  if (action === "decompose-goal") return 10;
  return 11;
}

function dedupeOrdered(actions: MetaControlAction[]) {
  const next = new Set<MetaControlAction>();
  for (const action of actions) {
    next.add(action);
  }
  return Array.from(next);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
