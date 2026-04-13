import type {
  CandidateAction,
  Goal,
  MetaSignalProvenance,
  MetaSignalFrame,
  ModuleContext,
  PolicyDecision,
  Prediction,
  WorkspaceSnapshot
} from "@neurocore/protocol";

interface CollectInput {
  ctx: ModuleContext;
  workspace: WorkspaceSnapshot;
  actions: CandidateAction[];
  predictions: Prediction[];
  policies: PolicyDecision[];
  predictionErrorRate?: number;
  goals: Goal[];
}

export class MetaSignalBus {
  public collect(input: CollectInput): MetaSignalFrame {
    const { ctx, workspace, actions, predictions, policies, predictionErrorRate, goals } = input;
    const timestamp = ctx.services.now();
    const warnCount = policies.filter((decision) => decision.level === "warn").length;
    const blockCount = policies.filter((decision) => decision.level === "block").length;
    const memoryRecallProposals = Array.isArray(ctx.runtime_state.memory_recall_proposals)
      ? ctx.runtime_state.memory_recall_proposals.length
      : 0;
    const skillMatchProposals = Array.isArray(ctx.runtime_state.skill_match_proposals)
      ? ctx.runtime_state.skill_match_proposals.length
      : 0;
    const activeGoals = goals.filter((goal) => goal.status === "active" || goal.status === "pending");
    const primaryGoal = [...activeGoals].sort((left, right) => right.priority - left.priority)[0];
    const dependencyCount = countUnresolvedDependencies(activeGoals);
    const avgPredictionSuccess = average(
      predictions.map((prediction) => prediction.success_probability).filter(isNumber)
    );
    const avgPredictionUncertainty = average(
      predictions.map((prediction) => prediction.uncertainty).filter(isNumber)
    );
    const predictorDisagreement = computePredictorDisagreement(predictions);
    const highRiskActionCount = actions.filter((action) => action.side_effect_level === "high").length;
    const mediumRiskActionCount = actions.filter((action) => action.side_effect_level === "medium").length;
    const actionCount = Math.max(actions.length, 1);
    const retrievalTopK = Math.max(ctx.profile.memory_config.retrieval_top_k ?? 5, 1);
    const retrievalCoverage = clamp01(
      workspace.memory_digest.length > 0
        ? Math.min(1, workspace.memory_digest.length / retrievalTopK)
        : memoryRecallProposals > 0
          ? Math.min(1, memoryRecallProposals / retrievalTopK)
          : 0
    );
    const evidenceFreshness = computeEvidenceFreshness(ctx, workspace, retrievalCoverage);
    const evidenceAgreement = computeEvidenceAgreement(workspace, warnCount, blockCount);
    const sourceReliabilityPrior = computeSourceReliabilityPrior(workspace, retrievalCoverage, predictionErrorRate);
    const familiarity = clamp01((memoryRecallProposals * 0.45 + skillMatchProposals * 0.55) / 5);
    const novelty = computeTaskNovelty({
      familiarity,
      actions,
      activeGoals,
      highRiskActionCount
    });
    const historicalSuccessRate = computeHistoricalSuccessRate(predictionErrorRate, familiarity);
    const taskOOD = clamp01(weightedAverage([
      [novelty, 0.45],
      [avgPredictionUncertainty, 0.2],
      [predictorDisagreement, 0.2],
      [1 - familiarity, 0.15]
    ]));
    const divergence = computeActionDivergence(actions);
    const contradictionScore = clamp01(
      ((workspace.competition_log?.conflicts.length ?? 0) * 0.35) +
        (warnCount > 0 ? 0.15 : 0) +
        blockCount * 0.2 +
        (predictionErrorRate ?? 0) * 0.3
    );
    const epistemic = clamp01((novelty + (1 - retrievalCoverage)) / 2);
    const aleatoric = clamp01(avgPredictionUncertainty * 0.8 + (predictionErrorRate ?? 0) * 0.2);
    const calibrationGap = clamp01(predictionErrorRate ?? 0);
    const predictorBucketReliability = clamp01(1 - calibrationGap * 0.8);
    const budgetPressure = computeBudgetPressure(ctx);
    const missingCriticalEvidenceFlags = buildMissingEvidenceFlags(ctx, workspace, actions, retrievalCoverage);
    const goalDepth = computeGoalDepth(activeGoals);
    const toolPreconditionCompleteness = computeToolPreconditionCompleteness(actions);
    const schemaConfidence = computeSchemaConfidence(actions);
    const sideEffectSeverity = clamp01((highRiskActionCount + mediumRiskActionCount * 0.5) / actionCount);
    const reversibilityScore = computeReversibilityScore(actions);
    const observability = computeObservability(actions);
    const fallbackAvailability = actions.some((action) => action.action_type === "respond" || action.action_type === "ask_user") ? 1 : 0.4;
    const remainingRecoveryOptions = computeRecoveryOptions(actions);
    const needForHumanAccountability = clamp01(
      (highRiskActionCount > 0 ? 0.7 : 0) +
        (warnCount > 0 ? 0.2 : 0) +
        (budgetPressure >= 0.9 ? 0.1 : 0)
    );
    const provenance = buildProvenance({
      timestamp,
      retrievalCoverage,
      evidenceFreshness,
      sourceReliabilityPrior,
      predictionErrorRate,
      budgetPressure,
      skillMatchProposals,
      memoryRecallProposals,
      activeGoals
    });

    return {
      frame_id: ctx.services.generateId("msf"),
      session_id: ctx.session.session_id,
      cycle_id: workspace.cycle_id,
      goal_id: primaryGoal?.goal_id,
      task_signals: {
        task_novelty: novelty,
        domain_familiarity: familiarity,
        historical_success_rate: historicalSuccessRate,
        ood_score: taskOOD,
        decomposition_depth: goalDepth,
        goal_decomposition_depth: goalDepth,
        unresolved_dependency_count: dependencyCount
      },
      evidence_signals: {
        retrieval_coverage: retrievalCoverage,
        evidence_freshness: evidenceFreshness,
        evidence_agreement_score: evidenceAgreement,
        source_reliability_prior: sourceReliabilityPrior,
        missing_critical_evidence_flags: missingCriticalEvidenceFlags
      },
      reasoning_signals: {
        candidate_reasoning_divergence: divergence,
        step_consistency: clamp01(1 - contradictionScore),
        contradiction_score: contradictionScore,
        assumption_count: countAssumptions(actions),
        unsupported_leap_count: retrievalCoverage < 0.35 ? 1 : 0,
        self_consistency_margin: clamp01(1 - divergence)
      },
      prediction_signals: {
        predicted_success_probability: avgPredictionSuccess,
        predicted_downside_severity: sideEffectSeverity,
        uncertainty_decomposition: {
          epistemic,
          aleatoric,
          evidence_missing: clamp01(1 - retrievalCoverage),
          model_disagreement: clamp01((divergence + predictorDisagreement) / 2),
          simulator_unreliability: avgPredictionUncertainty,
          calibration_gap: calibrationGap
        },
        simulator_confidence: clamp01(1 - avgPredictionUncertainty),
        predictor_error_rate: clamp01(predictionErrorRate ?? avgPredictionUncertainty),
        predictor_bucket_reliability: predictorBucketReliability,
        predictor_calibration_bucket: toCalibrationBucket(calibrationGap),
        world_model_mismatch_score: clamp01(predictionErrorRate ?? avgPredictionUncertainty)
      },
      action_signals: {
        tool_precondition_completeness: toolPreconditionCompleteness,
        schema_confidence: schemaConfidence,
        side_effect_severity: sideEffectSeverity,
        reversibility_score: reversibilityScore,
        observability_after_action: observability,
        fallback_availability: fallbackAvailability
      },
      governance_signals: {
        policy_warning_density: clamp01(warnCount / actionCount),
        budget_pressure: budgetPressure,
        remaining_recovery_options: remainingRecoveryOptions,
        need_for_human_accountability: needForHumanAccountability
      },
      provenance,
      created_at: timestamp
    };
  }
}

function buildMissingEvidenceFlags(
  ctx: ModuleContext,
  workspace: WorkspaceSnapshot,
  actions: CandidateAction[],
  retrievalCoverage: number
): string[] {
  const flags: string[] = [];
  if (retrievalCoverage < 0.35) {
    flags.push("low_retrieval_coverage");
  }
  if (actions.some((action) => action.action_type === "call_tool" && !action.tool_name)) {
    flags.push("missing_tool_name");
  }
  if ((workspace.competition_log?.conflicts.length ?? 0) > 0 && retrievalCoverage < 0.5) {
    flags.push("conflict_without_supporting_evidence");
  }
  if (isTimeSensitiveInput(ctx.runtime_state.current_input_content) && retrievalCoverage < 0.5) {
    flags.push("missing_current_grounding");
  }
  if (actions.some((action) => action.action_type === "call_tool" && (!action.tool_args || Object.keys(action.tool_args).length === 0))) {
    flags.push("missing_tool_schema");
  }
  return flags;
}

function computeTaskNovelty(input: {
  familiarity: number;
  actions: CandidateAction[];
  activeGoals: Goal[];
  highRiskActionCount: number;
}) {
  const newToolMix =
    input.actions.filter((action) => action.action_type === "call_tool").length > 1 ? 0.15 : 0;
  const goalComplexity = input.activeGoals.length > 2 ? 0.1 : 0;
  const highRiskBias = input.highRiskActionCount > 0 ? 0.1 : 0;
  return clamp01(1 - input.familiarity + newToolMix + goalComplexity + highRiskBias);
}

function computeHistoricalSuccessRate(predictionErrorRate: number | undefined, familiarity: number) {
  if (typeof predictionErrorRate === "number") {
    return clamp01(1 - predictionErrorRate);
  }
  return clamp01(0.45 + familiarity * 0.4);
}

function computeEvidenceFreshness(
  ctx: ModuleContext,
  workspace: WorkspaceSnapshot,
  retrievalCoverage: number
) {
  if (isTimeSensitiveInput(ctx.runtime_state.current_input_content)) {
    return retrievalCoverage > 0.5 ? 0.65 : 0.25;
  }
  if (workspace.memory_digest.length > 0) {
    return 0.75;
  }
  return 0.5;
}

function computeEvidenceAgreement(workspace: WorkspaceSnapshot, warnCount: number, blockCount: number) {
  const conflictPenalty =
    (workspace.competition_log?.conflicts.length ?? 0) /
    Math.max(workspace.competition_log?.entries.length ?? 1, 1);
  const governancePenalty = clamp01(warnCount * 0.1 + blockCount * 0.2);
  return clamp01(1 - conflictPenalty - governancePenalty);
}

function computeSourceReliabilityPrior(
  workspace: WorkspaceSnapshot,
  retrievalCoverage: number,
  predictionErrorRate?: number
) {
  const semanticRatio =
    workspace.memory_digest.length === 0
      ? 0
      : workspace.memory_digest.filter((row) => row.memory_type === "semantic" || row.memory_type === "procedural").length /
        workspace.memory_digest.length;
  return clamp01(
    0.45 +
      retrievalCoverage * 0.25 +
      semanticRatio * 0.15 -
      (predictionErrorRate ?? 0) * 0.15
  );
}

function computePredictorDisagreement(predictions: Prediction[]) {
  if (predictions.length <= 1) {
    return 0;
  }
  const successValues = predictions.map((prediction) => prediction.success_probability).filter(isNumber);
  if (successValues.length <= 1) {
    return 0;
  }
  const max = Math.max(...successValues);
  const min = Math.min(...successValues);
  return clamp01(max - min);
}

function computeBudgetPressure(ctx: ModuleContext) {
  const state = ctx.session.budget_state;
  const ratios = [
    ratio(state.token_budget_used, state.token_budget_total),
    ratio(state.cost_budget_used, state.cost_budget_total),
    ratio(state.tool_call_used, state.tool_call_limit),
    ratio(state.cycle_used, state.cycle_limit)
  ].filter(isNumber);

  if (ratios.length === 0) {
    return 0;
  }

  const maxRatio = Math.max(...ratios);
  const meanRatio = average(ratios);
  return clamp01(maxRatio * 0.7 + meanRatio * 0.3);
}

function buildProvenance(input: {
  timestamp: string;
  retrievalCoverage: number;
  evidenceFreshness: number;
  sourceReliabilityPrior: number;
  predictionErrorRate?: number;
  budgetPressure: number;
  skillMatchProposals: number;
  memoryRecallProposals: number;
  activeGoals: Goal[];
}): MetaSignalProvenance[] {
  return [
    provenance("task", "task_novelty", "memory+skill-heuristic", input.skillMatchProposals + input.memoryRecallProposals > 0 ? "ok" : "fallback", input.timestamp),
    provenance("task", "decomposition_depth", "goal-manager", input.activeGoals.length > 0 ? "ok" : "fallback", input.timestamp),
    provenance("evidence", "retrieval_coverage", "workspace+memory", input.memoryRecallProposals > 0 ? "ok" : "fallback", input.timestamp),
    provenance("evidence", "evidence_freshness", "timeliness-heuristic", input.evidenceFreshness >= 0.5 ? "degraded" : "fallback", input.timestamp),
    provenance("evidence", "source_reliability_prior", "memory-digest-heuristic", input.sourceReliabilityPrior > 0 ? "degraded" : "fallback", input.timestamp),
    provenance("prediction", "predictor_error_rate", "prediction-store", typeof input.predictionErrorRate === "number" ? "ok" : "fallback", input.timestamp),
    provenance("governance", "budget_pressure", "session-budget-state", input.budgetPressure > 0 ? "ok" : "fallback", input.timestamp),
    provenance("action", "tool_precondition_completeness", "candidate-actions", "ok", input.timestamp)
  ];
}

function provenance(
  family: string,
  field: string,
  provider: string,
  status: MetaSignalProvenance["status"],
  timestamp: string,
  note?: string
): MetaSignalProvenance {
  return {
    family,
    field,
    provider,
    status,
    timestamp,
    note
  };
}

function computeToolPreconditionCompleteness(actions: CandidateAction[]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.action_type !== "call_tool") {
          return 1;
        }
        if (!action.tool_name) {
          return 0.2;
        }
        if (!Array.isArray(action.preconditions) || action.preconditions.length === 0) {
          return 0.8;
        }
        return 0.9;
      })
    )
  );
}

function computeSchemaConfidence(actions: CandidateAction[]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.action_type !== "call_tool") {
          return 1;
        }
        if (!action.tool_name) {
          return 0.3;
        }
        if (action.tool_args && Object.keys(action.tool_args).length > 0) {
          return 0.9;
        }
        return 0.7;
      })
    )
  );
}

function computeReversibilityScore(actions: CandidateAction[]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.rollback_hint) {
          return 0.95;
        }
        if (action.side_effect_level === "high") {
          return 0.2;
        }
        if (action.side_effect_level === "medium") {
          return 0.5;
        }
        return 0.9;
      })
    )
  );
}

function computeObservability(actions: CandidateAction[]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.action_type === "respond" || action.action_type === "ask_user") {
          return 0.95;
        }
        if (action.action_type === "call_tool") {
          return 0.75;
        }
        return 0.65;
      })
    )
  );
}

function computeRecoveryOptions(actions: CandidateAction[]): number {
  if (actions.length === 0) {
    return 0;
  }

  const count = actions.filter(
    (action) =>
      action.action_type === "ask_user" ||
      action.action_type === "respond" ||
      Boolean(action.rollback_hint)
  ).length;
  return clamp01(count / actions.length);
}

function computeActionDivergence(actions: CandidateAction[]): number {
  if (actions.length <= 1) {
    return 0;
  }

  const categories = new Set(
    actions.map((action) => `${action.action_type}:${action.tool_name ?? "none"}`)
  );
  return clamp01((categories.size - 1) / Math.max(actions.length - 1, 1));
}

function computeGoalDepth(goals: Goal[]): number {
  if (goals.length === 0) {
    return 0;
  }
  const byId = new Map(goals.map((goal) => [goal.goal_id, goal]));
  return clamp01(Math.max(...goals.map((goal) => depthForGoal(goal, byId))) / 4);
}

function depthForGoal(goal: Goal, byId: Map<string, Goal>) {
  let depth = 0;
  let current = goal.parent_goal_id ? byId.get(goal.parent_goal_id) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.goal_id)) {
    seen.add(current.goal_id);
    depth += 1;
    current = current.parent_goal_id ? byId.get(current.parent_goal_id) : undefined;
  }
  return depth;
}

function countUnresolvedDependencies(goals: Goal[]) {
  const dependencies = new Set<string>();
  for (const goal of goals) {
    for (const dependency of goal.dependencies ?? []) {
      dependencies.add(dependency);
    }
  }
  return dependencies.size;
}

function countAssumptions(actions: CandidateAction[]): number {
  return actions.reduce((count, action) => {
    if (Array.isArray(action.preconditions) && action.preconditions.length > 0) {
      return count + action.preconditions.length;
    }
    return count;
  }, 0);
}

function toCalibrationBucket(calibrationGap: number): string {
  if (calibrationGap >= 0.7) {
    return "poor";
  }
  if (calibrationGap >= 0.4) {
    return "mixed";
  }
  return "stable";
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.5;
  }
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedAverage(entries: Array<[number, number]>) {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) {
    return 0.5;
  }
  const total = entries.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return clamp01(total / totalWeight);
}

function ratio(used?: number, total?: number) {
  if (!isNumber(used) || !isNumber(total) || total <= 0) {
    return undefined;
  }
  return clamp01(used / total);
}

function isTimeSensitiveInput(content: unknown) {
  if (typeof content !== "string") {
    return false;
  }
  const text = content.toLowerCase();
  return /latest|current|today|now|price|schedule|news|recent|实时|最新|今天|当前/.test(text);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
