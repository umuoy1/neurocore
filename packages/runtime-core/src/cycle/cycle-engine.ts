import { DefaultPolicyProvider } from "@neurocore/policy-core";
import type {
  AgentProfile,
  CandidateAction,
  ConversationMessage,
  ControlAllocator,
  FastMetaAssessment,
  Goal,
  MemoryDigest,
  MemoryProvider,
  MetaAssessment,
  MetaDecision,
  MetaDecisionV2,
  MetaSignalFrame,
  ModuleContext,
  Observation,
  PolicyProvider,
  Prediction,
  Predictor,
  Proposal,
  Reasoner,
  SelfEvaluationReport,
  CycleTraceRecord,
  SkillDigest,
  SkillProvider,
  TokenEstimator,
  RuntimeStatus,
  UserInput,
  WorldStateDigest,
  WorkspaceSnapshot,
  MetaSignalProviderReliabilityStore,
  ReflectionRule
} from "@neurocore/protocol";
import type { DeviceRegistry, PerceptionPipeline } from "@neurocore/device-core";
import type { WorldStateGraph } from "@neurocore/world-model";
import type { TaskDelegator, AgentRegistry } from "@neurocore/multi-agent";
import { GradedContextCompressor } from "../context/graded-compressor.js";
import { DefaultTokenEstimator } from "../context/token-estimator.js";
import { DefaultControlAllocator } from "../meta/control-allocator.js";
import { DeepEvaluator } from "../meta/deep-evaluator.js";
import { FastMonitor } from "../meta/fast-monitor.js";
import { toControlModeFromDecisionV2 } from "../meta/meta-decision.js";
import type { ReflectionLearner } from "../meta/reflection-learner.js";
import { MetaSignalBus } from "../meta/signal-bus.js";
import type { Calibrator } from "../meta/calibrator.js";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";
import { WorkspaceCoordinator } from "../workspace/workspace-coordinator.js";

export interface CycleExecutionInput {
  tenantId: string;
  session: ModuleContext["session"];
  profile: AgentProfile;
  input: UserInput;
  traceRecords?: CycleTraceRecord[];
  goals: Goal[];
  reasoner: Reasoner;
  metaController: ModuleContext["services"] extends never ? never : import("@neurocore/protocol").MetaController;
  policies?: PolicyProvider[];
  memoryProviders?: MemoryProvider[];
  predictors?: Predictor[];
  skillProviders?: SkillProvider[];
  tokenEstimator?: TokenEstimator;
  predictionErrorRate?: number;
  calibrator?: Calibrator;
  providerReliabilityStore?: MetaSignalProviderReliabilityStore;
  reflectionLearner?: ReflectionLearner;
  deviceRegistry?: DeviceRegistry;
  perceptionPipeline?: PerceptionPipeline;
  worldStateGraph?: WorldStateGraph;
  taskDelegator?: TaskDelegator;
  agentRegistry?: AgentRegistry;
  statusReporter?: (status: Omit<RuntimeStatus, "status_id" | "session_id" | "created_at">) => void;
}

export interface CycleExecutionResult {
  cycleId: string;
  workspace: WorkspaceSnapshot;
  proposals: Proposal[];
  actions: CandidateAction[];
  predictions: Prediction[];
  metaSignalFrame?: MetaSignalFrame;
  fastMetaAssessment?: FastMetaAssessment;
  metaAssessment?: MetaAssessment;
  metaDecisionV2?: MetaDecisionV2;
  selfEvaluationReport?: SelfEvaluationReport;
  appliedReflectionRule?: ReflectionRule;
  decision: MetaDecision;
  observation?: Observation;
}

export class CycleEngine {
  private readonly workspaceCoordinator = new WorkspaceCoordinator();
  private readonly metaSignalBus = new MetaSignalBus();
  private readonly fastMonitor = new FastMonitor();
  private readonly deepEvaluator = new DeepEvaluator();
  private readonly controlAllocator: ControlAllocator = new DefaultControlAllocator();

  public async run(input: CycleExecutionInput): Promise<CycleExecutionResult> {
    const cycleId = generateId("cyc");
    debugLog("cycle", "Starting cycle", {
      sessionId: input.session.session_id,
      cycleId,
      goalCount: input.goals.length,
      inputChars: input.input.content.length
    });
    try {
    const services = {
      now: nowIso,
      generateId
    };
    const configuredPolicies = input.policies ?? [new DefaultPolicyProvider()];
    input.statusReporter?.({
      cycle_id: cycleId,
      phase: "memory_retrieval",
      state: "started",
      summary: "Retrieving memory context"
    });
    const baseContext: ModuleContext = {
      tenant_id: input.tenantId,
      session: { ...input.session, current_cycle_id: cycleId, state: "running" },
      profile: input.profile,
      goals: input.goals,
      runtime_state: {
        current_input_content: input.input.content,
        current_input_parts: input.input.content_parts ?? [],
        current_input_metadata: input.input.metadata ?? null,
        current_input_structured_response: input.input.structured_response ?? null,
        ...buildConversationRuntimeState(input.traceRecords ?? [], input.profile, input.input.content),
      },
      services,
      memory_config: input.profile.memory_config
    };

    let worldStateDigest: WorldStateDigest | undefined;
    if (input.deviceRegistry && input.perceptionPipeline && input.worldStateGraph) {
      try {
        const now = nowIso();
        const onlineSensors = input.deviceRegistry
          .query({ device_type: "sensor", status: "online" })
          .map((d) => d.device_id);

        if (onlineSensors.length > 0) {
          const readings = await Promise.all(
            onlineSensors.map((id) => {
              const sensor = input.deviceRegistry!.getSensor(id);
              return sensor ? sensor.read() : Promise.resolve(null);
            })
          );
          const validReadings = readings.filter((r) => r !== null);

          if (validReadings.length > 0) {
            const percepts = await input.perceptionPipeline.ingest(validReadings);
            input.worldStateGraph.decayConfidence(now);
            input.worldStateGraph.pruneExpired(now);
            if (percepts.length > 0) {
              input.worldStateGraph.applyPercepts(percepts);
            }
          }
        } else {
          input.worldStateGraph.decayConfidence(now);
          input.worldStateGraph.pruneExpired(now);
        }

        worldStateDigest = input.worldStateGraph.toDigest();
        debugLog("cycle", "Perceive phase completed", {
          sessionId: input.session.session_id,
          cycleId,
          worldStateDigest: worldStateDigest.summary
        });
      } catch (error) {
        debugLog("cycle", "Perceive phase failed", {
          sessionId: input.session.session_id,
          cycleId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const providerTimeoutMs = input.profile.runtime_config.module_provider_timeout_ms;
    const reasonerTimeoutMs =
      input.profile.runtime_config.reasoner_timeout_ms ??
      input.profile.runtime_config.default_sync_timeout_ms;
    const inputPolicies = await this.collectInputPolicyDecisions(
      baseContext,
      input.input,
      configuredPolicies,
      providerTimeoutMs
    );
    if (hasBlockingPolicyDecision(inputPolicies)) {
      const blockedWorkspace = this.workspaceCoordinator.buildSnapshot({
        sessionId: input.session.session_id,
        cycleId,
        contextSummary: input.input.content,
        goals: input.goals,
        proposals: [],
        candidateActions: [],
        budgetState: input.session.budget_state,
        memoryDigest: [],
        skillDigest: [],
        policyDecisions: inputPolicies,
        worldStateDigest
      });
      return {
        cycleId,
        workspace: blockedWorkspace,
        proposals: [],
        actions: [],
        predictions: [],
        decision: {
          decision_type: "abort",
          rejection_reasons: inputPolicies.map((decision) => decision.reason),
          explanation: "Input rejected by policy screening."
        }
      };
    }
    const memoryState = await this.collectMemoryState(baseContext, input.memoryProviders ?? [], providerTimeoutMs);
    input.statusReporter?.({
      cycle_id: cycleId,
      phase: "memory_retrieval",
      state: "completed",
      summary: "Memory retrieval completed",
      detail: `Loaded ${memoryState.digest.length} memory digests and ${memoryState.proposals.length} recall proposals.`,
      data: {
        digest_count: memoryState.digest.length,
        proposal_count: memoryState.proposals.length
      }
    });
    input.statusReporter?.({
      cycle_id: cycleId,
      phase: "reasoning",
      state: "started",
      summary: "Planning next step"
    });
    const skillState = await this.collectSkillState(baseContext, input.skillProviders ?? [], providerTimeoutMs);
    const enrichedContext: ModuleContext = {
      ...baseContext,
      runtime_state: {
        ...baseContext.runtime_state,
        memory_recall_proposals: memoryState.proposals,
        skill_match_proposals: skillState.proposals
      }
    };
    let reasonerProposals: Proposal[] = [];
    try {
      reasonerProposals = await withTimeout(
        input.reasoner.plan(enrichedContext),
        reasonerTimeoutMs,
        "reasoner.plan()"
      );
    } catch (error) {
      debugLog("cycle", "reasoner.plan() failed", {
        sessionId: input.session.session_id,
        cycleId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    let proposals = [...memoryState.proposals, ...skillState.proposals, ...reasonerProposals];
    debugLog("cycle", "Collected proposals", {
      sessionId: input.session.session_id,
      cycleId,
      memoryProposalCount: memoryState.proposals.length,
      memoryDigestCount: memoryState.digest.length,
      skillProposalCount: skillState.proposals.length,
      skillDigestCount: skillState.digest.length,
      reasonerProposalCount: reasonerProposals.length,
      totalProposalCount: proposals.length
    });
    let actions: CandidateAction[] = [];
    try {
      actions = await withTimeout(
        input.reasoner.respond(enrichedContext),
        reasonerTimeoutMs,
        "reasoner.respond()"
      );
    } catch (error) {
      debugLog("cycle", "reasoner.respond() failed", {
        sessionId: input.session.session_id,
        cycleId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    actions = [
      ...actions,
      ...synthesizeSkillActions(skillState.proposals, actions, enrichedContext)
    ];
    input.statusReporter?.({
      cycle_id: cycleId,
      phase: "reasoning",
      state: "completed",
      summary: "Reasoning pass completed",
      detail: `Prepared ${proposals.length} proposals and ${actions.length} candidate actions.`,
      data: {
        proposal_count: proposals.length,
        action_count: actions.length,
        skill_match_count: skillState.proposals.length
      }
    });
    debugLog("cycle", "Collected candidate actions", {
      sessionId: input.session.session_id,
      cycleId,
      actionCount: actions.length,
      actionTypes: actions.map((action) => action.action_type)
    });
    const predictions = await this.collectPredictions(enrichedContext, actions, input.predictors ?? [], providerTimeoutMs);
    const policies = await this.collectPolicyDecisions(
      enrichedContext,
      actions,
      configuredPolicies,
      providerTimeoutMs
    );
    const allPolicies = [...inputPolicies, ...policies];
    debugLog("cycle", "Collected predictions and policy decisions", {
      sessionId: input.session.session_id,
      cycleId,
      predictionCount: predictions.length,
      policyDecisionCount: policies.length
    });
    let workspace = this.workspaceCoordinator.buildSnapshot({
      sessionId: input.session.session_id,
      cycleId,
      contextSummary: input.input.content,
      goals: input.goals,
      proposals,
      candidateActions: actions,
      budgetState: input.session.budget_state,
      memoryDigest: memoryState.digest,
      skillDigest: skillState.digest,
      policyDecisions: allPolicies,
      worldStateDigest
    });

    const maxTokens = input.profile.context_budget?.max_context_tokens;
    const estimator = input.tokenEstimator ?? new DefaultTokenEstimator();
    if (maxTokens) {
      const totalTokens = estimator.estimate(JSON.stringify({ workspace, proposals }));
      if (totalTokens > maxTokens) {
        const compressor = new GradedContextCompressor();
        const result = compressor.compress(workspace, proposals, maxTokens, estimator);
        workspace = result.snapshot;
        proposals = result.proposals;
        debugLog("cycle", "Context compressed", {
          tokensSaved: result.tokensSaved,
          stages: result.stagesApplied
        });
      }
    }

    const inputTokens = estimator.estimate(JSON.stringify({ workspace, proposals }));
    input.session.budget_state.token_budget_used =
      (input.session.budget_state.token_budget_used ?? 0) + inputTokens;

    const costPerToken = input.profile.cost_per_token;
    if (costPerToken !== undefined && costPerToken > 0) {
      const cycleCost = inputTokens * costPerToken;
      input.session.budget_state.cost_budget_used = (input.session.budget_state.cost_budget_used ?? 0) + cycleCost;
      if (input.profile.cost_budget !== undefined) {
        input.session.budget_state.cost_budget_total = input.profile.cost_budget;
      }
    }

    const metaSignalFrame = this.metaSignalBus.collect({
      ctx: enrichedContext,
      workspace,
      actions,
      predictions,
      policies: allPolicies,
      predictionErrorRate: input.predictionErrorRate,
      goals: input.goals,
      providerReliabilityStore: input.providerReliabilityStore
    });
    const baseFastMetaAssessment = this.fastMonitor.assess(metaSignalFrame);
    const calibrationQuery = input.calibrator?.query({
      profile: input.profile,
      frame: metaSignalFrame,
      input: input.input,
      actions,
      predictions,
      metaState: baseFastMetaAssessment.meta_state
    });
    const predictorProfiles = input.calibrator?.queryPredictorProfiles({
      profile: input.profile,
      frame: metaSignalFrame,
      input: input.input,
      actions,
      predictions,
      metaState: baseFastMetaAssessment.meta_state
    }) ?? [];
    if (predictorProfiles.length > 0) {
      metaSignalFrame.prediction_signals.predictor_profiles = predictorProfiles;
      metaSignalFrame.prediction_signals.predictor_bucket_reliability = Math.min(
        metaSignalFrame.prediction_signals.predictor_bucket_reliability,
        ...predictorProfiles.map((profile) => profile.bucket_reliability)
      );
      metaSignalFrame.prediction_signals.predictor_calibration_bucket = worstPredictorCalibrationBucket(
        predictorProfiles.map((profile) => profile.bucket_reliability)
      );
    }
    const fastMetaAssessment = calibrationQuery
      ? {
          ...baseFastMetaAssessment,
          task_bucket: calibrationQuery.descriptor.taskBucket,
          bucket_reliability: calibrationQuery.stats.bucket_reliability
        }
      : baseFastMetaAssessment;
    const metaAssessment = fastMetaAssessment.trigger_deep_eval
      ? await this.deepEvaluator.evaluate({
          ctx: enrichedContext,
          workspace,
          frame: metaSignalFrame,
          fastAssessment: fastMetaAssessment,
          actions,
          predictions,
          policies,
          calibrator: input.calibrator,
          calibrationQuery
        })
      : this.fastMonitor.buildMetaAssessment({
          frame: metaSignalFrame,
          selectedMetaActions: fastMetaAssessment.recommended_control_actions,
          calibrator: input.calibrator,
          calibrationQuery
        });
    const appliedReflectionRule = calibrationQuery
      ? input.reflectionLearner?.findApplicableRule(
          calibrationQuery.descriptor.taskBucket,
          calibrationQuery.descriptor.riskLevel
        )
      : undefined;
    if (appliedReflectionRule && appliedReflectionRule.strength >= 0.5) {
      metaAssessment.recommended_control_action = mergeConservativeControlAction(
        metaAssessment.recommended_control_action,
        appliedReflectionRule.recommended_control_action
      );
      metaAssessment.reflection_rule = appliedReflectionRule;
      metaAssessment.reflection_applied = true;
      metaAssessment.rationale = `${metaAssessment.rationale} Reflection rule applied: ${appliedReflectionRule.pattern}.`;
    }
    const annotatedWorkspace: WorkspaceSnapshot = {
      ...workspace,
      metacognitive_state: fastMetaAssessment,
      meta_signal_frame_ref: metaSignalFrame.frame_id,
      meta_assessment_ref: metaAssessment.assessment_id,
      self_evaluation_report_ref: `${metaSignalFrame.frame_id}_report`
    };

    const metaDecisionV2 = await this.controlAllocator.decide({
      ctx: {
        ...enrichedContext,
        workspace: annotatedWorkspace
      },
      actions,
      predictions,
      policies: allPolicies,
      workspace: annotatedWorkspace,
      budgetAssessment: annotatedWorkspace.budget_assessment,
      fastAssessment: fastMetaAssessment,
      metaAssessment,
      predictionErrorRate: input.predictionErrorRate
    });

    const decision = await input.metaController.evaluate(
      {
        ...enrichedContext,
        workspace: annotatedWorkspace,
        runtime_state: {
          ...enrichedContext.runtime_state,
          meta_signal_frame: metaSignalFrame,
          fast_meta_assessment: fastMetaAssessment,
          meta_assessment: metaAssessment,
          meta_decision_v2: metaDecisionV2
        }
      },
      actions,
      predictions,
      allPolicies,
      input.predictionErrorRate
    );
    const selfEvaluationReport = this.fastMonitor.buildSelfEvaluationReport({
      frame: metaSignalFrame,
      selectedMetaActions: [metaDecisionV2.control_action],
      selectedControlMode: toControlModeFromDecisionV2(metaDecisionV2),
      verificationTrace: metaAssessment.verification_trace
    });
    debugLog("cycle", "Meta decision completed", {
      sessionId: input.session.session_id,
      cycleId,
      decisionType: decision.decision_type,
      selectedActionId: decision.selected_action_id,
      requiresHumanApproval: decision.requires_human_approval ?? false
    });

    return {
      cycleId,
      workspace: {
        ...annotatedWorkspace,
        self_evaluation_report_ref: selfEvaluationReport.report_id
      },
      proposals,
      actions,
      predictions,
      metaSignalFrame,
      fastMetaAssessment,
      metaAssessment,
      metaDecisionV2,
      selfEvaluationReport,
      appliedReflectionRule,
      decision
    };
    } catch (error) {
      debugLog("cycle", "Cycle failed with unhandled error", {
        sessionId: input.session.session_id,
        cycleId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async collectMemoryState(
    ctx: ModuleContext,
    providers: MemoryProvider[],
    timeoutMs?: number
  ): Promise<{ proposals: Proposal[]; digest: MemoryDigest[] }> {
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const [proposals, digest] = await withTimeout(
          Promise.all([
            provider.retrieve(ctx),
            provider.getDigest ? provider.getDigest(ctx) : Promise.resolve([])
          ]),
          timeoutMs,
          `MemoryProvider ${provider.name}`
        );
        return {
          providerName: provider.name,
          proposals,
          digest
        };
      })
    );

    const results = settled.filter((r): r is PromiseFulfilledResult<{ providerName: string; proposals: Proposal[]; digest: MemoryDigest[] }> => {
      if (r.status === "rejected") {
        debugLog("cycle", "MemoryProvider failed", {
          sessionId: ctx.session.session_id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        });
        return false;
      }
      return true;
    }).map(r => r.value);

    debugLog("cycle", "Collected provider memory state", {
      sessionId: ctx.session.session_id,
      cycleId: ctx.session.current_cycle_id,
      providers: results.map((result) => ({
        provider: result.providerName,
        proposalCount: result.proposals.length,
        digestCount: result.digest.length
      }))
    });

    return {
      proposals: results.flatMap((result) =>
        result.proposals.filter((proposal) => proposal.proposal_type === "memory_recall")
      ),
      digest: results
        .flatMap((result) => result.digest)
        .sort((left, right) => right.relevance - left.relevance)
    };
  }

  private async collectPredictions(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictors: Predictor[],
    timeoutMs?: number
  ): Promise<Prediction[]> {
    const settled = await Promise.allSettled(
      actions.flatMap((action) => predictors.map(async (predictor) =>
        withTimeout(
          predictor.predict(ctx, action),
          timeoutMs,
          `Predictor ${predictor.name}`
        )
      ))
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<Prediction | null> => {
        if (r.status === "rejected") {
          debugLog("cycle", "Predictor failed", {
            sessionId: ctx.session.session_id,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason)
          });
          return false;
        }
        return true;
      })
      .map(r => r.value)
      .filter((prediction): prediction is Prediction => prediction !== null);
  }

  private async collectSkillState(
    ctx: ModuleContext,
    providers: SkillProvider[],
    timeoutMs?: number
  ): Promise<{ proposals: Proposal[]; digest: SkillDigest[] }> {
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const proposals = await withTimeout(
          provider.match(ctx),
          timeoutMs,
          `SkillProvider ${provider.name}`
        );
        return {
          providerName: provider.name,
          proposals,
          digest: proposals
            .filter((proposal) => proposal.proposal_type === "skill_match")
            .map((proposal) => toSkillDigest(provider.name, proposal))
        };
      })
    );

    const results = settled.filter((r): r is PromiseFulfilledResult<{ providerName: string; proposals: Proposal[]; digest: SkillDigest[] }> => {
      if (r.status === "rejected") {
        debugLog("cycle", "SkillProvider failed", {
          sessionId: ctx.session.session_id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        });
        return false;
      }
      return true;
    }).map(r => r.value);

    debugLog("cycle", "Collected skill matches", {
      sessionId: ctx.session.session_id,
      cycleId: ctx.session.current_cycle_id,
      providers: results.map((result) => ({
        provider: result.providerName,
        proposalCount: result.proposals.length,
        digestCount: result.digest.length
      }))
    });

    return {
      proposals: results.flatMap((result) => result.proposals),
      digest: results
        .flatMap((result) => result.digest)
        .sort((left, right) => right.relevance - left.relevance)
    };
  }

  private async collectPolicyDecisions(
    ctx: ModuleContext,
    actions: CandidateAction[],
    policies: PolicyProvider[],
    timeoutMs?: number
  ) {
    const settled = await Promise.allSettled(
      actions.flatMap((action) => policies.map(async (policy) =>
        withTimeout(
          policy.evaluateAction(ctx, action),
          timeoutMs,
          `PolicyProvider ${policy.name}`
        )
      ))
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<import("@neurocore/protocol").PolicyDecision[]> => {
        if (r.status === "rejected") {
          debugLog("cycle", "PolicyProvider failed", {
            sessionId: ctx.session.session_id,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason)
          });
          return false;
        }
        return true;
      })
      .map(r => r.value)
      .flat();
  }

  private async collectInputPolicyDecisions(
    ctx: ModuleContext,
    userInput: UserInput,
    policies: PolicyProvider[],
    timeoutMs?: number
  ) {
    const settled = await Promise.allSettled(
      policies
        .filter((policy) => typeof policy.evaluateInput === "function")
        .map(async (policy) =>
          withTimeout(
            policy.evaluateInput!(ctx, userInput),
            timeoutMs,
            `PolicyProvider ${policy.name} input screening`
          )
        )
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<import("@neurocore/protocol").PolicyDecision[]> => {
        if (r.status === "rejected") {
          debugLog("cycle", "Input PolicyProvider failed", {
            sessionId: ctx.session.session_id,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason)
          });
          return false;
        }
        return true;
      })
      .map((r) => r.value)
      .flat();
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]);
}

function worstPredictorCalibrationBucket(reliabilities: number[]) {
  const floor = reliabilities.length > 0 ? Math.min(...reliabilities) : 0.5;
  if (floor < 0.35) {
    return "poor";
  }
  if (floor < 0.6) {
    return "mixed";
  }
  return "stable";
}

function mergeConservativeControlAction(
  current: import("@neurocore/protocol").MetaControlAction,
  reflected: import("@neurocore/protocol").MetaControlAction
) {
  const order: Record<import("@neurocore/protocol").MetaControlAction, number> = {
    "execute-now": 0,
    "run-more-samples": 1,
    "invoke-verifier": 2,
    "replan": 3,
    "decompose-goal": 3,
    "request-more-evidence": 4,
    "switch-to-safe-response": 5,
    "execute-with-approval": 6,
    "ask-human": 7,
    "abort": 8
  };
  return order[reflected] > order[current] ? reflected : current;
}

function hasBlockingPolicyDecision(
  decisions: import("@neurocore/protocol").PolicyDecision[]
): boolean {
  return decisions.some((decision) => decision.level === "block" || decision.severity >= 30);
}

function buildConversationRuntimeState(
  traceRecords: CycleTraceRecord[],
  profile: AgentProfile,
  currentInputContent: string
): Record<string, unknown> {
  const history = flattenConversationHistory(traceRecords);
  const maxContextTokens = profile.context_budget?.max_context_tokens;
  const historyBudgetTokens = typeof maxContextTokens === "number" && maxContextTokens > 0
    ? Math.max(32, Math.floor(maxContextTokens * 0.35))
    : 256;
  const trimmed = trimConversationHistory(history, historyBudgetTokens);
  return {
    conversation_history: trimmed.messages,
    conversation_summary: trimmed.summary,
    conversation_history_tokens: trimmed.tokens,
    conversation_history_truncated: trimmed.truncated,
    conversation_current_input_tokens: new DefaultTokenEstimator().estimate(currentInputContent)
  };
}

function flattenConversationHistory(traceRecords: CycleTraceRecord[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const record of traceRecords) {
    for (const input of record.inputs) {
      messages.push({
        role: "user",
        content: input.content,
        created_at: input.created_at,
        cycle_id: record.trace.cycle_id,
        source_id: input.input_id
      });
    }
    if (
      record.selected_action &&
      (record.selected_action.action_type === "respond" || record.selected_action.action_type === "ask_user") &&
      record.observation?.source_type === "runtime" &&
      typeof record.observation.summary === "string" &&
      record.observation.summary.length > 0
    ) {
      messages.push({
        role: "assistant",
        content: record.observation.summary,
        created_at: record.observation.created_at,
        cycle_id: record.trace.cycle_id,
        source_id: record.observation.observation_id
      });
    }
  }
  return messages;
}

function trimConversationHistory(
  history: ConversationMessage[],
  maxTokens: number
): { messages: ConversationMessage[]; summary?: string; tokens: number; truncated: boolean } {
  const estimator = new DefaultTokenEstimator();
  let totalTokens = 0;
  const selected: ConversationMessage[] = [];
  let truncated = false;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const messageTokens = estimator.estimate(message.content);
    if (selected.length > 0 && totalTokens + messageTokens > maxTokens) {
      truncated = true;
      break;
    }
    if (selected.length === 0 && messageTokens > maxTokens) {
      selected.unshift(message);
      totalTokens = messageTokens;
      truncated = history.length > 1;
      break;
    }
    selected.unshift(message);
    totalTokens += messageTokens;
  }

  return {
    messages: selected,
    summary: truncated ? summarizeConversationHistory(history.slice(0, Math.max(0, history.length - selected.length))) : undefined,
    tokens: totalTokens,
    truncated
  };
}

function summarizeConversationHistory(history: ConversationMessage[]): string | undefined {
  if (history.length === 0) {
    return undefined;
  }

  const recent = history.slice(-6).map((message) => {
    const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
    const content = message.content.trim().replace(/\s+/g, " ");
    return `${role}: ${content.slice(0, 120)}`;
  });

  return `Earlier conversation summary (${history.length} messages): ${recent.join(" | ")}`;
}

function toSkillDigest(providerName: string, proposal: Proposal): SkillDigest {
  const skillId =
    typeof proposal.payload.skill_id === "string" && proposal.payload.skill_id.trim().length > 0
      ? proposal.payload.skill_id
      : proposal.proposal_id;
  const name =
    typeof proposal.payload.skill_name === "string" && proposal.payload.skill_name.trim().length > 0
      ? proposal.payload.skill_name
      : providerName;

  return {
    skill_id: skillId,
    name,
    relevance: proposal.salience_score
  };
}

function synthesizeSkillActions(
  proposals: Proposal[],
  existingActions: CandidateAction[],
  ctx: ModuleContext
): CandidateAction[] {
  const next: CandidateAction[] = [];

  for (const proposal of proposals) {
    if (proposal.proposal_type !== "skill_match") {
      continue;
    }

    const sourceProposalId = proposal.proposal_id;
    if (
      existingActions.some((action) => action.source_proposal_id === sourceProposalId) ||
      next.some((action) => action.source_proposal_id === sourceProposalId)
    ) {
      continue;
    }

    const action = toSkillCandidateAction(proposal, ctx);
    if (action) {
      next.push(action);
    }
  }

  return next;
}

function toSkillCandidateAction(
  proposal: Proposal,
  ctx: ModuleContext
): CandidateAction | null {
  const executionTemplate =
    proposal.payload.execution_template &&
    typeof proposal.payload.execution_template === "object"
      ? (proposal.payload.execution_template as Record<string, unknown>)
      : undefined;
  const kind = executionTemplate?.kind;
  const steps = Array.isArray(executionTemplate?.steps)
    ? executionTemplate.steps.filter((step): step is string => typeof step === "string")
    : [];
  const title =
    typeof proposal.payload.skill_name === "string" && proposal.payload.skill_name.trim().length > 0
      ? proposal.payload.skill_name
      : typeof proposal.payload.name === "string" && proposal.payload.name.trim().length > 0
        ? proposal.payload.name
        : "Apply matched skill";
  const description = steps[0] ?? proposal.explanation ?? title;
  const sourceProposalId = proposal.proposal_id;
  const sideEffectLevel = toActionSideEffectLevel(proposal.payload.risk_level);

  if (kind === "toolchain") {
    const toolName = readSkillToolName(proposal, steps);
    if (!toolName) {
      return null;
    }

    return {
      action_id: ctx.services.generateId("act"),
      action_type: "call_tool",
      title,
      description,
      tool_name: toolName,
      tool_args: readSkillToolArgs(proposal, ctx),
      side_effect_level: sideEffectLevel,
      source_proposal_id: sourceProposalId
    };
  }

  if (kind === "reasoning" || kind === "workflow") {
    return {
      action_id: ctx.services.generateId("act"),
      action_type: "respond",
      title,
      description,
      side_effect_level: sideEffectLevel ?? "none",
      source_proposal_id: sourceProposalId
    };
  }

  return null;
}

function readSkillToolName(proposal: Proposal, steps: string[]): string | undefined {
  if (typeof proposal.payload.tool_name === "string" && proposal.payload.tool_name.trim().length > 0) {
    return proposal.payload.tool_name;
  }

  const firstStep = steps[0];
  if (!firstStep) {
    return undefined;
  }

  const match = firstStep.match(/call tool:\s*([a-z0-9_\-]+)/i);
  return match?.[1];
}

function readSkillToolArgs(
  proposal: Proposal,
  ctx: ModuleContext
): Record<string, unknown> | undefined {
  const templateArgs = readTemplateDefaultArgs(proposal);
  const inputMetadata =
    ctx.runtime_state.current_input_metadata &&
    typeof ctx.runtime_state.current_input_metadata === "object"
      ? (ctx.runtime_state.current_input_metadata as Record<string, unknown>)
      : undefined;

  if (
    inputMetadata?.sourceToolArgs &&
    typeof inputMetadata.sourceToolArgs === "object" &&
    !Array.isArray(inputMetadata.sourceToolArgs)
  ) {
    return {
      ...(templateArgs ?? {}),
      ...(structuredClone(inputMetadata.sourceToolArgs as Record<string, unknown>))
    };
  }

  if (
    inputMetadata?.tool_args &&
    typeof inputMetadata.tool_args === "object" &&
    !Array.isArray(inputMetadata.tool_args)
  ) {
    return {
      ...(templateArgs ?? {}),
      ...(structuredClone(inputMetadata.tool_args as Record<string, unknown>))
    };
  }

  return templateArgs;
}

function readTemplateDefaultArgs(proposal: Proposal): Record<string, unknown> | undefined {
  const template =
    proposal.payload.execution_template &&
    typeof proposal.payload.execution_template === "object"
      ? (proposal.payload.execution_template as Record<string, unknown>)
      : undefined;

  if (
    template?.default_args &&
    typeof template.default_args === "object" &&
    !Array.isArray(template.default_args)
  ) {
    return structuredClone(template.default_args as Record<string, unknown>);
  }

  if (
    proposal.payload.default_tool_args &&
    typeof proposal.payload.default_tool_args === "object" &&
    !Array.isArray(proposal.payload.default_tool_args)
  ) {
    return structuredClone(proposal.payload.default_tool_args as Record<string, unknown>);
  }

  return undefined;
}

function toActionSideEffectLevel(
  riskLevel: unknown
): CandidateAction["side_effect_level"] | undefined {
  if (riskLevel === "medium" || riskLevel === "high" || riskLevel === "low") {
    return riskLevel;
  }
  return undefined;
}
