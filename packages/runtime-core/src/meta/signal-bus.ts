import type {
  ActionMetaSignals,
  EvidenceMetaSignals,
  Goal,
  GovernanceMetaSignals,
  MetaSignalFrame,
  MetaSignalProvenance,
  MetaSignalProviderProfile,
  MetaSignalProviderReliabilityStore,
  ModuleContext,
  PolicyDecision,
  Prediction,
  PredictionMetaSignals,
  ReasoningMetaSignals,
  TaskMetaSignals,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import { HeuristicActionSignalProvider } from "./providers/action-provider.js";
import { HeuristicEvidenceSignalProvider } from "./providers/evidence-provider.js";
import { HeuristicGovernanceSignalProvider } from "./providers/governance-provider.js";
import { HeuristicPredictionSignalProvider } from "./providers/prediction-provider.js";
import {
  clamp01,
  type MetaSignalFamily,
  type MetaSignalInput,
  type MetaSignalProvider,
  provenance
} from "./providers/provider.js";
import { HeuristicReasoningSignalProvider } from "./providers/reasoning-provider.js";
import { HeuristicTaskSignalProvider } from "./providers/task-provider.js";

interface CollectInput {
  ctx: ModuleContext;
  workspace: WorkspaceSnapshot;
  actions: import("@neurocore/protocol").CandidateAction[];
  predictions: Prediction[];
  policies: PolicyDecision[];
  predictionErrorRate?: number;
  goals: Goal[];
  providerReliabilityStore?: MetaSignalProviderReliabilityStore;
}

export interface MetaSignalBusOptions {
  providers?: Partial<{
    task: Array<MetaSignalProvider<TaskMetaSignals>>;
    evidence: Array<MetaSignalProvider<EvidenceMetaSignals>>;
    reasoning: Array<MetaSignalProvider<ReasoningMetaSignals>>;
    prediction: Array<MetaSignalProvider<PredictionMetaSignals>>;
    action: Array<MetaSignalProvider<ActionMetaSignals>>;
    governance: Array<MetaSignalProvider<GovernanceMetaSignals>>;
  }>;
  useDefaultProviders?: boolean;
}

export class MetaSignalBus {
  private readonly providers: Required<NonNullable<MetaSignalBusOptions["providers"]>>;

  public constructor(options: MetaSignalBusOptions = {}) {
    const defaults = options.useDefaultProviders === false
      ? emptyProviders()
      : createDefaultProviders();
    this.providers = {
      task: options.providers?.task ?? defaults.task,
      evidence: options.providers?.evidence ?? defaults.evidence,
      reasoning: options.providers?.reasoning ?? defaults.reasoning,
      prediction: options.providers?.prediction ?? defaults.prediction,
      action: options.providers?.action ?? defaults.action,
      governance: options.providers?.governance ?? defaults.governance
    };
  }

  public collect(input: CollectInput): MetaSignalFrame {
    const metaInput: MetaSignalInput = input;
    const timestamp = input.ctx.services.now();
    const activeGoals = input.goals.filter((goal) => goal.status === "active" || goal.status === "pending");
    const primaryGoal = [...activeGoals].sort((left, right) => right.priority - left.priority)[0];
    const task = this.collectFamily("task", metaInput, timestamp, fallbackTaskSignals(metaInput, timestamp));
    const evidence = this.collectFamily("evidence", metaInput, timestamp, fallbackEvidenceSignals(metaInput, timestamp));
    const reasoning = this.collectFamily("reasoning", metaInput, timestamp, fallbackReasoningSignals(metaInput, timestamp));
    const prediction = this.collectFamily("prediction", metaInput, timestamp, fallbackPredictionSignals(metaInput, timestamp));
    const action = this.collectFamily("action", metaInput, timestamp, fallbackActionSignals(metaInput, timestamp));
    const governance = this.collectFamily("governance", metaInput, timestamp, fallbackGovernanceSignals(metaInput, timestamp));
    const providerProfiles = [
      ...task.providerProfiles,
      ...evidence.providerProfiles,
      ...reasoning.providerProfiles,
      ...prediction.providerProfiles,
      ...action.providerProfiles,
      ...governance.providerProfiles
    ];

    return {
      frame_id: input.ctx.services.generateId("msf"),
      session_id: input.ctx.session.session_id,
      cycle_id: input.workspace.cycle_id,
      goal_id: primaryGoal?.goal_id,
      task_signals: task.signals,
      evidence_signals: evidence.signals,
      reasoning_signals: reasoning.signals,
      prediction_signals: prediction.signals,
      action_signals: action.signals,
      governance_signals: governance.signals,
      provider_profiles: providerProfiles,
      provenance: [
        ...task.provenance,
        ...evidence.provenance,
        ...reasoning.provenance,
        ...prediction.provenance,
        ...action.provenance,
        ...governance.provenance
      ],
      created_at: timestamp
    };
  }

  private collectFamily<TSignals>(
    family: MetaSignalFamily,
    input: MetaSignalInput,
    timestamp: string,
    fallback: { signals: TSignals; provenance: MetaSignalProvenance[] }
  ): { signals: TSignals; provenance: MetaSignalProvenance[]; providerProfiles: MetaSignalProviderProfile[] } {
    const providers = this.providers[family] as Array<MetaSignalProvider<TSignals>>;
    if (providers.length === 0) {
      return {
        signals: fallback.signals,
        provenance: fallback.provenance,
        providerProfiles: []
      };
    }

    const successful = [];
    const degradedProvenance: MetaSignalProvenance[] = [];
    const providerProfiles: MetaSignalProviderProfile[] = [];
    for (const provider of providers) {
      providerProfiles.push(getProviderProfile(input.providerReliabilityStore, provider.name, family));
      try {
        successful.push(provider.collect(input));
      } catch (error) {
        degradedProvenance.push(
          ...fallback.provenance.map((row) => ({
            ...row,
            status: "degraded" as const,
            note: `${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`
          }))
        );
      }
    }

    if (successful.length === 0) {
      return {
        signals: fallback.signals,
        provenance: [...degradedProvenance, ...fallback.provenance],
        providerProfiles
      };
    }

    const merged = successful
      .map((result) => result.signals)
      .reduce((current, next) => mergeFamilySignals(family, current, next) as TSignals);
    const provenanceRows = successful.flatMap((result) => result.provenance ?? []);
    const penalizedSignals = applyProviderReliabilityPenalty(family, merged, providerProfiles) as TSignals;

    return {
      signals: penalizedSignals,
      provenance: [...provenanceRows, ...degradedProvenance],
      providerProfiles
    };
  }
}

function createDefaultProviders() {
  return {
    task: [new HeuristicTaskSignalProvider()],
    evidence: [new HeuristicEvidenceSignalProvider()],
    reasoning: [new HeuristicReasoningSignalProvider()],
    prediction: [new HeuristicPredictionSignalProvider()],
    action: [new HeuristicActionSignalProvider()],
    governance: [new HeuristicGovernanceSignalProvider()]
  };
}

function emptyProviders() {
  return {
    task: [],
    evidence: [],
    reasoning: [],
    prediction: [],
    action: [],
    governance: []
  };
}

function mergeFamilySignals(family: MetaSignalFamily, left: any, right: any) {
  switch (family) {
    case "task":
      return {
        task_novelty: Math.max(left.task_novelty, right.task_novelty),
        domain_familiarity: Math.min(left.domain_familiarity, right.domain_familiarity),
        historical_success_rate: Math.min(left.historical_success_rate, right.historical_success_rate),
        ood_score: Math.max(left.ood_score, right.ood_score),
        decomposition_depth: Math.max(left.decomposition_depth, right.decomposition_depth),
        goal_decomposition_depth: Math.max(left.goal_decomposition_depth, right.goal_decomposition_depth),
        unresolved_dependency_count: Math.max(left.unresolved_dependency_count, right.unresolved_dependency_count)
      };
    case "evidence":
      return {
        retrieval_coverage: Math.min(left.retrieval_coverage, right.retrieval_coverage),
        evidence_freshness: Math.min(left.evidence_freshness, right.evidence_freshness),
        evidence_agreement_score: Math.min(left.evidence_agreement_score, right.evidence_agreement_score),
        source_reliability_prior: Math.min(left.source_reliability_prior, right.source_reliability_prior),
        missing_critical_evidence_flags: Array.from(new Set([...left.missing_critical_evidence_flags, ...right.missing_critical_evidence_flags]))
      };
    case "reasoning":
      return {
        candidate_reasoning_divergence: Math.max(left.candidate_reasoning_divergence, right.candidate_reasoning_divergence),
        step_consistency: Math.min(left.step_consistency, right.step_consistency),
        contradiction_score: Math.max(left.contradiction_score, right.contradiction_score),
        assumption_count: Math.max(left.assumption_count, right.assumption_count),
        unsupported_leap_count: Math.max(left.unsupported_leap_count, right.unsupported_leap_count),
        self_consistency_margin: Math.min(left.self_consistency_margin, right.self_consistency_margin)
      };
    case "prediction":
      return {
        predicted_success_probability: Math.min(left.predicted_success_probability, right.predicted_success_probability),
        predicted_downside_severity: Math.max(left.predicted_downside_severity, right.predicted_downside_severity),
        uncertainty_decomposition: {
          epistemic: Math.max(left.uncertainty_decomposition.epistemic, right.uncertainty_decomposition.epistemic),
          aleatoric: Math.max(left.uncertainty_decomposition.aleatoric, right.uncertainty_decomposition.aleatoric),
          evidence_missing: Math.max(left.uncertainty_decomposition.evidence_missing, right.uncertainty_decomposition.evidence_missing),
          model_disagreement: Math.max(left.uncertainty_decomposition.model_disagreement, right.uncertainty_decomposition.model_disagreement),
          simulator_unreliability: Math.max(left.uncertainty_decomposition.simulator_unreliability, right.uncertainty_decomposition.simulator_unreliability),
          calibration_gap: Math.max(left.uncertainty_decomposition.calibration_gap, right.uncertainty_decomposition.calibration_gap)
        },
        simulator_confidence: Math.min(left.simulator_confidence, right.simulator_confidence),
        predictor_error_rate: Math.max(left.predictor_error_rate, right.predictor_error_rate),
        predictor_bucket_reliability: Math.min(left.predictor_bucket_reliability, right.predictor_bucket_reliability),
        predictor_calibration_bucket: worstCalibrationBucket(left.predictor_calibration_bucket, right.predictor_calibration_bucket),
        world_model_mismatch_score: Math.max(left.world_model_mismatch_score, right.world_model_mismatch_score)
      };
    case "action":
      return {
        tool_precondition_completeness: Math.min(left.tool_precondition_completeness, right.tool_precondition_completeness),
        schema_confidence: Math.min(left.schema_confidence, right.schema_confidence),
        side_effect_severity: Math.max(left.side_effect_severity, right.side_effect_severity),
        reversibility_score: Math.min(left.reversibility_score, right.reversibility_score),
        observability_after_action: Math.min(left.observability_after_action, right.observability_after_action),
        fallback_availability: Math.min(left.fallback_availability, right.fallback_availability)
      };
    case "governance":
      return {
        policy_warning_density: Math.max(left.policy_warning_density, right.policy_warning_density),
        budget_pressure: Math.max(left.budget_pressure, right.budget_pressure),
        remaining_recovery_options: Math.min(left.remaining_recovery_options, right.remaining_recovery_options),
        need_for_human_accountability: Math.max(left.need_for_human_accountability, right.need_for_human_accountability)
      };
  }
}

function getProviderProfile(
  store: MetaSignalProviderReliabilityStore | undefined,
  provider: string,
  family: MetaSignalFamily
) {
  return store?.getProfile({ provider, family }) ?? {
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

function applyProviderReliabilityPenalty(family: MetaSignalFamily, signals: any, profiles: MetaSignalProviderProfile[]) {
  if (profiles.length === 0) {
    return signals;
  }

  const reliabilityFloor = Math.min(...profiles.map((profile) => profile.reliability_score));
  const confidenceFloor = Math.min(...profiles.map((profile) => profile.confidence_score));
  const penalty = clamp01((1 - reliabilityFloor) * 0.15 + (1 - confidenceFloor) * 0.05);
  if (penalty <= 0) {
    return signals;
  }

  switch (family) {
    case "evidence":
      return {
        ...signals,
        source_reliability_prior: clamp01(signals.source_reliability_prior - penalty),
        evidence_agreement_score: clamp01(signals.evidence_agreement_score - penalty * 0.6)
      };
    case "reasoning":
      return {
        ...signals,
        step_consistency: clamp01(signals.step_consistency - penalty * 0.8),
        self_consistency_margin: clamp01(signals.self_consistency_margin - penalty),
        contradiction_score: clamp01(signals.contradiction_score + penalty * 0.4)
      };
    case "prediction":
      return {
        ...signals,
        predictor_bucket_reliability: clamp01(Math.min(signals.predictor_bucket_reliability, reliabilityFloor)),
        world_model_mismatch_score: clamp01(signals.world_model_mismatch_score + penalty * 0.5),
        uncertainty_decomposition: {
          ...signals.uncertainty_decomposition,
          calibration_gap: clamp01(signals.uncertainty_decomposition.calibration_gap + penalty)
        }
      };
    case "action":
      return {
        ...signals,
        schema_confidence: clamp01(signals.schema_confidence - penalty),
        tool_precondition_completeness: clamp01(signals.tool_precondition_completeness - penalty * 0.6)
      };
    case "governance":
      return {
        ...signals,
        remaining_recovery_options: clamp01(signals.remaining_recovery_options - penalty * 0.5)
      };
    default:
      return signals;
  }
}

function fallbackTaskSignals(input: MetaSignalInput, timestamp: string) {
  const provider = "task-provider-fallback";
  return {
    signals: {
      task_novelty: 0.7,
      domain_familiarity: 0.3,
      historical_success_rate: 0.45,
      ood_score: 0.65,
      decomposition_depth: 0,
      goal_decomposition_depth: 0,
      unresolved_dependency_count: 0
    },
    provenance: [
      provenance("task", "task_novelty", provider, "fallback", timestamp, "task provider missing"),
      provenance("task", "ood_score", provider, "fallback", timestamp, "task provider missing")
    ]
  };
}

function fallbackEvidenceSignals(input: MetaSignalInput, timestamp: string) {
  const provider = "evidence-provider-fallback";
  return {
    signals: {
      retrieval_coverage: 0.2,
      evidence_freshness: 0.3,
      evidence_agreement_score: 0.4,
      source_reliability_prior: 0.35,
      missing_critical_evidence_flags: ["missing_evidence_provider"]
    },
    provenance: [
      provenance("evidence", "retrieval_coverage", provider, "missing", timestamp, "evidence provider missing"),
      provenance("evidence", "evidence_freshness", provider, "fallback", timestamp, "evidence provider missing")
    ]
  };
}

function fallbackReasoningSignals(input: MetaSignalInput, timestamp: string) {
  const provider = "reasoning-provider-fallback";
  return {
    signals: {
      candidate_reasoning_divergence: 0.5,
      step_consistency: 0.45,
      contradiction_score: 0.4,
      assumption_count: 1,
      unsupported_leap_count: 1,
      self_consistency_margin: 0.4
    },
    provenance: [
      provenance("reasoning", "candidate_reasoning_divergence", provider, "fallback", timestamp, "reasoning provider missing"),
      provenance("reasoning", "contradiction_score", provider, "fallback", timestamp, "reasoning provider missing")
    ]
  };
}

function fallbackPredictionSignals(input: MetaSignalInput, timestamp: string) {
  const provider = "prediction-provider-fallback";
  return {
    signals: {
      predicted_success_probability: 0.35,
      predicted_downside_severity: 0.55,
      uncertainty_decomposition: {
        epistemic: 0.7,
        aleatoric: 0.5,
        evidence_missing: 0.6,
        model_disagreement: 0.7,
        simulator_unreliability: 0.7,
        calibration_gap: 0.65
      },
      simulator_confidence: 0.25,
      predictor_error_rate: 0.6,
      predictor_bucket_reliability: 0.3,
      predictor_calibration_bucket: "poor",
      world_model_mismatch_score: 0.6
    },
    provenance: [
      provenance("prediction", "predictor_error_rate", provider, "missing", timestamp, "prediction provider missing"),
      provenance("prediction", "predictor_bucket_reliability", provider, "fallback", timestamp, "prediction provider missing")
    ]
  };
}

function fallbackActionSignals(input: MetaSignalInput, timestamp: string) {
  const provider = "action-provider-fallback";
  return {
    signals: {
      tool_precondition_completeness: 0.4,
      schema_confidence: 0.45,
      side_effect_severity: 0.4,
      reversibility_score: 0.45,
      observability_after_action: 0.5,
      fallback_availability: 0.4
    },
    provenance: [
      provenance("action", "tool_precondition_completeness", provider, "fallback", timestamp, "action provider missing"),
      provenance("action", "schema_confidence", provider, "fallback", timestamp, "action provider missing")
    ]
  };
}

function fallbackGovernanceSignals(input: MetaSignalInput, timestamp: string) {
  const provider = "governance-provider-fallback";
  return {
    signals: {
      policy_warning_density: 0,
      budget_pressure: 0.4,
      remaining_recovery_options: 0.4,
      need_for_human_accountability: 0.5
    },
    provenance: [
      provenance("governance", "budget_pressure", provider, "fallback", timestamp, "governance provider missing"),
      provenance("governance", "need_for_human_accountability", provider, "fallback", timestamp, "governance provider missing")
    ]
  };
}

function worstCalibrationBucket(left: string, right: string) {
  const rank = (value: string) => (value === "poor" ? 2 : value === "mixed" ? 1 : 0);
  return rank(left) >= rank(right) ? left : right;
}
