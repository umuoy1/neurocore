import type {
  ActionExecution,
  AgentProfile,
  AgentSession,
  AskUserField,
  AskUserPromptSchema,
  ApprovalRequest,
  AutonomousPlanner,
  AutonomyContinualLearner,
  AutonomyDecision,
  AutonomyPlanStore,
  AutonomyState,
  CalibrationRecord,
  CalibrationStore,
  CandidateAction,
  CheckpointStore,
  ConversationMessage,
  CycleTrace,
  CycleTraceRecord,
  CreateSessionCommand,
  Episode,
  Goal,
  HealthReport,
  IntrinsicMotivationEngine,
  ModuleContext,
  MemoryProvider,
  MemoryGovernanceEvent,
  MemoryLifecycleState,
  MetaController,
  NeuroCoreEvent,
  NeuroCoreEventType,
  MetaSignalProviderReliabilityStore,
  Observation,
  PendingApprovalContextSnapshot,
  PolicyProvider,
  Predictor,
  Prediction,
  PredictionError,
  PredictionStore,
  PolicyUpdateEvent,
  Proposal,
  RewardComputer,
  RewardStore,
  Reasoner,
  ReflectionRule,
  ReflectionStore,
  RuntimeOutput,
  RuntimeStatus,
  RuntimeSessionSnapshot,
  RuntimeStateStore,
  SelfGoalGenerator,
  SelfMonitor,
  SessionCheckpoint,
  SessionReplay,
  SessionState,
  SkillEvaluator,
  SkillSelection,
  SkillPolicy,
  SkillProvider,
  SkillPruneEvent,
  SkillStore,
  SkillTransferEvent,
  SkillTransferEngine,
  SuggestedGoal,
  TraceStore,
  ExplorationEvent,
  PlanFeedback,
  JsonValue,
  OnlineLearner,
  RecoveryRecommendation,
  TransferAdapter,
  UserInput,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import {
  DefaultAutonomousPlanner,
  DefaultSelfMonitor,
  InMemoryAutonomyPlanStore
} from "@neurocore/autonomy-core";
import {
  DefaultContinualLearner,
  DefaultGoalFilter,
  DefaultIntrinsicMotivationEngine,
  DefaultSelfGoalGenerator,
  DefaultTransferAdapter
} from "@neurocore/motivation-core";
import type {
  ActuatorCommand,
  ActuatorOrchestrator,
  DeviceRegistry,
  PerceptionPipeline,
  SensorFusionStrategy
} from "@neurocore/device-core";
import {
  type ActiveInferenceEvaluator,
  type ForwardSimulator,
  type WorldStateGraph,
  SimulationBasedPredictor
} from "@neurocore/world-model";
import type {
  TaskDelegator,
  AgentRegistry as MultiAgentRegistry,
  InterAgentBus,
  DistributedGoalManager,
  AgentLifecycleManager,
  SharedStateStore,
  CoordinationStrategy
} from "@neurocore/multi-agent";
import type {
  EpisodicMemoryPersistenceStore,
  WorkingMemoryPersistenceStore
} from "@neurocore/memory-core";
import { EpisodicMemoryProvider, SemanticMemoryProvider, WorkingMemoryProvider } from "@neurocore/memory-core";
import { InMemoryCheckpointStore } from "../checkpoint/in-memory-checkpoint-store.js";
import { DefaultTokenEstimator } from "../context/token-estimator.js";
import { SqliteCheckpointStore } from "../checkpoint/sqlite-checkpoint-store.js";
import { CycleEngine } from "../cycle/cycle-engine.js";
import { InMemoryEventBus } from "../events/in-memory-event-bus.js";
import { ToolGateway } from "../execution/tool-gateway.js";
import { GoalManager } from "../goal/goal-manager.js";
import { Calibrator } from "../meta/calibrator.js";
import { DefaultMetaController } from "../meta/meta-controller.js";
import { InMemoryCalibrationStore } from "../meta/in-memory-calibration-store.js";
import { InMemoryReflectionStore } from "../meta/in-memory-reflection-store.js";
import { InMemoryProviderReliabilityStore } from "../meta/in-memory-provider-reliability-store.js";
import { ReflectionLearner } from "../meta/reflection-learner.js";
import { SqliteCalibrationStore } from "../meta/sqlite-calibration-store.js";
import { SqliteReflectionStore } from "../meta/sqlite-reflection-store.js";
import { SqliteProviderReliabilityStore } from "../meta/sqlite-provider-reliability-store.js";
import { InMemoryPredictionStore } from "../prediction/in-memory-prediction-store.js";
import { computePredictionErrors } from "../prediction/prediction-error-computer.js";
import { ReplayRunner } from "../replay/replay-runner.js";
import { SessionManager, SessionStateConflictError } from "../session/session-manager.js";
import { BanditSkillPolicy } from "../skill/bandit-skill-policy.js";
import { InMemoryRewardStore } from "../skill/in-memory-reward-store.js";
import { InMemorySkillPolicyStateStore } from "../skill/in-memory-skill-policy-store.js";
import { SkillOnlineLearner } from "../skill/online-learner.js";
import { ProceduralMemoryProvider } from "../skill/procedural-memory-provider.js";
import { DefaultRewardComputer } from "../skill/reward-computer.js";
import { executeSkill } from "../skill/skill-executor.js";
import { DefaultSkillEvaluator } from "../skill/skill-evaluator.js";
import { DefaultSkillTransferEngine } from "../skill/skill-transfer-engine.js";
import { SqliteRewardStore } from "../skill/sqlite-reward-store.js";
import { SqliteSkillPolicyStateStore } from "../skill/sqlite-skill-policy-store.js";
import { InMemoryTraceStore } from "../trace/in-memory-trace-store.js";
import { TraceRecorder } from "../trace/trace-recorder.js";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";
import {
  createSqliteMemoryPersistence,
  type AgentMemoryPersistence
} from "../persistence/sqlite-memory-persistence.js";
import { SqliteRuntimeStateStore } from "../persistence/sqlite-runtime-state-store.js";

export interface AgentRuntimeOptions {
  reasoner: Reasoner;
  metaController?: MetaController;
  memoryProviders?: MemoryProvider[];
  predictors?: Predictor[];
  policyProviders?: PolicyProvider[];
  skillProviders?: SkillProvider[];
  skillStore?: SkillStore;
  traceStore?: TraceStore;
  checkpointStore?: CheckpointStore;
  stateStore?: RuntimeStateStore;
  memoryPersistence?: AgentMemoryPersistence;
  calibrationStore?: CalibrationStore;
  providerReliabilityStore?: MetaSignalProviderReliabilityStore;
  reflectionStore?: ReflectionStore;
  rewardStore?: RewardStore;
  rewardComputer?: RewardComputer;
  skillPolicy?: SkillPolicy;
  skillEvaluator?: SkillEvaluator;
  skillTransferEngine?: SkillTransferEngine;
  onlineLearner?: OnlineLearner;
  autonomousPlanner?: AutonomousPlanner;
  autonomyPlanStore?: AutonomyPlanStore;
  selfMonitor?: SelfMonitor;
  intrinsicMotivationEngine?: IntrinsicMotivationEngine;
  selfGoalGenerator?: SelfGoalGenerator;
  transferAdapter?: TransferAdapter;
  continualLearner?: AutonomyContinualLearner;
  predictionStore?: PredictionStore;
  deviceRegistry?: DeviceRegistry;
  worldStateGraph?: WorldStateGraph;
  perceptionPipeline?: PerceptionPipeline;
  sensorFusionStrategy?: SensorFusionStrategy;
  forwardSimulator?: ForwardSimulator;
  activeInferenceEvaluator?: ActiveInferenceEvaluator;
  actuatorOrchestrator?: ActuatorOrchestrator;
  agentRegistry?: MultiAgentRegistry;
  interAgentBus?: InterAgentBus;
  taskDelegator?: TaskDelegator;
  distributedGoalManager?: DistributedGoalManager;
  agentLifecycleManager?: AgentLifecycleManager;
  sharedStateStore?: SharedStateStore;
  coordinationStrategy?: CoordinationStrategy;
}

export interface AgentRunResult {
  sessionId: string;
  cycleId: string;
  sessionState: SessionState;
  approval?: ApprovalRequest;
  selectedAction?: CandidateAction;
  actionExecution?: ActionExecution;
  observation?: Observation;
  outputText?: string;
  trace: CycleTrace;
  cycle: Awaited<ReturnType<CycleEngine["run"]>>;
  predictionErrors?: PredictionError[];
  calibrationRecord?: CalibrationRecord;
  createdReflectionRule?: ReflectionRule;
}

export interface AgentRunLoopResult {
  sessionId: string;
  finalState: SessionState;
  steps: AgentRunResult[];
  traces: CycleTrace[];
  outputText?: string;
}

interface PendingApprovalContext {
  approval_id: string;
  cycle_id: string;
  input: UserInput;
  proposals: Proposal[];
  candidate_actions: CandidateAction[];
  predictions: Prediction[];
  workspace: WorkspaceSnapshot;
  selectedAction: CandidateAction;
  startedAt: string;
}

interface ExecutionCycleState {
  cycleId: string;
  proposals: Proposal[];
  memoryRetrievalPlan?: import("@neurocore/protocol").MemoryRetrievalPlan;
  memoryRecallBundle?: import("@neurocore/protocol").MemoryRecallBundle;
  actions: CandidateAction[];
  predictions: Prediction[];
  workspace: WorkspaceSnapshot;
  metaSignalFrame?: import("@neurocore/protocol").MetaSignalFrame;
  fastMetaAssessment?: import("@neurocore/protocol").FastMetaAssessment;
  metaAssessment?: import("@neurocore/protocol").MetaAssessment;
  metaDecisionV2?: import("@neurocore/protocol").MetaDecisionV2;
  selfEvaluationReport?: import("@neurocore/protocol").SelfEvaluationReport;
  appliedReflectionRule?: ReflectionRule;
}

interface ToolActionExecutionOutcome {
  action: CandidateAction;
  execution: ActionExecution;
  observation: Observation;
  predictionErrors: PredictionError[];
  calibrationRecord?: CalibrationRecord;
  createdReflectionRule?: ReflectionRule;
}

export class AgentRuntime {
  public readonly sessions = new SessionManager();
  public readonly goals = new GoalManager();
  public readonly tools = new ToolGateway();

  private readonly cycleEngine = new CycleEngine();
  private readonly eventBus = new InMemoryEventBus();
  private readonly workingMemoryProvider: WorkingMemoryProvider;
  private readonly episodicMemoryProvider: EpisodicMemoryProvider;
  private readonly semanticMemoryProvider: SemanticMemoryProvider;
  private readonly proceduralMemoryProvider: ProceduralMemoryProvider;
  private readonly memoryProviders: MemoryProvider[];
  private readonly predictors: Predictor[];
  private readonly policyProviders: PolicyProvider[];
  private readonly skillProviders: SkillProvider[];
  private readonly reasoner: Reasoner;
  private readonly metaController: MetaController;
  private readonly traceRecorder: TraceRecorder;
  private readonly replayRunner: ReplayRunner;
  private readonly providerReliabilityStore: MetaSignalProviderReliabilityStore;
  private readonly reflectionLearner: ReflectionLearner;
  private readonly checkpointStore: CheckpointStore;
  private readonly stateStore?: RuntimeStateStore;
  private readonly memoryPersistence?: AgentMemoryPersistence;
  private readonly predictionStore: PredictionStore;
  private readonly calibrator: Calibrator;
  private readonly rewardStore: RewardStore;
  private readonly rewardComputer: RewardComputer;
  private readonly skillPolicy: SkillPolicy;
  private readonly skillEvaluator: SkillEvaluator;
  private readonly onlineLearner: OnlineLearner;
  private readonly autonomousPlanner?: AutonomousPlanner;
  private readonly autonomyPlanStore: AutonomyPlanStore;
  private readonly selfMonitor: SelfMonitor;
  private readonly intrinsicMotivationEngine: IntrinsicMotivationEngine;
  private readonly selfGoalGenerator: SelfGoalGenerator;
  private readonly transferAdapter: TransferAdapter;
  private readonly continualLearner: AutonomyContinualLearner;
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly pendingApprovals = new Map<string, PendingApprovalContext>();
  private readonly eventSequences = new Map<string, number>();
  private readonly autonomyStates = new Map<string, AutonomyState>();
  private readonly deviceRegistry?: DeviceRegistry;
  private readonly worldStateGraph?: WorldStateGraph;
  private readonly perceptionPipeline?: PerceptionPipeline;
  private readonly sensorFusionStrategy?: SensorFusionStrategy;
  private readonly actuatorOrchestrator?: ActuatorOrchestrator;
  private readonly taskDelegator?: TaskDelegator;
  private readonly agentRegistry?: MultiAgentRegistry;

  public constructor(options: AgentRuntimeOptions) {
    const derivedPersistence = deriveSqlitePersistenceFromStateStore(
      options.stateStore,
      options.memoryPersistence,
      options.checkpointStore,
      options.calibrationStore,
      options.providerReliabilityStore,
      options.reflectionStore,
      options.rewardStore
    );
    const memoryPersistence = options.memoryPersistence ?? derivedPersistence.memoryPersistence;
    const checkpointStore =
      options.checkpointStore ?? derivedPersistence.checkpointStore ?? new InMemoryCheckpointStore();
    const calibrationStore =
      options.calibrationStore ??
      derivedPersistence.calibrationStore ??
      new InMemoryCalibrationStore();
    const providerReliabilityStore =
      options.providerReliabilityStore ??
      derivedPersistence.providerReliabilityStore ??
      new InMemoryProviderReliabilityStore();
    const reflectionStore =
      options.reflectionStore ??
      derivedPersistence.reflectionStore ??
      new InMemoryReflectionStore();
    const rewardStore =
      options.rewardStore ??
      derivedPersistence.rewardStore ??
      new InMemoryRewardStore();
    this.reasoner = options.reasoner;
    this.metaController = options.metaController ?? new DefaultMetaController();
    const traceStore = options.traceStore ?? new InMemoryTraceStore();
    this.checkpointStore = checkpointStore;
    this.stateStore = options.stateStore;
    this.memoryPersistence = memoryPersistence;
    this.predictionStore = options.predictionStore ?? new InMemoryPredictionStore();
    this.calibrator = new Calibrator(calibrationStore);
    this.providerReliabilityStore = providerReliabilityStore;
    this.reflectionLearner = new ReflectionLearner(reflectionStore);
    this.rewardStore = rewardStore;
    this.rewardComputer = options.rewardComputer ?? new DefaultRewardComputer();
    this.skillPolicy =
      options.skillPolicy ??
      new BanditSkillPolicy(
        derivedPersistence.skillPolicyStateStore ?? new InMemorySkillPolicyStateStore()
      );
    this.skillEvaluator = options.skillEvaluator ?? new DefaultSkillEvaluator();
    this.onlineLearner =
      options.onlineLearner ??
      new SkillOnlineLearner({
        policy: this.skillPolicy
      });
    this.autonomousPlanner = options.autonomousPlanner ?? new DefaultAutonomousPlanner();
    this.autonomyPlanStore = options.autonomyPlanStore ?? new InMemoryAutonomyPlanStore();
    this.selfMonitor = options.selfMonitor ?? new DefaultSelfMonitor();
    this.intrinsicMotivationEngine =
      options.intrinsicMotivationEngine ?? new DefaultIntrinsicMotivationEngine();
    this.selfGoalGenerator = options.selfGoalGenerator ?? new DefaultSelfGoalGenerator();
    this.transferAdapter = options.transferAdapter ?? new DefaultTransferAdapter();
    this.continualLearner = options.continualLearner ?? new DefaultContinualLearner();
    this.workingMemoryProvider = new WorkingMemoryProvider(
      undefined,
      memoryPersistence?.working as WorkingMemoryPersistenceStore | undefined
    );
    this.episodicMemoryProvider = new EpisodicMemoryProvider(
      undefined,
      memoryPersistence?.episodic as EpisodicMemoryPersistenceStore | undefined
    );
    this.semanticMemoryProvider = new SemanticMemoryProvider(
      memoryPersistence?.semantic
    );
    this.traceRecorder = new TraceRecorder(traceStore);
    this.replayRunner = new ReplayRunner(traceStore);
    this.proceduralMemoryProvider = new ProceduralMemoryProvider(
      options.skillStore ?? memoryPersistence?.skillStore,
      3,
      this.skillPolicy,
      this.skillEvaluator,
      options.skillTransferEngine ?? new DefaultSkillTransferEngine()
    );
    this.memoryProviders = [
      this.workingMemoryProvider,
      this.episodicMemoryProvider,
      this.semanticMemoryProvider,
      this.proceduralMemoryProvider,
      ...(options.memoryProviders ?? [])
    ];
    this.predictors = options.predictors ?? [];
    this.policyProviders = options.policyProviders ?? [];
    this.skillProviders = [this.proceduralMemoryProvider, ...(options.skillProviders ?? [])];
    this.deviceRegistry = options.deviceRegistry;
    this.worldStateGraph = options.worldStateGraph;
    this.perceptionPipeline = options.perceptionPipeline;
    this.sensorFusionStrategy = options.sensorFusionStrategy;
    this.actuatorOrchestrator = options.actuatorOrchestrator;
    this.taskDelegator = options.taskDelegator;
    this.agentRegistry = options.agentRegistry;
    if (options.forwardSimulator && options.worldStateGraph) {
      this.predictors = [
        ...this.predictors,
        new SimulationBasedPredictor(
          options.forwardSimulator,
          options.worldStateGraph,
          options.activeInferenceEvaluator
        )
      ];
    }
  }

  public createSession(profile: AgentProfile, command: CreateSessionCommand) {
    this.sessions.applyRuntimeConfig(profile.runtime_config);
    const session = this.sessions.create(profile, command);
    const rootGoal = this.goals.initializeRootGoal(session.session_id, command.initial_input);
    this.emitEvent(session, "session.created", session);
    this.emitGoalCreated(session, rootGoal);
    this.persistSessionState(session.session_id);
    debugLog("runtime", "Session created", {
      sessionId: session.session_id,
      agentId: profile.agent_id,
      tenantId: session.tenant_id,
      mode: session.session_mode
    });
    return session;
  }

  public async runOnce(profile: AgentProfile, sessionId: string, input: UserInput) {
    const releaseLock = await this.sessions.acquireSessionLock(sessionId);
    try {
      const result = await this.runOnceUnlocked(profile, sessionId, input);
      await this.performAutonomyMaintenance(profile, sessionId, input, result);
      return result;
    } finally {
      releaseLock();
    }
  }

  private async runOnceUnlocked(profile: AgentProfile, sessionId: string, input: UserInput) {
    this.sessions.applyRuntimeConfig(profile.runtime_config);
    const session = this.beginRun(sessionId);
    const startedAt = nowIso();
    const traceRecords = this.getTraceRecords(sessionId);

    debugLog("runtime", "Starting runOnce", {
      sessionId,
      agentId: profile.agent_id,
      inputChars: input.content.length
    });

    try {
    await this.decomposeGoals(profile, session, input);
    await this.ensureAutonomousPlan(profile, session, input);
    const activeGoals = this.goals.active(sessionId);

    const predictionErrorRate = this.predictionStore.getRecentErrorRate(sessionId, 5);

    const result = await this.cycleEngine.run({
      tenantId: session.tenant_id,
      session,
      profile,
      input,
      traceRecords,
      goals: activeGoals,
      memoryProviders: this.memoryProviders,
      predictors: this.predictors,
      policies: this.policyProviders,
      skillProviders: this.skillProviders,
      autonomyState: this.autonomyStates.get(sessionId),
      reasoner: this.reasoner,
      metaController: this.metaController,
      predictionErrorRate,
      calibrator: this.calibrator,
      providerReliabilityStore: this.providerReliabilityStore,
      reflectionLearner: this.reflectionLearner,
      statusReporter: (status) => {
        this.emitRuntimeStatus(session, status);
      },
      deviceRegistry: this.deviceRegistry,
      perceptionPipeline: this.perceptionPipeline,
      sensorFusionStrategy: this.sensorFusionStrategy,
      worldStateGraph: this.worldStateGraph,
      taskDelegator: this.taskDelegator,
      agentRegistry: this.agentRegistry
    });

    const autonomyState = this.autonomyStates.get(sessionId);
    if (autonomyState) {
      result.workspace = {
        ...result.workspace,
        autonomy_state: structuredClone(autonomyState)
      };
    }

    for (const prediction of result.predictions) {
      this.predictionStore.recordPrediction(prediction);
    }

    this.sessions.setCurrentCycle(sessionId, result.cycleId);
    const selectedAction = resolvePlannedActionSelection(
      result.actions,
      selectAction(result.actions, result.decision)
    );
    this.emitCycleStarted(session, result.cycleId, startedAt);
    if (result.memoryRetrievalPlan) {
      this.emitEvent(session, "memory.retrieval_planned", result.memoryRetrievalPlan, result.cycleId);
    }
    if (result.memoryRecallBundle) {
      this.emitEvent(session, "memory.retrieved", result.memoryRecallBundle, result.cycleId);
      for (const episode of result.memoryRecallBundle.episodic_episodes ?? []) {
        this.emitEvent(session, "memory.episode_activated", episode, result.cycleId);
      }
    }
    for (const proposal of result.proposals) {
      this.emitEvent(session, "proposal.submitted", proposal, result.cycleId);
      if (proposal.proposal_type === "skill_match" && typeof proposal.payload.skill_id === "string") {
        const skill = this.proceduralMemoryProvider.getStore().get(proposal.payload.skill_id);
        if (skill) {
          this.emitEvent(session, "skill.matched", skill, result.cycleId);
        }
      }
    }
    for (const prediction of result.predictions) {
      this.emitEvent(session, "prediction.recorded", prediction, result.cycleId);
    }
    const transferredSkill = this.proceduralMemoryProvider.getLastTransferResult();
    if (transferredSkill) {
      this.emitEvent(session, "skill.transferred", this.toSkillTransferEvent(session, transferredSkill), result.cycleId);
      this.proceduralMemoryProvider.clearLastTransferResult();
      this.proceduralMemoryProvider.clearLastTransferredSkill();
    }
    this.emitEvent(session, "workspace.committed", result.workspace, result.cycleId);
    if (selectedAction) {
      this.emitEvent(session, "action.selected", selectedAction, result.cycleId);
    }
    debugLog("runtime", "Selected action after cycle", {
      sessionId,
      cycleId: result.cycleId,
      selectedActionId: selectedAction?.action_id,
      selectedActionType: selectedAction?.action_type,
      decisionType: result.decision.decision_type
    });

    if (result.decision.decision_type === "abort") {
      const sessionState = this.updateSessionState(sessionId, "aborted").state;
      const trace = this.recordTrace({
        sessionId,
        cycleId: result.cycleId,
        input,
        proposals: result.proposals,
        candidateActions: result.actions,
        predictions: result.predictions,
        policyDecisions: result.workspace.policy_decisions ?? [],
        workspace: result.workspace,
        ...toMetaTraceFields(result),
        startedAt
      });
      this.markActionableGoals(sessionId, "cancelled");
      this.maybeCreateCheckpoint(profile, sessionId);
      this.persistSessionState(sessionId);

      return {
        sessionId,
        cycleId: result.cycleId,
        sessionState,
        outputText: formatAbortDecision(result.decision),
        trace,
        cycle: result
      };
    }

    if (!selectedAction) {
      const sessionState = this.updateSessionState(sessionId, "failed").state;
      const trace = this.recordTrace({
        sessionId,
        cycleId: result.cycleId,
        input,
        proposals: result.proposals,
        candidateActions: result.actions,
        predictions: result.predictions,
        policyDecisions: result.workspace.policy_decisions ?? [],
        workspace: result.workspace,
        ...toMetaTraceFields(result),
        startedAt
      });
      debugLog("runtime", "Run failed because no action was selected", {
        sessionId,
        cycleId: result.cycleId
      });
      this.markActionableGoals(sessionId, "failed");
      this.maybeCreateCheckpoint(profile, sessionId);
      this.persistSessionState(sessionId);
      return {
        sessionId,
        cycleId: result.cycleId,
        sessionState,
        outputText: "No action was selected by the runtime.",
        trace,
        cycle: result
      };
    }

    if (result.decision.decision_type === "request_approval") {
      if (profile.runtime_config.auto_approve) {
        this.emitRuntimeStatus(session, {
          cycle_id: result.cycleId,
          phase: "approval",
          state: "completed",
          summary: "Approval auto-approved",
          detail:
            result.decision.risk_summary ??
            result.decision.explanation ??
            selectedAction.title,
          data: {
            action_id: selectedAction.action_id,
            action_type: selectedAction.action_type,
            tool_name: selectedAction.tool_name,
            auto_approved: true
          }
        });
        return this.executeSelectedAction(profile, session, input, startedAt, toExecutionCycleState(result), selectedAction);
      }
      this.emitRuntimeStatus(session, {
        cycle_id: result.cycleId,
        phase: "approval",
        state: "started",
        summary: "Waiting for human approval",
        detail:
          result.decision.risk_summary ??
          result.decision.explanation ??
          selectedAction.title,
        data: {
          action_id: selectedAction.action_id,
          action_type: selectedAction.action_type,
          tool_name: selectedAction.tool_name
        }
      });
      const approval = this.createPendingApproval({
        session,
        input,
        cycle: toExecutionCycleState(result),
        reviewReason:
          result.decision.risk_summary ??
          result.decision.explanation ??
          "Action requires human approval before execution.",
        selectedAction,
        startedAt
      });
      const sessionState = this.updateSessionState(sessionId, "escalated").state;
      const trace = this.recordTrace({
        sessionId,
        cycleId: result.cycleId,
        input,
        proposals: result.proposals,
        candidateActions: result.actions,
        predictions: result.predictions,
        policyDecisions: result.workspace.policy_decisions ?? [],
        selectedAction,
        selectedActionId: selectedAction.action_id,
        workspace: result.workspace,
        ...toMetaTraceFields(result),
        startedAt
      });
      debugLog("runtime", "Run escalated for approval", {
        sessionId,
        cycleId: result.cycleId,
        actionId: selectedAction.action_id
      });
      this.maybeCreateCheckpoint(profile, sessionId);
      this.persistSessionState(sessionId);
      return {
        sessionId,
        cycleId: result.cycleId,
        sessionState,
        approval,
        selectedAction,
        outputText: selectedAction.title,
        trace,
        cycle: result
      };
    }

    return this.executeSelectedAction(profile, session, input, startedAt, toExecutionCycleState(result), selectedAction);
    } catch (error) {
      debugLog("runtime", "runOnce failed with unhandled error", {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.updateSessionState(sessionId, "failed");
      this.markActionableGoals(sessionId, "failed");
      this.persistSessionState(sessionId);
      throw error;
    }
  }

  public async runUntilSettled(
    profile: AgentProfile,
    sessionId: string,
    initialInput: UserInput,
    options?: { maxSteps?: number }
  ): Promise<AgentRunLoopResult> {
    const releaseLock = await this.sessions.acquireSessionLock(sessionId);
    try {
      return await this.runUntilSettledUnlocked(profile, sessionId, initialInput, options);
    } finally {
      releaseLock();
    }
  }

  private async runUntilSettledUnlocked(
    profile: AgentProfile,
    sessionId: string,
    initialInput: UserInput,
    options?: { maxSteps?: number }
  ): Promise<AgentRunLoopResult> {
    this.sessions.applyRuntimeConfig(profile.runtime_config);
    const maxSteps = options?.maxSteps ?? profile.runtime_config.max_cycles;
    const steps: AgentRunResult[] = [];
    let currentInput = initialInput;

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      debugLog("runtime", "runUntilSettled iteration", {
        sessionId,
        stepIndex: stepIndex + 1,
        maxSteps
      });

      const step = await this.runOnceUnlocked(profile, sessionId, currentInput);
      await this.performAutonomyMaintenance(profile, sessionId, currentInput, step);
      steps.push(step);

      if (!shouldContinue(step)) {
        return {
          sessionId,
          finalState: step.sessionState,
          steps,
          traces: this.getTraces(sessionId),
          outputText: step.outputText
        };
      }

      currentInput = observationToInput(step.observation, step.selectedAction?.action_type);
    }

    const finalSession = this.updateSessionState(sessionId, "failed");
    this.markActionableGoals(sessionId, "failed");
    this.persistSessionState(sessionId);
    debugLog("runtime", "runUntilSettled exhausted max steps", {
      sessionId,
      maxSteps
    });

    return {
      sessionId,
      finalState: finalSession.state,
      steps,
      traces: this.getTraces(sessionId),
      outputText: steps.at(-1)?.outputText
    };
  }

  public getTraces(sessionId: string): CycleTrace[] {
    this.requireSession(sessionId);
    return this.traceRecorder.list(sessionId);
  }

  public getSession(sessionId: string): AgentSession | undefined {
    this.ensureSessionLoaded(sessionId);
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  public listKnownSessions(): AgentSession[] {
    const sessions = new Map<string, AgentSession>();
    for (const session of this.sessions.list()) {
      sessions.set(session.session_id, structuredClone(session));
    }
    for (const snapshot of this.stateStore?.listSessions() ?? []) {
      if (!sessions.has(snapshot.session.session_id)) {
        sessions.set(snapshot.session.session_id, structuredClone(snapshot.session));
      }
    }
    return [...sessions.values()];
  }

  public getSkillProvider(): ProceduralMemoryProvider {
    return this.proceduralMemoryProvider;
  }

  public getSemanticMemoryProvider(): SemanticMemoryProvider {
    return this.semanticMemoryProvider;
  }

  public getWorkingMemory(sessionId: string) {
    this.requireSession(sessionId);
    return structuredClone(this.workingMemoryProvider.list(sessionId));
  }

  public listSemanticMemory(sessionId: string) {
    this.requireSession(sessionId);
    const session = this.sessions.get(sessionId);
    return session
      ? this.semanticMemoryProvider.list(session.tenant_id)
      : [];
  }

  public listSemanticCards(sessionId: string) {
    this.requireSession(sessionId);
    const session = this.sessions.get(sessionId);
    return session
      ? structuredClone(this.semanticMemoryProvider.listCards(session.tenant_id))
      : [];
  }

  public listSkills(sessionId: string) {
    this.requireSession(sessionId);
    const session = this.sessions.get(sessionId);
    return session
      ? structuredClone(this.proceduralMemoryProvider.listSkills(session.tenant_id))
      : [];
  }

  public listSkillSpecs(sessionId: string) {
    this.requireSession(sessionId);
    const session = this.sessions.get(sessionId);
    return session
      ? structuredClone(this.proceduralMemoryProvider.listSkillSpecs(session.tenant_id))
      : [];
  }

  public getWorldState() {
    return this.worldStateGraph?.snapshot();
  }

  public getAutonomyState(sessionId: string): AutonomyState | undefined {
    this.ensureSessionLoaded(sessionId);
    const state = this.autonomyStates.get(sessionId);
    return state ? structuredClone(state) : undefined;
  }

  public setAutonomyState(sessionId: string, state: AutonomyState | undefined): void {
    this.requireSession(sessionId);
    this.replaceAutonomyState(sessionId, state);
    this.persistSessionState(sessionId);
  }

  public listAutonomousPlans(sessionId: string) {
    this.ensureSessionLoaded(sessionId);
    return this.autonomyPlanStore.list(sessionId);
  }

  public listDevices() {
    return this.deviceRegistry?.listAll().map((device) => structuredClone(device)) ?? [];
  }

  public async listDelegations(sessionId?: string) {
    const records = await this.taskDelegator?.listStatuses?.();
    if (!records) {
      return [];
    }
    return structuredClone(
      sessionId
        ? records.filter((record) => record.source_session_id === sessionId)
        : records
    );
  }

  public listGoals(sessionId: string): Goal[] {
    this.requireSession(sessionId);
    return structuredClone(this.goals.list(sessionId));
  }

  public getTraceRecords(sessionId: string): CycleTraceRecord[] {
    this.requireSession(sessionId);
    return this.traceRecorder.listRecords(sessionId);
  }

  public listCalibrationRecords(sessionId: string): CalibrationRecord[] {
    this.requireSession(sessionId);
    return structuredClone(this.calibrator.list(sessionId));
  }

  public listProviderReliabilityRecords(sessionId: string) {
    this.requireSession(sessionId);
    return structuredClone(this.providerReliabilityStore.list(sessionId));
  }

  public listReflectionRules(sessionId?: string) {
    if (sessionId) {
      this.requireSession(sessionId);
    }
    return structuredClone(this.reflectionLearner.list(sessionId));
  }

  public listRewardSignals(sessionId: string) {
    this.requireSession(sessionId);
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(
      this.rewardStore
        .listByTenantId(session.tenant_id)
        .filter((signal) => signal.session_id === sessionId)
    ) : [];
  }

  public listSkillPolicyStates(sessionId: string) {
    this.requireSession(sessionId);
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(this.skillPolicy.listStates(session.tenant_id)) : [];
  }

  public getEpisodes(sessionId: string): Episode[] {
    this.requireSession(sessionId);
    return structuredClone(this.episodicMemoryProvider.list(sessionId));
  }

  public markEpisodeSuspect(sessionId: string, episodeId: string, reason?: string): MemoryGovernanceEvent[] {
    return this.applyMemoryGovernance(sessionId, episodeId, {
      status: "suspect",
      reason
    });
  }

  public tombstoneEpisode(sessionId: string, episodeId: string, reason?: string): MemoryGovernanceEvent[] {
    return this.applyMemoryGovernance(sessionId, episodeId, {
      status: "tombstoned",
      reason
    });
  }

  public rollbackEpisode(sessionId: string, episodeId: string, reason?: string): MemoryGovernanceEvent[] {
    return this.applyMemoryGovernance(sessionId, episodeId, {
      status: "rolled_back",
      reason,
      rollback_of: episodeId
    });
  }

  public listEvents(sessionId: string): NeuroCoreEvent[] {
    this.requireSession(sessionId);
    return this.eventBus.list(sessionId);
  }

  public subscribeToSessionEvents(sessionId: string, listener: (event: NeuroCoreEvent) => void): () => void {
    this.requireSession(sessionId);
    return this.eventBus.subscribe(sessionId, listener);
  }

  public replaySession(sessionId: string): SessionReplay {
    this.requireSession(sessionId);
    return this.replayRunner.replaySession(sessionId);
  }

  private applyMemoryGovernance(
    sessionId: string,
    episodeId: string,
    lifecycleStateInput: Omit<MemoryLifecycleState, "marked_at" | "source_object_ids"> & {
      source_object_ids?: string[];
    }
  ): MemoryGovernanceEvent[] {
    const session = this.requireSession(sessionId);
    const episode = this.episodicMemoryProvider.list(sessionId).find((item) => item.episode_id === episodeId);
    if (!episode) {
      throw new Error(`Episode ${episodeId} not found in session ${sessionId}.`);
    }

    const lifecycleState: MemoryLifecycleState = {
      ...structuredClone(lifecycleStateInput),
      marked_at: nowIso(),
      source_object_ids: dedupeStrings([
        episodeId,
        ...(lifecycleStateInput.source_object_ids ?? [])
      ])
    };
    const markedAt = lifecycleState.marked_at ?? nowIso();

    this.episodicMemoryProvider.markLifecycle(sessionId, session.tenant_id, episodeId, lifecycleState);
    const cards = this.semanticMemoryProvider.markCardsByEpisodeIds(session.tenant_id, [episodeId], lifecycleState);
    const specs = this.proceduralMemoryProvider.markSkillSpecsByEpisodeIds(session.tenant_id, [episodeId], lifecycleState);

    const events: MemoryGovernanceEvent[] = [
      {
        event_id: generateId("mge"),
        object_id: episodeId,
        object_type: "episode",
        lifecycle_state: structuredClone(lifecycleState),
        related_object_ids: dedupeStrings([
          ...cards.map((card) => card.card_id),
          ...specs.map((spec) => spec.spec_id)
        ]),
        created_at: markedAt
      },
      ...cards.map((card) => ({
        event_id: generateId("mge"),
        object_id: card.card_id,
        object_type: "semantic_card" as const,
        lifecycle_state: structuredClone(lifecycleState),
        related_object_ids: [episodeId],
        created_at: markedAt
      })),
      ...specs.map((spec) => ({
        event_id: generateId("mge"),
        object_id: spec.spec_id,
        object_type: "skill_spec" as const,
        lifecycle_state: structuredClone(lifecycleState),
        related_object_ids: [episodeId],
        created_at: markedAt
      }))
    ];

    const eventType =
      lifecycleState.status === "suspect"
        ? "memory.object_marked_suspect"
        : lifecycleState.status === "tombstoned"
          ? "memory.object_tombstoned"
          : "memory.rollback_applied";

    for (const event of events) {
      this.emitEvent(session, eventType, event);
    }
    this.persistSessionState(sessionId);
    return structuredClone(events);
  }

  public createCheckpoint(sessionId: string): SessionCheckpoint {
    const session = this.requireSession(sessionId);

    const snapshot: SessionCheckpoint = {
      checkpoint_id: generateId("chk"),
      schema_version: session.schema_version,
      session: structuredClone(session),
      goals: structuredClone(this.goals.list(sessionId)),
      traces: structuredClone(this.getTraceRecords(sessionId)),
      pending_input: derivePendingInput(this.getTraceRecords(sessionId), session),
      autonomy_state: structuredClone(this.autonomyStates.get(sessionId)),
      created_at: nowIso()
    };

    if (!this.memoryPersistence?.working) {
      snapshot.working_memory = structuredClone(this.workingMemoryProvider.list(sessionId));
    }
    if (!this.memoryPersistence?.episodic) {
      snapshot.episodes = structuredClone(this.episodicMemoryProvider.list(sessionId));
    }
    if (!this.memoryPersistence?.semantic) {
      snapshot.semantic_memory = structuredClone(this.semanticMemoryProvider.buildSnapshot(sessionId));
    }
    if (!this.memoryPersistence?.episodic || !this.memoryPersistence?.skillStore) {
      snapshot.procedural_memory = structuredClone(
        this.proceduralMemoryProvider.buildSnapshot(sessionId)
      );
    }

    this.checkpointStore.save(snapshot);
    this.emitEvent(session, "checkpoint.created", snapshot);
    this.sessions.setCheckpointRef(sessionId, snapshot.checkpoint_id);
    this.persistSessionState(sessionId);

    debugLog("runtime", "Created session checkpoint", {
      sessionId,
      checkpointId: snapshot.checkpoint_id,
      goalCount: snapshot.goals.length,
      workingMemoryCount: snapshot.working_memory?.length ?? 0,
      episodeCount: snapshot.episodes?.length ?? 0,
      traceCount: snapshot.traces.length,
      hasPendingInput: Boolean(snapshot.pending_input)
    });

    return snapshot;
  }

  public getCheckpoint(checkpointId: string): SessionCheckpoint | undefined {
    this.ensureAllPersistedSessionsLoaded();
    return this.checkpointStore.get(checkpointId);
  }

  public suspendSession(sessionId: string): SessionCheckpoint {
    const session = this.requireSession(sessionId);
    const suspendedSession = this.updateSessionState(sessionId, "suspended");
    const checkpoint = this.createCheckpoint(sessionId);
    this.emitEvent(suspendedSession, "session.suspended", suspendedSession);
    debugLog("runtime", "Suspended session", {
      sessionId: session.session_id,
      checkpointId: checkpoint.checkpoint_id
    });
    return checkpoint;
  }

  public restoreSession(checkpoint: SessionCheckpoint) {
    const restoredSession = structuredClone(checkpoint.session);
    const sessionId = restoredSession.session_id;
    if (!isTerminalState(restoredSession.state)) {
      restoredSession.state = "hydrated";
      restoredSession.ended_at = undefined;
    }
    restoredSession.checkpoint_ref = checkpoint.checkpoint_id;

    this.sessions.hydrate(restoredSession);
    this.goals.hydrate(sessionId, structuredClone(checkpoint.goals));
    this.replaceAutonomyState(sessionId, checkpoint.autonomy_state);
    this.restoreCheckpointMemory(checkpoint, restoredSession.tenant_id);
    this.traceRecorder.getStore().replaceSession(
      sessionId,
      structuredClone(checkpoint.traces)
    );
    this.checkpointStore.save(structuredClone(checkpoint));
    this.persistSessionState(sessionId);

    debugLog("runtime", "Restored session from checkpoint", {
      sessionId,
      checkpointId: checkpoint.checkpoint_id,
      restoredState: restoredSession.state,
      traceCount: checkpoint.traces.length
    });

    this.emitEvent(restoredSession, "session.state_changed", restoredSession);

    return restoredSession;
  }

  public async resume(
    profile: AgentProfile,
    sessionId: string,
    input?: UserInput
  ): Promise<AgentRunLoopResult> {
    const releaseLock = await this.sessions.acquireSessionLock(sessionId);
    try {
      return await this.resumeUnlocked(profile, sessionId, input);
    } finally {
      releaseLock();
    }
  }

  private async resumeUnlocked(
    profile: AgentProfile,
    sessionId: string,
    input?: UserInput
  ): Promise<AgentRunLoopResult> {
    let session = this.sessions.ensureResumable(sessionId);
    if (session.state === "suspended") {
      session = this.updateSessionState(sessionId, "hydrated");
    }

    const traceRecords = this.getTraceRecords(sessionId);
    const validatedInput =
      input &&
      validateStructuredUserInput(
        input,
        derivePendingAskUserSchema(traceRecords, session)
      );
    const resumeInput = validatedInput ?? derivePendingInput(traceRecords, session);
    if (!resumeInput) {
      throw new Error(
        `Session ${sessionId} has no resumable pending input. Provide an explicit input to resume.`
      );
    }

    if (validatedInput) {
      this.rebaseGoalsForExplicitInput(sessionId, validatedInput);
    }

    debugLog("runtime", "Resuming session", {
      sessionId,
      restoredState: session.state,
      resumeInputId: resumeInput.input_id,
      resumeInputChars: resumeInput.content.length
    });

    this.emitEvent(session, "session.resumed", session);
    return this.runUntilSettledUnlocked(profile, sessionId, resumeInput);
  }

  public listCheckpoints(sessionId: string): SessionCheckpoint[] {
    this.requireSession(sessionId);
    return this.checkpointStore.list(sessionId);
  }

  public cleanupSession(sessionId: string, options?: { force?: boolean }): void {
    const session = this.requireSession(sessionId);
    if (!options?.force && !isTerminalState(session.state)) {
      throw new SessionStateConflictError(
        `Session ${sessionId} is in state ${session.state} and cannot be cleaned up yet.`
      );
    }

    const approvalIds = [...this.approvals.values()]
      .filter((approval) => approval.session_id === sessionId)
      .map((approval) => approval.approval_id);

    for (const approvalId of approvalIds) {
      this.approvals.delete(approvalId);
      this.pendingApprovals.delete(approvalId);
    }

    this.goals.deleteSession(sessionId);
    this.workingMemoryProvider.deleteSession(sessionId);
    this.episodicMemoryProvider.deleteSession(sessionId);
    this.semanticMemoryProvider.deleteSession(sessionId);
    this.proceduralMemoryProvider.deleteSession(sessionId);
    this.traceRecorder.getStore().deleteSession?.(sessionId);
    this.checkpointStore.deleteSession?.(sessionId);
    this.predictionStore.deleteSession?.(sessionId);
    this.calibrator.deleteSession(sessionId);
    this.providerReliabilityStore.deleteSession(sessionId);
    this.reflectionLearner.deleteSession(sessionId);
    this.autonomyPlanStore.deleteSession(sessionId);
    this.eventBus.deleteSession(sessionId);
    this.eventSequences.delete(sessionId);
    this.autonomyStates.delete(sessionId);
    this.sessions.deleteSession(sessionId);
    try {
      this.stateStore?.deleteSession?.(sessionId);
    } catch (error) {
      debugLog("runtime", "State store deleteSession failed during cleanup", {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    debugLog("runtime", "Cleaned up session state", {
      sessionId,
      forced: Boolean(options?.force),
      deletedApprovalCount: approvalIds.length
    });
  }

  public getApproval(approvalId: string): ApprovalRequest | undefined {
    this.ensureAllPersistedSessionsLoaded();
    const approval = this.approvals.get(approvalId);
    return approval ? structuredClone(approval) : undefined;
  }

  public listApprovals(sessionId?: string): ApprovalRequest[] {
    if (sessionId) {
      this.ensureSessionLoaded(sessionId);
    } else {
      this.ensureAllPersistedSessionsLoaded();
    }

    const approvals = [...this.approvals.values()].filter((approval) =>
      sessionId ? approval.session_id === sessionId : true
    );
    return structuredClone(approvals);
  }

  public getPendingApproval(sessionId: string): ApprovalRequest | undefined {
    this.requireSession(sessionId);
    const approval = [...this.approvals.values()]
      .filter((candidate) => candidate.session_id === sessionId && candidate.status === "pending")
      .sort((left, right) => Date.parse(right.requested_at) - Date.parse(left.requested_at))[0];

    return approval ? structuredClone(approval) : undefined;
  }

  public async decideApproval(
    profile: AgentProfile,
    approvalId: string,
    decision: {
      approver_id: string;
      decision: "approved" | "rejected";
      comment?: string;
      reviewer_identity?: import("@neurocore/protocol").ApprovalReviewerIdentity;
    }
  ): Promise<{ approval: ApprovalRequest; run?: AgentRunLoopResult }> {
    this.ensureAllPersistedSessionsLoaded();
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Unknown approval request: ${approvalId}`);
    }

    const releaseLock = await this.sessions.acquireSessionLock(approval.session_id);
    try {
      return await this.decideApprovalUnlocked(profile, approvalId, approval, decision);
    } finally {
      releaseLock();
    }
  }

  private async decideApprovalUnlocked(
    profile: AgentProfile,
    approvalId: string,
    approval: ApprovalRequest,
    decision: {
      approver_id: string;
      decision: "approved" | "rejected";
      comment?: string;
      reviewer_identity?: import("@neurocore/protocol").ApprovalReviewerIdentity;
    }
  ): Promise<{ approval: ApprovalRequest; run?: AgentRunLoopResult }> {
    if (approval.status !== "pending") {
      if (
        approval.status === decision.decision &&
        approval.decision === decision.decision &&
        approval.approver_id === decision.approver_id &&
        approval.comment === decision.comment
      ) {
        return {
          approval: structuredClone(approval)
        };
      }

      throw new SessionStateConflictError(`Approval request ${approvalId} is already ${approval.status}.`);
    }

    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`Approval request ${approvalId} is no longer executable.`);
    }

    this.sessions.ensureAwaitingApproval(approval.session_id, approvalId);

    const allowedApprovers = resolveAllowedApprovers(profile, approval);
    if (allowedApprovers) {
      if (!allowedApprovers.includes(decision.approver_id)) {
        throw new Error(`Approver ${decision.approver_id} is not in the allowed approvers list.`);
      }
    }

    approval.status = decision.decision;
    approval.decision = decision.decision;
    approval.approver_id = decision.approver_id;
    approval.comment = decision.comment;
    approval.reviewer_identity = decision.reviewer_identity;
    approval.decided_at = nowIso();
    if (decision.decision === "approved") {
      approval.approval_token = generateId("apt");
    }
    this.approvals.set(approvalId, approval);

    this.pendingApprovals.delete(approvalId);
    this.sessions.clearApprovalState(approval.session_id);

    if (decision.decision === "rejected") {
      this.updateSessionState(approval.session_id, "waiting");
      debugLog("runtime", "Approval rejected", {
        sessionId: approval.session_id,
        approvalId,
        approverId: decision.approver_id
      });
      this.maybeCreateCheckpoint(profile, approval.session_id);
      this.persistSessionState(approval.session_id);
      return {
        approval: structuredClone(approval)
      };
    }

    const session = this.requireSession(approval.session_id);

    debugLog("runtime", "Approval granted, executing selected action", {
      sessionId: approval.session_id,
      approvalId,
      actionId: approval.action_id
    });

    const step = await this.executeSelectedAction(
      profile,
      session,
      pending.input,
      pending.startedAt,
      {
        cycleId: pending.cycle_id,
        proposals: pending.proposals,
        actions: pending.candidate_actions,
        predictions: pending.predictions,
        workspace: pending.workspace
      },
      pending.selectedAction
    );
    await this.performAutonomyMaintenance(profile, approval.session_id, pending.input, step);

    return {
      approval: structuredClone(approval),
      run: {
        sessionId: approval.session_id,
        finalState: step.sessionState,
        steps: [step],
        traces: this.getTraces(approval.session_id),
        outputText: step.outputText
      }
    };
  }

  public cancelSession(sessionId: string): AgentSession {
    const session = this.cancelManagedSession(sessionId);
    this.markActionableGoals(sessionId, "cancelled");
    this.persistSessionState(sessionId);
    debugLog("runtime", "Cancelled session", {
      sessionId: session.session_id,
      state: session.state
    });
    return structuredClone(session);
  }

  private beginRun(sessionId: string): AgentSession {
    const previousState = this.requireSession(sessionId).state;
    const session = this.sessions.beginRun(sessionId);
    if (session.state !== previousState) {
      this.emitSessionStateChanged(session);
    }
    return session;
  }

  private updateSessionState(sessionId: string, nextState: SessionState): AgentSession {
    const previousState = this.requireSession(sessionId).state;
    const session = this.sessions.updateState(sessionId, nextState);
    if (session.state !== previousState) {
      this.emitSessionStateChanged(session);
    }
    return session;
  }

  private cancelManagedSession(sessionId: string): AgentSession {
    const previousState = this.requireSession(sessionId).state;
    const session = this.sessions.cancel(sessionId);
    if (session.state !== previousState) {
      this.emitSessionStateChanged(session);
    }
    return session;
  }

  private emitSessionStateChanged(session: AgentSession): void {
    this.emitEvent(session, "session.state_changed", session);
    if (session.state === "completed") {
      this.emitEvent(session, "session.completed", session);
    } else if (session.state === "failed") {
      this.emitEvent(session, "session.failed", session);
    }
  }

  private emitGoalCreated(session: AgentSession, goal: Goal): void {
    this.emitEvent(session, "goal.created", goal);
  }

  private emitGoalUpdated(session: AgentSession, goal: Goal): void {
    this.emitEvent(session, "goal.updated", goal);
    if (goal.status === "completed") {
      this.emitEvent(session, "goal.completed", goal);
    }
  }

  private emitRuntimeStatus(
    session: Pick<AgentSession, "schema_version" | "tenant_id" | "session_id">,
    status: Omit<RuntimeStatus, "status_id" | "session_id" | "created_at">
  ): void {
    this.emitEvent(
      session,
      "runtime.status",
      {
        status_id: generateId("sts"),
        session_id: session.session_id,
        cycle_id: status.cycle_id,
        phase: status.phase,
        state: status.state,
        summary: status.summary,
        detail: status.detail,
        data: status.data ? structuredClone(status.data) : undefined,
        created_at: nowIso()
      },
      status.cycle_id
    );
  }

  private emitRuntimeOutput(
    session: Pick<AgentSession, "schema_version" | "tenant_id" | "session_id">,
    output: Omit<RuntimeOutput, "output_id" | "session_id" | "created_at">
  ): void {
    this.emitEvent(
      session,
      "runtime.output",
      {
        output_id: generateId("out"),
        session_id: session.session_id,
        cycle_id: output.cycle_id,
        action_id: output.action_id,
        action_type: output.action_type,
        state: output.state,
        mode: output.mode,
        delta: output.delta,
        text: output.text,
        created_at: nowIso()
      },
      output.cycle_id
    );
  }

  private rebaseGoalsForExplicitInput(sessionId: string, input: UserInput): void {
    const session = this.requireSession(sessionId);
    const { rootGoal, retiredGoals } = this.goals.rebaseRootGoal(sessionId, input);
    for (const goal of retiredGoals) {
      this.emitGoalUpdated(session, goal);
    }
    this.emitGoalUpdated(session, rootGoal);
    debugLog("runtime", "Rebased session goals from explicit input", {
      sessionId,
      rootGoalId: rootGoal.goal_id,
      retiredGoalIds: retiredGoals.map((goal) => goal.goal_id),
      inputChars: input.content.length
    });
  }

  private markActionableGoals(sessionId: string, status: Goal["status"]): Goal[] {
    const session = this.requireSession(sessionId);
    const goals = this.goals.markActionable(sessionId, status);
    for (const goal of goals) {
      this.emitGoalUpdated(session, goal);
    }
    return goals;
  }

  private emitCycleStarted(session: AgentSession, cycleId: string, startedAt: string): void {
    this.emitEvent(
      session,
      "cycle.started",
      {
        trace_id: generateId("trc"),
        session_id: session.session_id,
        cycle_id: cycleId,
        started_at: startedAt,
        input_refs: [],
        proposal_refs: [],
        prediction_refs: [],
        policy_decision_refs: [],
        prediction_error_refs: [],
        observation_refs: []
      },
      cycleId
    );
  }

  private async ensureAutonomousPlan(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput
  ): Promise<void> {
    if (!this.autonomousPlanner) {
      return;
    }

    const existingState = this.autonomyStates.get(session.session_id);
    if (existingState?.active_plan) {
      return;
    }

    const baseState: AutonomyState =
      existingState ??
      {
        schema_version: profile.schema_version,
        session_id: session.session_id,
        plan_history: [],
        suggested_goals: [],
        drift_signals: [],
        recovery_queue: [],
        updated_at: nowIso()
      };
    const goals = this.goals.list(session.session_id);
    const context: ModuleContext = {
      tenant_id: session.tenant_id,
      session,
      profile,
      goals,
      runtime_state: {
        current_input_content: input.content,
        current_input_parts: input.content_parts ?? [],
        current_input_metadata: input.metadata ?? null,
        current_input_structured_response: input.structured_response ?? null
      },
      services: {
        now: nowIso,
        generateId
      },
      memory_config: profile.memory_config
    };
    const generatedPlan = await this.autonomousPlanner.generatePlan(context, structuredClone(baseState));
    if (!generatedPlan) {
      this.replaceAutonomyState(session.session_id, baseState);
      return;
    }
    const planPolicies = await this.evaluatePlanPolicies(context, generatedPlan);
    if (planPolicies.some((decision) => decision.level === "block")) {
      const blockedState: AutonomyState = {
        ...baseState,
        last_decision: {
          decision_id: generateId("adn"),
          session_id: session.session_id,
          source: "planner",
          decision_type: "pause_execution",
          summary: "Autonomous plan blocked by policy review.",
          created_at: nowIso()
        },
        updated_at: nowIso()
      };
      this.replaceAutonomyState(session.session_id, blockedState);
      return;
    }

    const injectedGoals = this.injectPlanGoals(session.session_id, generatedPlan);
    const activePlan = {
      ...generatedPlan,
      goal_ids: injectedGoals.map((goal) => goal.goal_id),
      checkpoints: generatedPlan.checkpoints.map((checkpoint, index) => {
        const goal = injectedGoals[index];
        return {
          ...checkpoint,
          goal_ids: goal ? [goal.goal_id] : checkpoint.goal_ids
        };
      }),
      updated_at: nowIso()
    };
    const nextState: AutonomyState = {
      ...baseState,
      active_plan: activePlan,
      plan_history: [
        ...(baseState.plan_history ?? []).filter((plan) => plan.plan_id !== activePlan.plan_id),
        activePlan
      ],
      updated_at: nowIso()
    };

    this.replaceAutonomyState(session.session_id, nextState);
    this.emitEvent(session, "plan.generated", activePlan, session.current_cycle_id);
  }

  private injectPlanGoals(
    sessionId: string,
    plan: import("@neurocore/protocol").AutonomousPlan
  ): Goal[] {
    const now = nowIso();
    const phaseGoalIdByPhaseId = new Map<string, string>();

    for (const phase of plan.phases) {
      phaseGoalIdByPhaseId.set(phase.phase_id, generateId("gol"));
    }

    return this.goals.addMany(
      sessionId,
      plan.phases.map((phase) => ({
        goal_id: phaseGoalIdByPhaseId.get(phase.phase_id) ?? generateId("gol"),
        schema_version: "0.1.0",
        session_id: sessionId,
        title: phase.title,
        description: phase.summary,
        goal_type: phase.goal_type,
        status: "blocked",
        priority: phase.priority,
        owner: "system",
        dependencies: phase.dependencies?.map(
          (dependencyPhaseId) => phaseGoalIdByPhaseId.get(dependencyPhaseId) ?? dependencyPhaseId
        ),
        created_at: now,
        updated_at: now,
        metadata: {
          autonomy_plan_id: plan.plan_id,
          autonomy_phase_id: phase.phase_id,
          plan_owned: true
        }
      }))
    );
  }

  private updateAutonomyStateFromTrace(
    sessionId: string,
    traceInput: Parameters<TraceRecorder["record"]>[0]
  ): AutonomyState | undefined {
    const current = this.autonomyStates.get(sessionId);
    if (!current?.active_plan) {
      return current ? structuredClone(current) : undefined;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return structuredClone(current);
    }

    const nextState = structuredClone(current);
    const activePlan = structuredClone(current.active_plan);
    const feedback: PlanFeedback = {
      feedback_id: generateId("pfb"),
      plan_id: activePlan.plan_id,
      outcome:
        traceInput.observation?.status === "failure" || traceInput.actionExecution?.status === "failed"
          ? "failure"
          : traceInput.observation
            ? "partial"
            : "success",
      summary:
        traceInput.observation?.summary ??
        traceInput.actionExecution?.status ??
        traceInput.selectedAction?.title ??
        "Autonomy cycle update.",
      created_at: nowIso()
    };
    activePlan.feedback = [...(activePlan.feedback ?? []), feedback];

    let decision: AutonomyDecision | undefined;
    if (feedback.outcome === "failure") {
      activePlan.phase = "recovery";
      activePlan.updated_at = nowIso();
      decision = {
        decision_id: generateId("adn"),
        session_id: sessionId,
        source: "planner",
        decision_type: "revise_plan",
        summary: `Revise ${activePlan.title} after a failed cycle.`,
        plan_id: activePlan.plan_id,
        created_at: nowIso()
      };
      this.emitEvent(session, "plan.revised", activePlan, traceInput.cycleId);
      this.emitEvent(session, "plan.status_changed", decision, traceInput.cycleId);
    } else if (traceInput.selectedAction?.action_type === "respond") {
      activePlan.phase = "learning";
      activePlan.status = "completed";
      activePlan.updated_at = nowIso();
      decision = {
        decision_id: generateId("adn"),
        session_id: sessionId,
        source: "planner",
        decision_type: "continue_execution",
        summary: `Complete ${activePlan.title} after final response.`,
        plan_id: activePlan.plan_id,
        created_at: nowIso()
      };
      this.emitEvent(session, "plan.status_changed", decision, traceInput.cycleId);
    } else if (
      activePlan.current_phase_id &&
      (traceInput.observation?.status === "success" || traceInput.actionExecution?.status === "succeeded")
    ) {
      const currentPhaseIndex = activePlan.phases.findIndex(
        (phase) => phase.phase_id === activePlan.current_phase_id
      );
      const nextPhase = currentPhaseIndex >= 0 ? activePlan.phases[currentPhaseIndex + 1] : undefined;
      if (nextPhase) {
        activePlan.phase = "execution";
        activePlan.current_phase_id = nextPhase.phase_id;
        activePlan.updated_at = nowIso();
        decision = {
          decision_id: generateId("adn"),
          session_id: sessionId,
          source: "planner",
          decision_type: "continue_execution",
          summary: `Advance ${activePlan.title} to ${nextPhase.title}.`,
          plan_id: activePlan.plan_id,
          created_at: nowIso()
        };
        this.emitEvent(session, "plan.status_changed", decision, traceInput.cycleId);
      }
    }

    nextState.active_plan = activePlan;
    nextState.plan_history = [
      ...(nextState.plan_history ?? []).filter((plan) => plan.plan_id !== activePlan.plan_id),
      activePlan
    ];
    nextState.last_decision = decision ?? nextState.last_decision;
    nextState.updated_at = nowIso();
    this.replaceAutonomyState(sessionId, nextState);
    return structuredClone(nextState);
  }

  private async performAutonomyMaintenance(
    profile: AgentProfile,
    sessionId: string,
    input: UserInput,
    step: AgentRunResult
  ): Promise<void> {
    if (!shouldRunAutonomyMaintenance(profile)) {
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const currentState =
      this.autonomyStates.get(sessionId) ??
      createAutonomyState(profile.schema_version, sessionId);
    let nextState = structuredClone(currentState);
    const ctx = this.buildAutonomyContext(profile, session, input, step, nextState);
    let stateChanged = false;

    if (profile.autonomy_config?.monitor_enabled === true) {
      const healthReport = await this.selfMonitor.inspect(ctx, nextState);
      nextState.health_report = healthReport;
      nextState.updated_at = nowIso();
      stateChanged = true;
      this.emitEvent(session, "health.report", healthReport, step.cycleId);

      const driftSignals = await this.selfMonitor.detectDrift?.(ctx, nextState);
      if (driftSignals && driftSignals.length > 0) {
        nextState.drift_signals = mergeDriftSignals(nextState.drift_signals, driftSignals);
        nextState.updated_at = nowIso();
        stateChanged = true;
        for (const signal of driftSignals) {
          this.emitEvent(session, "drift.detected", signal, step.cycleId);
        }
      }

      const recoveryActions = await this.selfMonitor.recommendRecovery?.(ctx, nextState, healthReport);
      if (recoveryActions && recoveryActions.length > 0) {
        nextState.recovery_queue = recoveryActions.map(toRecoveryRecommendation);
        nextState.updated_at = nowIso();
        stateChanged = true;
        for (const action of recoveryActions) {
          this.emitEvent(session, "recovery.triggered", action, step.cycleId);
        }
        const recoveryResult = await this.applyRecoveryActions(profile, session, ctx, nextState, recoveryActions, step.cycleId);
        nextState = recoveryResult.state;
        stateChanged = stateChanged || recoveryResult.changed;
      }
    }

    if (
      profile.autonomy_config?.self_goal_enabled === true &&
      profile.autonomy_config?.alignment?.allow_self_generated_goals !== false &&
      shouldGenerateSelfGoals(session, this.goals.list(sessionId))
    ) {
      const motivation = await this.intrinsicMotivationEngine.compute(ctx, nextState);
      nextState.intrinsic_motivation = motivation;
      nextState.updated_at = nowIso();
      stateChanged = true;
      this.emitEvent(session, "motivation.computed", motivation, step.cycleId);

      const candidates = await this.selfGoalGenerator.suggestGoals(ctx, nextState, motivation);
      if (candidates.length > 0) {
        const filteredGoals = await this.filterSuggestedGoals(ctx, nextState, candidates);
        nextState.suggested_goals = filteredGoals.updatedGoals;
        nextState.updated_at = nowIso();
        stateChanged = true;
        for (const goal of filteredGoals.updatedGoals) {
          this.emitEvent(session, "goal.self_generated", goal, step.cycleId);
        }
      }
    }

    if (profile.autonomy_config?.transfer_enabled === true) {
      const transferResult = await this.transferAdapter.transfer(ctx, nextState);
      if (transferResult && shouldAdoptTransferResult(nextState.latest_transfer, transferResult)) {
        nextState.latest_transfer = transferResult;
        nextState.updated_at = nowIso();
        stateChanged = true;
        this.emitEvent(session, "transfer.attempted", transferResult, step.cycleId);
        if (transferResult.validation_status === "validated") {
          this.emitEvent(session, "transfer.validated", transferResult, step.cycleId);
        }
      }
    }

    if (profile.autonomy_config?.continual_learning_enabled === true && shouldConsolidateKnowledge(session, nextState, step)) {
      const snapshot = await this.continualLearner.consolidate(ctx, nextState);
      if (snapshot) {
        nextState.latest_knowledge_snapshot = snapshot;
        nextState.performance_baseline = buildPerformanceBaseline(sessionId, ctx.runtime_state);
        nextState.curriculum_stage = buildCurriculumStage(nextState, step);
        nextState.updated_at = nowIso();
        stateChanged = true;
        this.emitEvent(session, "consolidation.completed", snapshot, step.cycleId);
      }
    }

    if (!stateChanged) {
      return;
    }

    this.replaceAutonomyState(sessionId, nextState);
    this.annotateTraceWithAutonomy(sessionId, step.cycleId, nextState);
    this.persistSessionState(sessionId);
  }

  private buildAutonomyContext(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    step: AgentRunResult,
    state: AutonomyState
  ): ModuleContext {
    const traceRecords = this.getTraceRecords(session.session_id);
    const windowSize = profile.autonomy_config?.monitor_window_size ?? 8;
    const recentTraceRecords = traceRecords.slice(-windowSize);
    const goals = this.goals.list(session.session_id);
    const baseContext = buildMemoryContext(
      profile,
      session,
      this.goals.active(session.session_id),
      input,
      recentTraceRecords,
      state
    );
    const timeoutRate = measureTimeoutRate(recentTraceRecords);
    const failureRate = measureFailureRate(recentTraceRecords);
    const successRate = measureSuccessRate(recentTraceRecords);
    const suggestedGoals = state.suggested_goals ?? [];
    const rejectedSelfGoals = suggestedGoals.filter((goal) => goal.status === "rejected").length;
    const activeAgentGoals = goals.filter((goal) => goal.owner === "agent" && !isTerminalGoalStatus(goal.status)).length;
    const availableToolNames = this.tools.list().map((tool) => tool.name);
    const applicableSkills = this.listSkills(session.session_id);
    const activePlanPhase = state.active_plan?.current_phase_id
      ? state.active_plan.phases.find((phase) => phase.phase_id === state.active_plan?.current_phase_id)
      : undefined;

    return {
      ...baseContext,
      goals,
      workspace: step.cycle.workspace,
      runtime_state: {
        ...baseContext.runtime_state,
        trace_records: structuredClone(recentTraceRecords),
        recent_trace_records: structuredClone(recentTraceRecords),
        recent_failure_rate: failureRate,
        recent_success_rate: successRate,
        recent_timeout_rate: timeoutRate,
        recent_prediction_error_rate: this.predictionStore.getRecentErrorRate(session.session_id, windowSize),
        current_session_state: session.state,
        active_goal_count: this.goals.active(session.session_id).length,
        active_agent_goal_count: activeAgentGoals,
        rejected_self_goal_count: rejectedSelfGoals,
        available_tool_names: availableToolNames,
        skill_coverage: computeSkillCoverage(goals, applicableSkills),
        last_observation_status: step.observation?.status ?? null,
        last_observation_summary: step.observation?.summary ?? null,
        last_action_type: step.selectedAction?.action_type ?? null,
        last_output_text: step.outputText ?? null,
        current_plan_phase_title: activePlanPhase?.title ?? null
      },
      memory_config: profile.memory_config
    };
  }

  private async applyRecoveryActions(
    profile: AgentProfile,
    session: AgentSession,
    ctx: ModuleContext,
    state: AutonomyState,
    actions: import("@neurocore/protocol").RecoveryAction[],
    cycleId: string
  ): Promise<{ state: AutonomyState; changed: boolean }> {
    let nextState = structuredClone(state);
    let changed = false;

    for (const action of actions) {
      if (profile.autonomy_config?.alignment?.allow_autonomous_recovery === false && action.action_type !== "request_approval") {
        this.ensureRecoveryGoal(session, action, "human_reviewer");
        continue;
      }

      if (action.action_type === "replan") {
        const decision = await this.autonomousPlanner?.revisePlan?.(ctx, nextState);
        if (decision) {
          if (nextState.active_plan) {
            nextState.active_plan = {
              ...nextState.active_plan,
              phase: "recovery",
              updated_at: nowIso()
            };
            nextState.plan_history = replacePlanInHistory(nextState.plan_history, nextState.active_plan);
            this.autonomyPlanStore.save(nextState.active_plan);
            this.emitEvent(session, "plan.revised", nextState.active_plan, cycleId);
          }
          nextState.last_decision = decision;
          nextState.updated_at = nowIso();
          changed = true;
          this.emitEvent(session, "plan.status_changed", decision, cycleId);
          this.emitEvent(
            session,
            "recovery.completed",
            {
              ...action,
              status: "completed",
              completed_at: nowIso()
            },
            cycleId
          );
          continue;
        }
      }

      if (action.action_type === "consolidate_learning" && profile.autonomy_config?.continual_learning_enabled === true) {
        const snapshot = await this.continualLearner.consolidate(ctx, nextState);
        if (snapshot) {
          nextState.latest_knowledge_snapshot = snapshot;
          nextState.updated_at = nowIso();
          changed = true;
          this.emitEvent(session, "consolidation.completed", snapshot, cycleId);
          this.emitEvent(
            session,
            "recovery.completed",
            {
              ...action,
              status: "completed",
              completed_at: nowIso()
            },
            cycleId
          );
          continue;
        }
      }

      if (action.action_type === "request_approval") {
        this.ensureRecoveryGoal(session, action, "human_reviewer");
      } else if (action.action_type === "request_input") {
        this.ensureRecoveryGoal(session, action, "user");
      } else {
        this.ensureRecoveryGoal(session, action, "system");
      }
    }

    return { state: nextState, changed };
  }

  private ensureRecoveryGoal(
    session: AgentSession,
    action: import("@neurocore/protocol").RecoveryAction,
    owner: Goal["owner"]
  ): void {
    const existing = this.goals.list(session.session_id).find(
      (goal) => goal.metadata?.recovery_action_id === action.recovery_action_id
    );
    if (existing) {
      return;
    }
    const goal = this.goals.addMany(session.session_id, [
      {
        goal_id: generateId("gol"),
        schema_version: session.schema_version,
        session_id: session.session_id,
        title: action.summary,
        description: action.summary,
        goal_type: "recovery",
        status: "pending",
        priority: owner === "human_reviewer" ? 95 : 85,
        owner,
        created_at: nowIso(),
        updated_at: nowIso(),
        metadata: {
          recovery_action_id: action.recovery_action_id,
          system_generated: true
        }
      }
    ])[0];
    if (goal) {
      this.emitGoalCreated(session, goal);
    }
  }

  private async filterSuggestedGoals(
    ctx: ModuleContext,
    state: AutonomyState,
    candidates: SuggestedGoal[]
  ): Promise<{ updatedGoals: SuggestedGoal[] }> {
    const policyDecisionsByGoalId = new Map<string, import("@neurocore/protocol").PolicyDecision[]>();
    for (const candidate of candidates) {
      const decisions = await this.evaluateSelfGoalPolicies(ctx, candidate);
      policyDecisionsByGoalId.set(candidate.suggested_goal_id, decisions);
    }

    const goalFilter = new DefaultGoalFilter();
    const decision = goalFilter.evaluate({
      candidates,
      activeGoals: ctx.goals,
      feasibilityThreshold: ctx.profile.autonomy_config?.goal_feasibility_threshold ?? 0.25,
      policyDecisionsByGoalId
    });
    const maxConcurrentSelfGoals =
      ctx.profile.autonomy_config?.alignment?.max_concurrent_self_goals ?? 1;
    let acceptedCount = ctx.goals.filter(
      (goal) => goal.owner === "agent" && !isTerminalGoalStatus(goal.status)
    ).length;
    const updatedGoals: SuggestedGoal[] = [];

    for (const candidate of candidates) {
      const rejected = decision.rejected.find((item) => item.goal.suggested_goal_id === candidate.suggested_goal_id);
      const policyDecisions = policyDecisionsByGoalId.get(candidate.suggested_goal_id) ?? [];
      const needsReview =
        policyDecisions.some((item) => item.level === "warn") ||
        (ctx.profile.autonomy_config?.alignment?.high_risk_self_goal_requires_approval === true &&
          candidate.priority >= 70);
      let status: SuggestedGoal["status"] = "proposed";

      if (rejected) {
        status = "rejected";
      } else if (acceptedCount >= maxConcurrentSelfGoals) {
        status = "dismissed";
      } else if (!needsReview) {
        status = "accepted";
        acceptedCount += 1;
        const goal = this.goals.addMany(ctx.session.session_id, [
          toGoalFromSuggestedGoal(ctx, candidate)
        ])[0];
        if (goal) {
          this.emitGoalCreated(ctx.session, goal);
        }
      }

      updatedGoals.push({
        ...candidate,
        status
      });
    }

    return {
      updatedGoals: mergeSuggestedGoals(state.suggested_goals, updatedGoals)
    };
  }

  private async evaluateSelfGoalPolicies(
    ctx: ModuleContext,
    goal: SuggestedGoal
  ): Promise<import("@neurocore/protocol").PolicyDecision[]> {
    const settled = await Promise.allSettled(
      this.policyProviders
        .filter((policy) => typeof policy.evaluateSelfGoal === "function")
        .map((policy) =>
          policy.evaluateSelfGoal!(
            ctx,
            toGoalCandidate(goal, ctx.profile.schema_version)
          )
        )
    );

    return settled
      .filter((result): result is PromiseFulfilledResult<import("@neurocore/protocol").PolicyDecision[]> => result.status === "fulfilled")
      .flatMap((result) => result.value);
  }

  private async evaluatePlanPolicies(
    ctx: ModuleContext,
    plan: import("@neurocore/protocol").AutonomousPlan
  ): Promise<import("@neurocore/protocol").PolicyDecision[]> {
    const settled = await Promise.allSettled(
      this.policyProviders
        .filter((policy) => typeof policy.evaluatePlan === "function")
        .map((policy) => policy.evaluatePlan!(ctx, plan))
    );

    return settled
      .filter((result): result is PromiseFulfilledResult<import("@neurocore/protocol").PolicyDecision[]> => result.status === "fulfilled")
      .flatMap((result) => result.value);
  }

  private annotateTraceWithAutonomy(
    sessionId: string,
    cycleId: string,
    state: AutonomyState
  ): void {
    const records = this.traceRecorder.getStore().list(sessionId);
    if (records.length === 0) {
      return;
    }
    const index = [...records].reverse().findIndex((record) => record.trace.cycle_id === cycleId);
    if (index < 0) {
      return;
    }
    const targetIndex = records.length - 1 - index;
    const nextRecords = structuredClone(records);
    const target = nextRecords[targetIndex];
    if (!target) {
      return;
    }
    target.autonomy_state = structuredClone(state);
    target.autonomy_decision = state.last_decision ? structuredClone(state.last_decision) : undefined;
    if (target.workspace) {
      target.workspace = {
        ...target.workspace,
        autonomy_state: structuredClone(state)
      };
    }
    this.traceRecorder.getStore().replaceSession(sessionId, nextRecords);
  }

  private recordTrace(input: Parameters<TraceRecorder["record"]>[0]): CycleTrace {
    const session = this.sessions.get(input.sessionId);
    if (session) {
      const observabilityConfig =
        session.metadata &&
        typeof session.metadata === "object" &&
        "observability_config" in session.metadata
          ? (session.metadata.observability_config as { trace_enabled?: boolean })
          : undefined;
      if (observabilityConfig?.trace_enabled === false) {
        return {
          trace_id: generateId("trc"),
          session_id: input.sessionId,
          cycle_id: input.cycleId,
          started_at: input.startedAt,
          ended_at: input.endedAt ?? nowIso(),
          input_refs: [],
          proposal_refs: [],
          prediction_refs: [],
          policy_decision_refs: [],
          prediction_error_refs: [],
          observation_refs: []
        };
      }
    }
    const autonomyState =
      this.updateAutonomyStateFromTrace(input.sessionId, input) ??
      input.autonomyState ??
      this.autonomyStates.get(input.sessionId);
    const workspace =
      autonomyState && input.workspace
        ? {
            ...input.workspace,
            autonomy_state: input.workspace.autonomy_state ?? structuredClone(autonomyState)
          }
        : input.workspace;
    return this.traceRecorder.record({
      ...input,
      workspace,
      autonomyState: structuredClone(autonomyState)
    });
  }

  private emitEvent(
    session: Pick<AgentSession, "schema_version" | "tenant_id" | "session_id">,
    eventType: NeuroCoreEventType,
    payload: NeuroCoreEvent["payload"],
    cycleId?: string
  ): void {
    const sequenceNo = (this.eventSequences.get(session.session_id) ?? 0) + 1;
    this.eventSequences.set(session.session_id, sequenceNo);
    this.eventBus.append({
      event_id: generateId("evt"),
      event_type: eventType,
      schema_version: session.schema_version,
      tenant_id: session.tenant_id,
      session_id: session.session_id,
      cycle_id: cycleId,
      sequence_no: sequenceNo,
      timestamp: nowIso(),
      payload: structuredClone(payload)
    } as NeuroCoreEvent);
  }

  private maybeCreateCheckpoint(profile: AgentProfile, sessionId: string): void {
    if (profile.runtime_config.checkpoint_interval === "cycle") {
      this.createCheckpoint(sessionId);
    }
  }

  private async decomposeGoals(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput
  ): Promise<void> {
    if (!this.reasoner.decomposeGoal) {
      return;
    }

    const decomposableGoals = this.goals.decomposable(session.session_id);
    for (const goal of decomposableGoals) {
      const ctx = buildMemoryContext(
        profile,
        session,
        this.goals.active(session.session_id),
        input,
        this.getTraceRecords(session.session_id),
        this.autonomyStates.get(session.session_id)
      );
      const decomposition = await this.reasoner.decomposeGoal(ctx, structuredClone(goal));

      if (!Array.isArray(decomposition) || decomposition.length === 0) {
        this.emitGoalUpdated(
          session,
          this.goals.markDecompositionState(session.session_id, goal.goal_id, "skipped")
        );
        continue;
      }

      const normalizedChildren = decomposition.map((child) =>
        normalizeDecomposedGoal(profile, session.session_id, goal, child)
      );
      const inserted = this.goals.addMany(session.session_id, normalizedChildren);
      for (const child of inserted) {
        this.emitGoalCreated(session, child);
      }
      this.emitGoalUpdated(
        session,
        this.goals.markDecompositionState(session.session_id, goal.goal_id, "completed")
      );

      debugLog("runtime", "Decomposed goal into child goals", {
        sessionId: session.session_id,
        goalId: goal.goal_id,
        childGoalCount: inserted.length,
        childGoalIds: inserted.map((child) => child.goal_id)
      });
    }
  }

  private createPendingApproval(input: {
    session: AgentSession;
    input: UserInput;
    cycle: ExecutionCycleState;
    reviewReason: string;
    selectedAction: CandidateAction;
    startedAt: string;
  }): ApprovalRequest {
    const approval: ApprovalRequest = {
      approval_id: generateId("apr"),
      session_id: input.session.session_id,
      tenant_id: input.session.tenant_id,
      cycle_id: input.cycle.cycleId,
      action_id: input.selectedAction.action_id,
      status: "pending",
      requested_at: nowIso(),
      review_reason: input.reviewReason,
      action: structuredClone(input.selectedAction)
    };

    this.approvals.set(approval.approval_id, approval);
    this.pendingApprovals.set(approval.approval_id, {
      approval_id: approval.approval_id,
      cycle_id: input.cycle.cycleId,
      input: structuredClone(input.input),
      proposals: structuredClone(input.cycle.proposals),
      candidate_actions: structuredClone(input.cycle.actions),
      predictions: structuredClone(input.cycle.predictions),
      workspace: structuredClone(input.cycle.workspace),
      selectedAction: structuredClone(input.selectedAction),
      startedAt: input.startedAt
    });
    this.sessions.setApprovalState(input.session.session_id, approval.approval_id);
    this.emitEvent(input.session, "approval.requested", approval, input.cycle.cycleId);

    return structuredClone(approval);
  }

  private async executeSelectedAction(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    startedAt: string,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): Promise<AgentRunResult> {
    const sessionId = session.session_id;
    const preconditionFailures = this.evaluateActionPreconditions(session, input, selectedAction);
    if (preconditionFailures.length > 0) {
      const fallbackAction = resolveFailureFallbackAction(
        cycle.actions,
        selectedAction,
        getCompletedActionIds(input.metadata)
      );
      if (fallbackAction) {
        this.emitRuntimeStatus(session, {
          cycle_id: cycle.cycleId,
          phase: "reasoning",
          state: "in_progress",
          summary: "Switching to fallback action",
          detail: `Fallback after unmet preconditions: ${fallbackAction.title}`,
          data: {
            action_id: fallbackAction.action_id,
            action_type: fallbackAction.action_type,
            failed_action_id: selectedAction.action_id,
            precondition_failures: preconditionFailures
          }
        });
        return this.executeSelectedAction(profile, session, input, startedAt, cycle, fallbackAction);
      }
      return this.handlePreconditionFailure(
        profile,
        session,
        input,
        startedAt,
        cycle,
        selectedAction,
        preconditionFailures
      );
    }

    if (selectedAction.action_type === "abort") {
      const execution = buildRuntimeActionExecution(session, cycle.cycleId, selectedAction, "cancelled");
      this.emitEvent(session, "action.executed", execution, cycle.cycleId);
      const sessionState = this.updateSessionState(sessionId, "aborted").state;
      const trace = this.recordTrace({
        sessionId,
        cycleId: cycle.cycleId,
        input,
        proposals: cycle.proposals,
        candidateActions: cycle.actions,
        predictions: cycle.predictions,
        policyDecisions: cycle.workspace.policy_decisions ?? [],
        selectedAction,
        selectedActionId: selectedAction.action_id,
        actionExecution: execution,
        workspace: cycle.workspace,
        ...toMetaTraceFields(cycle),
        startedAt
      });
      debugLog("runtime", "Run aborted", {
        sessionId,
        cycleId: cycle.cycleId,
        actionId: selectedAction.action_id
      });
      this.markActionableGoals(sessionId, "cancelled");
      this.maybeCreateCheckpoint(profile, sessionId);
      this.persistSessionState(sessionId);
      return {
        sessionId,
        cycleId: cycle.cycleId,
        sessionState,
        selectedAction,
        actionExecution: execution,
        outputText: selectedAction.title,
        trace,
        cycle: toAgentCycleState(cycle)
      };
    }

    if (selectedAction.action_type === "call_tool") {
      const parallelToolActions = this.selectParallelToolActions(profile, cycle, selectedAction);
      if (parallelToolActions.length > 1) {
        return this.executeParallelToolActions(
          profile,
          session,
          input,
          startedAt,
          cycle,
          parallelToolActions
        );
      }
      this.emitRuntimeStatus(session, {
        cycle_id: cycle.cycleId,
        phase: "tool_execution",
        state: "started",
        summary: `Calling tool ${selectedAction.tool_name ?? "unknown"}`,
        detail: selectedAction.description ?? selectedAction.title,
        data: {
          action_id: selectedAction.action_id,
          tool_name: selectedAction.tool_name,
          tool_args: selectedAction.tool_args
        }
      });
      const skillResult = await this.trySkillExecution(profile, session, input, startedAt, cycle, selectedAction);
      if (skillResult) return skillResult;
      const actuatorResult = await this.tryActuatorOrchestration(profile, session, input, startedAt, cycle, selectedAction);
      if (actuatorResult) return actuatorResult;

      const matchedSkillProposal = findSkillProposal(cycle.proposals, selectedAction);
      const { execution, observation } = await this.tools.execute(
        selectedAction,
        {
          tenant_id: session.tenant_id,
          session_id: session.session_id,
          cycle_id: cycle.cycleId
        },
        {
          defaultExecution: {
            timeout_ms: profile.runtime_config.default_sync_timeout_ms,
            ...(profile.runtime_config.tool_execution ?? {})
          }
        }
      );
      const observationWithSkill = matchedSkillProposal
        ? {
            ...observation,
            structured_payload: {
              ...(observation.structured_payload ?? {}),
              skill_id:
                typeof matchedSkillProposal.payload.skill_id === "string"
                  ? matchedSkillProposal.payload.skill_id
                  : undefined,
              skill_name:
                typeof matchedSkillProposal.payload.skill_name === "string"
                  ? matchedSkillProposal.payload.skill_name
                  : undefined
            }
          }
        : observation;
      if (matchedSkillProposal) {
        this.emitEvent(session, "skill.executed", execution, cycle.cycleId);
      }
      this.emitEvent(session, "action.executed", execution, cycle.cycleId);
      this.emitRuntimeStatus(session, {
        cycle_id: cycle.cycleId,
        phase: "tool_execution",
        state: observationWithSkill.status === "failure" ? "failed" : "completed",
        summary: `Tool ${selectedAction.tool_name ?? "unknown"} finished`,
        detail: observationWithSkill.summary,
        data: {
          action_id: selectedAction.action_id,
          tool_name: selectedAction.tool_name,
          status: execution.status,
          observation_status: observationWithSkill.status
        }
      });
      this.sessions.incrementToolCallUsed(sessionId);
      const { predictionErrors, calibrationRecord, createdReflectionRule } = await this.recordObservation(
        profile,
        session,
        input,
        cycle.cycleId,
        selectedAction,
        observationWithSkill,
        observationWithSkill.status === "failure" ? "failure" : "partial",
        cycle.predictions,
        execution,
        cycle.metaAssessment,
        cycle.metaSignalFrame,
        deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, selectedAction)
      );

      const sessionState = this.updateSessionState(sessionId, "waiting").state;
      const trace = this.recordTrace({
        sessionId,
        cycleId: cycle.cycleId,
        input,
        proposals: cycle.proposals,
        candidateActions: cycle.actions,
        predictions: cycle.predictions,
        policyDecisions: cycle.workspace.policy_decisions ?? [],
        predictionErrors,
        selectedAction,
        selectedActionId: selectedAction.action_id,
        actionExecution: execution,
        observation: observationWithSkill,
        workspace: cycle.workspace,
        calibrationRecord,
        createdReflectionRule,
        ...toMetaTraceFields(cycle),
        startedAt
      });
      debugLog("runtime", "Run waiting after tool execution", {
        sessionId,
        cycleId: cycle.cycleId,
        actionId: selectedAction.action_id,
        toolName: selectedAction.tool_name,
        executionStatus: execution.status,
        observationStatus: observationWithSkill.status,
        observationSummary: observationWithSkill.summary.slice(0, 160)
      });
      this.maybeCreateCheckpoint(profile, sessionId);
      this.persistSessionState(sessionId);
      return {
        sessionId,
        cycleId: cycle.cycleId,
        sessionState,
        selectedAction,
        actionExecution: execution,
        observation: observationWithSkill,
        outputText: observationWithSkill.summary,
        trace,
        cycle: toAgentCycleState(cycle),
        predictionErrors,
        calibrationRecord
      };
    }

    if (selectedAction.action_type === "delegate") {
      return this.executeDelegateAction(profile, session, input, startedAt, cycle, selectedAction);
    }

    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "response_generation",
      state: "started",
      summary: selectedAction.action_type === "ask_user" ? "Preparing follow-up question" : "Preparing assistant response",
      detail: selectedAction.description ?? selectedAction.title,
      data: {
        action_id: selectedAction.action_id,
        action_type: selectedAction.action_type
      }
    });
    const targetState = deriveSessionState(selectedAction.action_type);
    const streamedText = await this.streamTextAction(profile, session, input, cycle, selectedAction);
    const observation = buildSyntheticObservation(session, cycle.cycleId, selectedAction, streamedText);
    const execution = buildRuntimeActionExecution(session, cycle.cycleId, selectedAction, "succeeded");
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "response_generation",
      state: "completed",
      summary: selectedAction.action_type === "ask_user" ? "Follow-up question ready" : "Assistant response ready",
      detail: observation.summary,
      data: {
        action_id: selectedAction.action_id,
        action_type: selectedAction.action_type,
        status: execution.status
      }
    });
    const { predictionErrors, calibrationRecord, createdReflectionRule } = await this.recordObservation(
      profile, session, input, cycle.cycleId, selectedAction, observation, "success",
      cycle.predictions, execution, cycle.metaAssessment, cycle.metaSignalFrame,
      deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, selectedAction)
    );
    const sessionState = this.updateSessionState(sessionId, targetState).state;
    if (sessionState === "completed") {
      this.markActionableGoals(sessionId, "completed");
    } else if (sessionState === "aborted") {
      this.markActionableGoals(sessionId, "cancelled");
    }
    const trace = this.recordTrace({
      sessionId,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      predictionErrors,
      selectedAction,
      selectedActionId: selectedAction.action_id,
      actionExecution: execution,
      observation,
      workspace: cycle.workspace,
      calibrationRecord,
      createdReflectionRule,
      ...toMetaTraceFields(cycle),
      startedAt
    });
    debugLog("runtime", "Run completed with synthetic observation", {
      sessionId,
      cycleId: cycle.cycleId,
      actionId: selectedAction.action_id,
      sessionState
    });
    this.maybeCreateCheckpoint(profile, sessionId);
    this.persistSessionState(sessionId);
    return {
      sessionId,
      cycleId: cycle.cycleId,
      sessionState,
      selectedAction,
      actionExecution: execution,
      observation,
      outputText: streamedText,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors,
      calibrationRecord
    };
  }

  private evaluateActionPreconditions(
    session: AgentSession,
    input: UserInput,
    action: CandidateAction
  ): string[] {
    const failures: string[] = [];
    const preconditions = Array.isArray(action.preconditions) ? action.preconditions : [];
    if (preconditions.length === 0) {
      return failures;
    }

    for (const rawPrecondition of preconditions) {
      const precondition = rawPrecondition.trim();
      if (!precondition) {
        continue;
      }

      if (precondition === "input:structured_response=present") {
        if (typeof input.structured_response === "undefined" || input.structured_response === null) {
          failures.push(precondition);
        }
        continue;
      }

      if (precondition.startsWith("session:state=")) {
        const expected = precondition.slice("session:state=".length);
        if (session.state !== expected) {
          failures.push(precondition);
        }
        continue;
      }

      if (precondition.startsWith("tool:")) {
        const toolMatch = /^tool:([^:]+):registered=(true|false)$/.exec(precondition);
        if (!toolMatch) {
          failures.push(precondition);
          continue;
        }
        const [, toolName, expectedFlag] = toolMatch;
        const isRegistered = this.tools.list().some((tool) => tool.name === toolName);
        if (isRegistered !== (expectedFlag === "true")) {
          failures.push(precondition);
        }
        continue;
      }

      if (precondition.startsWith("entity:")) {
        const entityMatch = /^entity:([^:]+):([^=]+)=(.+)$/.exec(precondition);
        if (!entityMatch) {
          failures.push(precondition);
          continue;
        }
        const [, entityId, propertyName, expectedRaw] = entityMatch;
        const entity = this.worldStateGraph?.getEntity(entityId);
        const actual = entity?.properties?.[propertyName];
        if (!matchesPreconditionValue(actual, expectedRaw)) {
          failures.push(precondition);
        }
        continue;
      }

      failures.push(precondition);
    }

    return failures;
  }

  private async handlePreconditionFailure(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    startedAt: string,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction,
    failures: string[]
  ): Promise<AgentRunResult> {
    const sessionId = session.session_id;
    const endedAt = nowIso();
    const summary = `Preconditions not met: ${failures.join(", ")}`;
    const execution = buildRuntimeActionExecution(session, cycle.cycleId, selectedAction, "failed");
    execution.started_at = startedAt;
    execution.ended_at = endedAt;
    execution.error_ref = `preconditions:${failures.join("|")}`;
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: selectedAction.action_type === "call_tool" ? "tool_execution" : "reasoning",
      state: "failed",
      summary: "Action preconditions not met",
      detail: summary,
      data: {
        action_id: selectedAction.action_id,
        action_type: selectedAction.action_type,
        precondition_failures: failures
      }
    });

    const observation: Observation = {
      observation_id: generateId("obs"),
      session_id: sessionId,
      cycle_id: cycle.cycleId,
      source_action_id: selectedAction.action_id,
      source_type: "runtime",
      status: "failure",
      summary,
      structured_payload: {
        precondition_failures: failures
      },
      created_at: endedAt
    };

    const { predictionErrors, calibrationRecord, createdReflectionRule } = await this.recordObservation(
      profile,
      session,
      input,
      cycle.cycleId,
      selectedAction,
      observation,
      "failure",
      cycle.predictions,
      execution,
      cycle.metaAssessment,
      cycle.metaSignalFrame,
      deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, selectedAction)
    );
    const sessionState = this.updateSessionState(sessionId, "waiting").state;
    const trace = this.recordTrace({
      sessionId,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      predictionErrors,
      selectedAction,
      selectedActionId: selectedAction.action_id,
      actionExecution: execution,
      observation,
      workspace: cycle.workspace,
      calibrationRecord,
      createdReflectionRule,
      ...toMetaTraceFields(cycle),
      startedAt
    });
    this.maybeCreateCheckpoint(profile, sessionId);
    this.persistSessionState(sessionId);
    return {
      sessionId,
      cycleId: cycle.cycleId,
      sessionState,
      selectedAction,
      actionExecution: execution,
      observation,
      outputText: summary,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors,
      calibrationRecord
    };
  }

  private buildResponseContext(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): import("@neurocore/protocol").ModuleContext {
    const autonomyState = this.autonomyStates.get(session.session_id);
    return {
      tenant_id: session.tenant_id,
      session: { ...session, current_cycle_id: cycle.cycleId },
      profile,
      goals: this.goals.list(session.session_id),
      workspace: cycle.workspace,
      runtime_state: {
        current_input_content: input.content,
        current_input_parts: input.content_parts ?? [],
        current_input_metadata: input.metadata ?? null,
        current_input_structured_response: input.structured_response ?? null,
        autonomy_state: autonomyState ? structuredClone(autonomyState) : null,
        autonomy_plan_summary: autonomyState?.active_plan?.summary ?? null,
        autonomy_current_phase: autonomyState?.active_plan?.phase ?? null,
        autonomy_health_status: autonomyState?.health_report?.overall_status ?? null,
        autonomy_transfer_confidence: autonomyState?.latest_transfer?.confidence ?? null,
        autonomy_curriculum_stage: autonomyState?.curriculum_stage?.name ?? null,
        ...buildConversationRuntimeState(this.getTraceRecords(session.session_id), profile, input.content),
        current_selected_action_id: selectedAction.action_id,
        memory_recall_proposals: cycle.proposals.filter((proposal) => proposal.proposal_type === "memory_recall"),
        skill_match_proposals: cycle.proposals.filter((proposal) => proposal.proposal_type === "skill_match")
      },
      services: {
        now: nowIso,
        generateId
      },
      memory_config: profile.memory_config
    };
  }

  private async streamTextAction(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): Promise<string> {
    const ctx = this.buildResponseContext(profile, session, input, cycle, selectedAction);
    const hasOutputScreening = this.policyProviders.some(
      (policy) => typeof policy.evaluateOutput === "function"
    );

    if (!hasOutputScreening) {
      let text = "";
      for await (const delta of this.reasoner.streamText(ctx, selectedAction)) {
        if (!delta) {
          continue;
        }
        text += delta;
        this.emitRuntimeOutput(session, {
          cycle_id: cycle.cycleId,
          action_id: selectedAction.action_id,
          action_type: selectedAction.action_type as "respond" | "ask_user",
          state: "delta",
          mode: "token_stream",
          delta,
          text
        });
      }
      this.emitRuntimeOutput(session, {
        cycle_id: cycle.cycleId,
        action_id: selectedAction.action_id,
        action_type: selectedAction.action_type as "respond" | "ask_user",
        state: "completed",
        mode: "token_stream",
        delta: "",
        text
      });
      return text;
    }

    let bufferedText = "";
    const bufferedDeltas: string[] = [];
    for await (const delta of this.reasoner.streamText(ctx, selectedAction)) {
      if (!delta) {
        continue;
      }
      bufferedText += delta;
      bufferedDeltas.push(delta);
    }

    const outputPolicies = await this.evaluateOutputPolicies(
      ctx,
      selectedAction,
      bufferedText
    );
    if (outputPolicies.length > 0) {
      cycle.workspace = {
        ...cycle.workspace,
        policy_decisions: [...(cycle.workspace.policy_decisions ?? []), ...outputPolicies]
      };
    }
    const blockedDecision = outputPolicies.find(
      (decision) => decision.level === "block" || decision.severity >= 30
    );
    const text = blockedDecision
      ? blockedDecision.recommendation?.trim() || "I can't provide that response."
      : bufferedText;
    const deltas = blockedDecision ? [text] : bufferedDeltas;
    let emittedText = "";
    for (const delta of deltas) {
      if (!delta) {
        continue;
      }
      emittedText += delta;
      this.emitRuntimeOutput(session, {
        cycle_id: cycle.cycleId,
        action_id: selectedAction.action_id,
        action_type: selectedAction.action_type as "respond" | "ask_user",
        state: "delta",
        mode: "buffered",
        delta,
        text: emittedText
      });
    }
    this.emitRuntimeOutput(session, {
      cycle_id: cycle.cycleId,
      action_id: selectedAction.action_id,
      action_type: selectedAction.action_type as "respond" | "ask_user",
      state: "completed",
      mode: "buffered",
      delta: "",
      text
    });
    return text;
  }

  private async evaluateOutputPolicies(
    ctx: import("@neurocore/protocol").ModuleContext,
    action: CandidateAction,
    text: string
  ): Promise<import("@neurocore/protocol").PolicyDecision[]> {
    const settled = await Promise.allSettled(
      this.policyProviders
        .filter((policy) => typeof policy.evaluateOutput === "function")
        .map((policy) =>
          policy.evaluateOutput!(ctx, {
            action,
            text,
            ask_user_schema: action.ask_user_schema
          })
        )
    );

    return settled
      .filter((result): result is PromiseFulfilledResult<import("@neurocore/protocol").PolicyDecision[]> => {
        if (result.status === "rejected") {
          debugLog("runtime", "Output policy screening failed", {
            sessionId: ctx.session.session_id,
            actionId: action.action_id,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          });
          return false;
        }
        return true;
      })
      .map((result) => result.value)
      .flat();
  }

  private selectParallelToolActions(
    profile: AgentProfile,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): CandidateAction[] {
    if (selectedAction.action_type !== "call_tool") {
      return [selectedAction];
    }
    if (
      profile.runtime_config.allow_parallel_modules !== true &&
      profile.runtime_config.allow_async_tools !== true
    ) {
      return [selectedAction];
    }
    if (selectedAction.source_proposal_id) {
      return [selectedAction];
    }

    const blockedIds = new Set(
      (cycle.workspace.policy_decisions ?? [])
        .filter((decision) => decision.level === "block" && typeof decision.target_id === "string")
        .map((decision) => decision.target_id as string)
    );

    const candidates = cycle.actions.filter((action) =>
      action.action_type === "call_tool" &&
      !action.source_proposal_id &&
      !blockedIds.has(action.action_id) &&
      action.side_effect_level !== "high" &&
      action.side_effect_level !== "medium"
    );
    const deduped = new Map<string, CandidateAction>();
    for (const action of candidates) {
      deduped.set(action.action_id, action);
    }
    deduped.set(selectedAction.action_id, selectedAction);

    const ordered = cycle.actions.filter((action) => deduped.has(action.action_id));
    const primary = ordered.find((action) => action.action_id === selectedAction.action_id);
    const rest = ordered.filter((action) => action.action_id !== selectedAction.action_id).slice(0, 3);
    return primary ? [primary, ...rest] : [selectedAction];
  }

  private async executeParallelToolActions(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    startedAt: string,
    cycle: ExecutionCycleState,
    actions: CandidateAction[]
  ): Promise<AgentRunResult> {
    const primaryAction = actions[0];
    const sessionId = session.session_id;
    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "tool_execution",
      state: "started",
      summary: `Calling ${actions.length} tools in parallel`,
      detail: actions.map((action) => action.tool_name ?? action.title).join(", "),
      data: {
        action_ids: actions.map((action) => action.action_id),
        tool_names: actions.map((action) => action.tool_name)
      }
    });

    const outcomes = await Promise.all(
      actions.map((action) => this.executeToolActionLeaf(profile, session, input, cycle, action, startedAt))
    );

    const aggregateObservation = buildParallelToolObservation(session, cycle.cycleId, primaryAction, outcomes);
    const aggregateExecution = buildRuntimeActionExecution(
      session,
      cycle.cycleId,
      primaryAction,
      outcomes.some((outcome) => outcome.execution.status === "failed") ? "failed" : "succeeded"
    );
    aggregateExecution.started_at = startedAt;
    aggregateExecution.ended_at = nowIso();
    aggregateExecution.metrics = {
      latency_ms: Math.max(0, Date.parse(aggregateExecution.ended_at) - Date.parse(startedAt)),
      attempt_count: outcomes.length,
      retry_count: 0
    };

    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "tool_execution",
      state: outcomes.some((outcome) => outcome.observation.status === "failure") ? "failed" : "completed",
      summary: `Parallel tool batch finished`,
      detail: aggregateObservation.summary,
      data: {
        action_id: primaryAction.action_id,
        action_count: actions.length,
        success_count: outcomes.filter((outcome) => outcome.observation.status !== "failure").length,
        failure_count: outcomes.filter((outcome) => outcome.observation.status === "failure").length
      }
    });

    const sessionState = this.updateSessionState(sessionId, "waiting").state;
    const trace = this.recordTrace({
      sessionId,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      predictionErrors: outcomes.flatMap((outcome) => outcome.predictionErrors),
      selectedAction: primaryAction,
      selectedActionId: primaryAction.action_id,
      actionExecution: aggregateExecution,
      observation: aggregateObservation,
      workspace: cycle.workspace,
      calibrationRecord: outcomes.map((outcome) => outcome.calibrationRecord).find(Boolean),
      createdReflectionRule: outcomes.map((outcome) => outcome.createdReflectionRule).find(Boolean),
      ...toMetaTraceFields(cycle),
      startedAt
    });
    this.maybeCreateCheckpoint(profile, sessionId);
    this.persistSessionState(sessionId);

    return {
      sessionId,
      cycleId: cycle.cycleId,
      sessionState,
      selectedAction: primaryAction,
      actionExecution: aggregateExecution,
      observation: aggregateObservation,
      outputText: aggregateObservation.summary,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors: outcomes.flatMap((outcome) => outcome.predictionErrors),
      calibrationRecord: outcomes.map((outcome) => outcome.calibrationRecord).find(Boolean),
      createdReflectionRule: outcomes.map((outcome) => outcome.createdReflectionRule).find(Boolean)
    };
  }

  private async executeToolActionLeaf(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    cycle: ExecutionCycleState,
    action: CandidateAction,
    startedAt: string
  ): Promise<ToolActionExecutionOutcome> {
    const preconditionFailures = this.evaluateActionPreconditions(session, input, action);
    if (preconditionFailures.length > 0) {
      const endedAt = nowIso();
      const execution = buildRuntimeActionExecution(session, cycle.cycleId, action, "failed");
      execution.started_at = startedAt;
      execution.ended_at = endedAt;
      execution.error_ref = `preconditions:${preconditionFailures.join("|")}`;
      const observation: Observation = {
        observation_id: generateId("obs"),
        session_id: session.session_id,
        cycle_id: cycle.cycleId,
        source_action_id: action.action_id,
        source_type: "runtime",
        status: "failure",
        summary: `Preconditions not met: ${preconditionFailures.join(", ")}`,
        structured_payload: {
          precondition_failures: preconditionFailures
        },
        created_at: endedAt
      };
      this.emitEvent(session, "action.executed", execution, cycle.cycleId);
      const recorded = await this.recordObservation(
        profile,
        session,
        input,
        cycle.cycleId,
        action,
        observation,
        "failure",
        cycle.predictions.filter((prediction) => prediction.action_id === action.action_id),
        execution,
        cycle.metaAssessment,
        cycle.metaSignalFrame,
        deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, action)
      );
      return {
        action,
        execution,
        observation,
        predictionErrors: recorded.predictionErrors,
        calibrationRecord: recorded.calibrationRecord,
        createdReflectionRule: recorded.createdReflectionRule
      };
    }

    const matchedSkillProposal = findSkillProposal(cycle.proposals, action);
    const { execution, observation } = await this.tools.execute(
      action,
      {
        tenant_id: session.tenant_id,
        session_id: session.session_id,
        cycle_id: cycle.cycleId
      },
      {
        defaultExecution: {
          timeout_ms: profile.runtime_config.default_sync_timeout_ms,
          ...(profile.runtime_config.tool_execution ?? {})
        }
      }
    );
    const observationWithSkill = matchedSkillProposal
      ? {
          ...observation,
          structured_payload: {
            ...(observation.structured_payload ?? {}),
            skill_id:
              typeof matchedSkillProposal.payload.skill_id === "string"
                ? matchedSkillProposal.payload.skill_id
                : undefined,
            skill_name:
              typeof matchedSkillProposal.payload.skill_name === "string"
                ? matchedSkillProposal.payload.skill_name
                : undefined
          }
        }
      : observation;
    if (matchedSkillProposal) {
      this.emitEvent(session, "skill.executed", execution, cycle.cycleId);
    }
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    this.sessions.incrementToolCallUsed(session.session_id);
    const recorded = await this.recordObservation(
      profile,
      session,
      input,
      cycle.cycleId,
      action,
      observationWithSkill,
      observationWithSkill.status === "failure" ? "failure" : "partial",
      cycle.predictions.filter((prediction) => prediction.action_id === action.action_id),
      execution,
      cycle.metaAssessment,
      cycle.metaSignalFrame,
      deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, action)
    );
    return {
      action,
      execution,
      observation: observationWithSkill,
      predictionErrors: recorded.predictionErrors,
      calibrationRecord: recorded.calibrationRecord,
      createdReflectionRule: recorded.createdReflectionRule
    };
  }

  private async executeDelegateAction(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    startedAt: string,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): Promise<AgentRunResult> {
    const sessionId = session.session_id;
    const execution = buildRuntimeActionExecution(session, cycle.cycleId, selectedAction, "running");
    execution.started_at = nowIso();

    let observation: Observation;
    if (this.taskDelegator) {
      const args = selectedAction.tool_args ?? {};
      const request: import("@neurocore/multi-agent").DelegationRequest = {
        delegation_id: generateId("del"),
        source_agent_id: profile.agent_id,
        source_session_id: sessionId,
        source_cycle_id: cycle.cycleId,
        source_goal_id: this.goals.active(sessionId)[0]?.goal_id ?? "",
        tenant_id: session.tenant_id,
        mode: (args.delegation_mode as import("@neurocore/multi-agent").DelegationMode) ?? "unicast",
        target_agent_id: args.target_agent_id as string | undefined,
        target_capabilities: args.target_capabilities as string[] | undefined,
        target_domains: args.target_domains as string[] | undefined,
        goal: (args.goal as import("@neurocore/multi-agent").DelegationRequest["goal"]) ?? {
          title: selectedAction.title,
          goal_type: "task",
          priority: 1
        },
        timeout_ms:
          (args.timeout_ms as number) ??
          ((args.delegation_mode as import("@neurocore/multi-agent").DelegationMode) === "auction"
            ? profile.multi_agent_config?.auction_timeout_ms
            : profile.multi_agent_config?.delegation_timeout_ms) ??
          60_000,
        max_depth: (args.max_depth as number) ?? profile.multi_agent_config?.max_delegation_depth ?? 3,
        current_depth:
          (args.current_depth as number) ??
          getMetadataNumber(input.metadata, "delegation_depth") ??
          0,
        context: args.context as Record<string, unknown> | undefined,
        created_at: nowIso()
      };

      try {
        this.emitEvent(session, "delegation.requested", selectedAction, cycle.cycleId);
        const response = await this.taskDelegator.delegate(request);
        execution.status = response.status === "completed" || response.status === "accepted" ? "succeeded" : "failed";
        execution.ended_at = nowIso();

        observation = {
          observation_id: generateId("obs"),
          session_id: sessionId,
          cycle_id: cycle.cycleId,
          source_action_id: selectedAction.action_id,
          source_type: "runtime",
          status: response.result?.status === "success" ? "success" : response.status === "completed" || response.status === "accepted" ? "partial" : "failure",
          summary: response.result?.summary ?? `Delegation ${response.status}: ${response.error ?? ""}`,
          structured_payload: {
            delegation_id: response.delegation_id,
            delegation_status: response.status,
            assigned_agent_id: response.assigned_agent_id,
            assigned_session_id: response.assigned_session_id,
            result: response.result,
            bids: response.bids,
            selected_bid: response.selected_bid,
            goal: structuredClone(request.goal),
            context: request.context ? structuredClone(request.context) : undefined
          },
          created_at: nowIso()
        };
        this.emitEvent(session, toDelegationEventType(response.status), observation, cycle.cycleId);
      } catch (err) {
        execution.status = "failed";
        execution.ended_at = nowIso();
        observation = {
          observation_id: generateId("obs"),
          session_id: sessionId,
          cycle_id: cycle.cycleId,
          source_action_id: selectedAction.action_id,
          source_type: "runtime",
          status: "failure",
          summary: `Delegation failed: ${err instanceof Error ? err.message : String(err)}`,
          created_at: nowIso()
        };
        this.emitEvent(session, "delegation.failed", observation, cycle.cycleId);
      }
    } else {
      execution.status = "failed";
      execution.ended_at = nowIso();
      observation = {
        observation_id: generateId("obs"),
        session_id: sessionId,
        cycle_id: cycle.cycleId,
        source_action_id: selectedAction.action_id,
        source_type: "runtime",
        status: "failure",
        summary: "Delegate action unavailable: no TaskDelegator configured in runtime",
        created_at: nowIso()
      };
      this.emitEvent(session, "delegation.failed", observation, cycle.cycleId);
    }

    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "tool_execution",
      state: observation.status === "failure" ? "failed" : "completed",
      summary: selectedAction.action_type === "delegate" ? "Delegation finished" : "Runtime action finished",
      detail: observation.summary,
      data: {
        action_id: selectedAction.action_id,
        action_type: selectedAction.action_type,
        status: execution.status,
        observation_status: observation.status
      }
    });
    const { predictionErrors, calibrationRecord, createdReflectionRule } = await this.recordObservation(
      profile, session, input, cycle.cycleId, selectedAction, observation,
      observation.status === "failure" ? "failure" : "partial",
      cycle.predictions, execution, cycle.metaAssessment, cycle.metaSignalFrame,
      deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, selectedAction)
    );

    const sessionState = this.updateSessionState(sessionId, "waiting").state;
    const trace = this.recordTrace({
      sessionId,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      predictionErrors,
      selectedAction,
      selectedActionId: selectedAction.action_id,
      actionExecution: execution,
      observation,
      workspace: cycle.workspace,
      calibrationRecord,
      createdReflectionRule,
      ...toMetaTraceFields(cycle),
      startedAt
    });
    this.maybeCreateCheckpoint(profile, sessionId);
    this.persistSessionState(sessionId);
    return {
      sessionId,
      cycleId: cycle.cycleId,
      sessionState,
      selectedAction,
      actionExecution: execution,
      observation,
      outputText: observation.summary,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors,
      calibrationRecord
    };
  }

  private async recordObservation(
    profile: AgentProfile,
    session: NonNullable<ReturnType<SessionManager["get"]>>,
    input: UserInput,
    cycleId: string,
    action: CandidateAction,
    observation: Observation,
    outcome: Episode["outcome"],
    predictions?: Prediction[],
    execution?: ActionExecution,
    metaAssessment?: import("@neurocore/protocol").MetaAssessment,
    metaSignalFrame?: import("@neurocore/protocol").MetaSignalFrame,
    skillLearning?: {
      skill_id?: string;
      selection?: SkillSelection | null;
    }
  ): Promise<{ predictionErrors: PredictionError[]; calibrationRecord?: CalibrationRecord; createdReflectionRule?: ReflectionRule }> {
    if (profile.memory_config.working_memory_enabled !== false) {
      this.workingMemoryProvider.appendObservation(
        session.session_id,
        observation,
        deriveWorkingMemoryMaxEntries(profile),
        deriveWorkingMemoryTtlMs(profile)
      );
    }
    this.emitEvent(session, "observation.recorded", observation, cycleId);

    let predictionErrors: PredictionError[] = [];
    if (predictions && predictions.length > 0) {
      predictionErrors = computePredictionErrors({
        predictions,
        observation,
        execution,
        generateId,
        now: nowIso
      });

      for (const error of predictionErrors) {
        this.predictionStore.recordError(error);
        this.emitEvent(session, "prediction_error.recorded", error, cycleId);
      }

      for (const predictor of this.predictors) {
        if (predictor.recordError) {
          for (const error of predictionErrors) {
            await predictor.recordError(error);
          }
        }
      }
    }

    const valence = this.deriveValence(outcome, predictionErrors);
    const lessons = this.deriveLessons(predictionErrors);
    const episode = await this.persistEpisode(
      profile,
      session,
      input,
      cycleId,
      action,
      observation,
      outcome,
      valence,
      lessons
    );
    await this.learnFromEpisode({
      profile,
      session,
      cycleId,
      episode,
      predictionErrors,
      skillId: skillLearning?.skill_id,
      skillSelection: skillLearning?.selection,
      cycleMetrics: this.buildRewardCycleMetrics(session.session_id, input, observation, execution)
    });
    const calibrationRecord = this.calibrator.record({
      sessionId: session.session_id,
      cycleId,
      profile,
      input,
      action,
      observation,
      predictions,
      metaAssessment
    });
    const reflectionQuery =
      metaAssessment?.task_bucket
        ? {
            descriptor: {
              taskBucket: metaAssessment.task_bucket,
              riskLevel: inferReflectionRiskLevel(metaAssessment, action)
            }
          }
        : this.calibrator.query({
            profile,
            input,
            action,
            predictions,
            metaState: metaAssessment?.meta_state
          });
    const createdReflectionRule = this.reflectionLearner.learn({
      sessionId: session.session_id,
      cycleId,
      taskBucket: reflectionQuery?.descriptor.taskBucket,
      riskLevel: reflectionQuery?.descriptor.riskLevel,
      action,
      observation,
      metaAssessment
    });
    if (metaSignalFrame?.provenance && metaSignalFrame.provenance.length > 0) {
      this.recordProviderReliability(session.session_id, cycleId, metaSignalFrame, observation.status === "success");
    }

    debugLog("runtime", "Recorded observation into session memory", {
      sessionId: session.session_id,
      observationId: observation.observation_id,
      sourceType: observation.source_type,
      summaryPreview: observation.summary.slice(0, 160),
      episodicCount: this.episodicMemoryProvider.list(session.session_id).length,
      predictionErrorCount: predictionErrors.length,
      calibrationRecorded: Boolean(calibrationRecord),
      reflectionRuleCreated: Boolean(createdReflectionRule)
    });

    return {
      predictionErrors,
      calibrationRecord: calibrationRecord ?? undefined,
      createdReflectionRule: createdReflectionRule ?? undefined
    };
  }

  private recordProviderReliability(
    sessionId: string,
    cycleId: string,
    frame: import("@neurocore/protocol").MetaSignalFrame,
    observedSuccess: boolean
  ) {
    const statuses = new Map<string, import("@neurocore/protocol").MetaSignalProvenance["status"]>();
    for (const row of frame.provenance ?? []) {
      const key = `${row.family}:${row.provider}`;
      const current = statuses.get(key);
      statuses.set(key, worseProviderStatus(current, row.status));
    }

    for (const [key, status] of statuses) {
      const [family, provider] = key.split(":", 2);
      if (!family || !provider) {
        continue;
      }
      this.providerReliabilityStore.append({
        record_id: generateId("mpr"),
        provider,
        family,
        provider_status: status,
        observed_success: observedSuccess,
        session_id: sessionId,
        cycle_id: cycleId,
        created_at: nowIso()
      });
    }
  }

  private deriveValence(
    outcome: Episode["outcome"],
    predictionErrors: PredictionError[]
  ): Episode["valence"] {
    const hasHighSeverity = predictionErrors.some((e) => e.severity === "high");
    if (hasHighSeverity || outcome === "failure") return "negative";
    if (predictionErrors.length > 0) return "neutral";
    if (outcome === "success") return "positive";
    return "neutral";
  }

  private deriveLessons(predictionErrors: PredictionError[]): string[] {
    return predictionErrors
      .filter((e) => e.severity === "medium" || e.severity === "high")
      .map((e) => e.impact_summary ?? `${e.error_type}: prediction did not match observation.`);
  }

  private async persistEpisode(
    profile: AgentProfile,
    session: NonNullable<ReturnType<SessionManager["get"]>>,
    input: UserInput,
    cycleId: string,
    action: CandidateAction,
    observation: Observation,
    outcome: Episode["outcome"],
    valence?: Episode["valence"],
    lessons?: string[]
  ): Promise<Episode> {
    const latestEpisode = this.episodicMemoryProvider.getLatest(session.session_id);
    const traceRecord = this.getTraceRecords(session.session_id)
      .slice()
      .reverse()
      .find((record) => record.trace.cycle_id === cycleId);
    const activePlanId = this.autonomyStates.get(session.session_id)?.active_plan?.plan_id;
    const episode: Episode = {
      episode_id: `epi_${observation.observation_id}`,
      schema_version: profile.schema_version,
      session_id: session.session_id,
      trigger_summary: input.content,
      goal_refs: this.goals.active(session.session_id).map((goal) => goal.goal_id),
      plan_refs: activePlanId ? [activePlanId] : undefined,
      context_digest: input.content,
      selected_strategy: action.title,
      action_refs: [action.action_id],
      observation_refs: [observation.observation_id],
      evidence_refs: buildEpisodeEvidenceRefs(input, observation, traceRecord),
      artifact_refs: buildEpisodeArtifactRefs(cycleId, traceRecord, activePlanId),
      temporal_refs: latestEpisode
        ? [{
            relation: "previous",
            episode_id: latestEpisode.episode_id
          }]
        : undefined,
      causal_links: buildEpisodeCausalLinks(input, action, observation, traceRecord),
      activation_trace: {
        activation_count: 0,
        citation_count: 0,
        activation_sources: []
      },
      lifecycle_state: {
        status: "active",
        marked_at: observation.created_at
      },
      outcome,
      outcome_summary: observation.summary,
      valence,
      lessons: lessons && lessons.length > 0 ? lessons : undefined,
      metadata: {
        action_type: action.action_type,
        tool_name: action.tool_name,
        tool_args: action.tool_args,
        observation_source_type: observation.source_type,
        observation_payload: observation.structured_payload ?? null
      },
      created_at: observation.created_at
    };

    const ctx = buildMemoryContext(
      profile,
      session,
      this.goals.active(session.session_id),
      input,
      this.getTraceRecords(session.session_id),
      this.autonomyStates.get(session.session_id)
    );
    await Promise.all(this.memoryProviders.map(async (provider) => provider.writeEpisode(ctx, episode)));
    this.emitEvent(session, "memory.written", episode, cycleId);
    for (const card of this.semanticMemoryProvider.listCards(session.tenant_id, session.session_id)) {
      if (card.source_episode_ids.includes(episode.episode_id)) {
        this.emitEvent(session, "memory.semantic_card_created", card, cycleId);
      }
    }

    const promoted = this.proceduralMemoryProvider.getLastPromotedSkill();
    if (promoted) {
      episode.promoted_to_skill = true;
      this.emitEvent(session, "skill.promoted", promoted, cycleId);
      const skillSpec = this.proceduralMemoryProvider
        .listSkillSpecs(session.tenant_id)
        .find((spec) => spec.skill_id === promoted.skill_id);
      if (skillSpec) {
        this.emitEvent(session, "memory.skill_spec_created", skillSpec, cycleId);
      }
      this.proceduralMemoryProvider.clearLastPromotedSkill();
    }
    return episode;
  }

  private async learnFromEpisode(input: {
    profile: AgentProfile;
    session: AgentSession;
    cycleId: string;
    episode: Episode;
    predictionErrors: PredictionError[];
    skillId?: string;
    skillSelection?: SkillSelection | null;
    cycleMetrics?: {
      cycle_index?: number;
      total_latency_ms?: number;
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  }): Promise<void> {
    if (input.profile.rl_config?.enabled === false) {
      return;
    }

    const rewardSignal = await this.rewardComputer.compute(input.episode, {
      tenant_id: input.session.tenant_id,
      session_id: input.session.session_id,
      skill_id: input.skillId,
      reward_config: input.profile.rl_config?.reward,
      prediction_errors: input.predictionErrors,
      cycle_metrics: input.cycleMetrics,
      baseline_metrics: this.buildRewardBaselineMetrics(input.session.tenant_id, input.skillId)
    });
    this.rewardStore.save(rewardSignal);
    this.emitEvent(input.session, "reward.computed", rewardSignal, input.cycleId);

    if (!input.skillId) {
      return;
    }

    if (input.skillSelection?.selection_reason === "explore") {
      this.emitEvent(
        input.session,
        "exploration.triggered",
        this.toExplorationEvent(input.session, input.cycleId, input.skillSelection),
        input.cycleId
      );
    }

    if (this.skillPolicy instanceof BanditSkillPolicy) {
      this.skillPolicy.configure({
        alpha: input.profile.rl_config?.policy?.alpha
      });
    }

    const policyUpdate = await this.skillPolicy.update({
      feedback_id: generateId("plf"),
      tenant_id: input.session.tenant_id,
      session_id: input.session.session_id,
      cycle_id: input.cycleId,
      skill_id: input.skillId,
      context_key: input.skillSelection?.context_key,
      goal_type: input.skillSelection?.goal_type,
      domain: input.skillSelection?.domain,
      action_type: input.skillSelection?.action_type,
      tool_name: input.skillSelection?.tool_name,
      risk_level: input.skillSelection?.risk_level,
      reward_signal_id: rewardSignal.signal_id,
      composite_reward: rewardSignal.composite_reward,
      success: input.episode.outcome === "success",
      source: "episode",
      updated_at: nowIso()
    });
    this.emitEvent(
      input.session,
      "policy.updated",
      this.toPolicyUpdateEvent(input.session, policyUpdate),
      input.cycleId
    );

    if (input.profile.rl_config?.online_learning?.enabled !== false) {
      if (this.onlineLearner instanceof SkillOnlineLearner) {
        this.onlineLearner.configure({
          replayBufferSize: input.profile.rl_config?.online_learning?.replay_buffer_size,
          batchSize: input.profile.rl_config?.online_learning?.batch_size,
          updateIntervalEpisodes: input.profile.rl_config?.online_learning?.update_interval_episodes
        });
      }

      this.onlineLearner.observe({
        experience_id: generateId("exp"),
        tenant_id: input.session.tenant_id,
        session_id: input.session.session_id,
        cycle_id: input.cycleId,
        skill_id: input.skillId,
        reward_signal_id: rewardSignal.signal_id,
        reward: rewardSignal.composite_reward,
        td_error: policyUpdate.td_error,
        created_at: nowIso()
      });
    }

    const transferredSkillOutcome = this.proceduralMemoryProvider.reconcileTransferredSkillOutcome(
      input.session.tenant_id,
      input.skillId,
      input.episode.outcome
    );
    if (transferredSkillOutcome?.status === "pruned") {
      this.emitEvent(
        input.session,
        "skill.pruned",
        this.toSkillPruneEvent(input.session.tenant_id, transferredSkillOutcome, "validation_failed"),
        input.cycleId
      );
    }

    this.proceduralMemoryProvider.evaluateSkills(
      input.session.tenant_id,
      (skillId) => this.rewardStore.listBySkillId(input.session.tenant_id, skillId),
      input.profile,
      nowIso()
    );
    for (const evaluation of this.proceduralMemoryProvider.drainLastEvaluations()) {
      this.emitEvent(input.session, "skill.evaluated", evaluation, input.cycleId);
    }
    for (const skill of this.proceduralMemoryProvider.drainLastPrunedSkills()) {
      this.emitEvent(
        input.session,
        "skill.pruned",
        this.toSkillPruneEvent(input.session.tenant_id, skill, "evaluation_prune"),
        input.cycleId
      );
    }
  }

  private buildRewardCycleMetrics(
    sessionId: string,
    input: UserInput,
    observation: Observation,
    execution?: ActionExecution
  ): {
    cycle_index: number;
    total_latency_ms?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  } {
    const estimator = new DefaultTokenEstimator();
    const inputTokens =
      execution?.metrics?.input_tokens ??
      estimator.estimate(input.content ?? collectContentPartText(input.content_parts));
    const outputTokens =
      execution?.metrics?.output_tokens ??
      estimator.estimate([
        observation.summary,
        collectContentPartText(observation.content_parts)
      ].filter(Boolean).join("\n"));
    return {
      cycle_index: this.getTraceRecords(sessionId).length + 1,
      total_latency_ms: execution?.metrics?.latency_ms,
      total_tokens: inputTokens + outputTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };
  }

  private buildRewardBaselineMetrics(
    tenantId: string,
    skillId?: string
  ): {
    avg_cycles?: number;
    avg_latency_ms?: number;
    avg_tokens?: number;
  } | undefined {
    const baseline =
      this.rewardStore.getAverageMetrics?.({
        tenant_id: tenantId,
        skill_id: skillId,
        window_size: 20
      }) ??
      {};
    if (
      baseline.avg_cycles === undefined &&
      baseline.avg_latency_ms === undefined &&
      baseline.avg_tokens === undefined
    ) {
      return undefined;
    }
    return baseline;
  }

  private toPolicyUpdateEvent(
    session: AgentSession,
    update: import("@neurocore/protocol").PolicyUpdateResult
  ): PolicyUpdateEvent {
    const states = this.skillPolicy.listStates(session.tenant_id).filter((state) => state.skill_id === update.state.skill_id);
    const totalSelections = states.reduce((sum, state) => sum + state.selection_count, 0);
    const totalExplores = states.reduce((sum, state) => sum + state.explore_count, 0);
    return {
      tenant_id: session.tenant_id,
      updated_skills: 1,
      avg_td_error: update.td_error,
      exploration_rate: totalSelections > 0 ? totalExplores / totalSelections : 0,
      states,
      updated_at: nowIso()
    };
  }

  private toExplorationEvent(
    session: AgentSession,
    cycleId: string,
    selection: SkillSelection
  ): ExplorationEvent {
    const states = this.skillPolicy.listStates(session.tenant_id).filter((state) => state.skill_id === selection.skill_id);
    const totalSelections = states.reduce((sum, state) => sum + state.selection_count, 0);
    const totalExplores = states.reduce((sum, state) => sum + state.explore_count, 0);
    return {
      tenant_id: session.tenant_id,
      session_id: session.session_id,
      cycle_id: cycleId,
      strategy: selection.strategy ?? "epsilon_greedy",
      explored_skill_id: selection.skill_id,
      selection_reason: selection.selection_reason,
      exploration_rate: totalSelections > 0 ? totalExplores / totalSelections : 0,
      context_key: selection.context_key,
      context_resolution_level: selection.context_resolution_level,
      emitted_at: nowIso()
    };
  }

  private toSkillTransferEvent(
    session: AgentSession,
    result: import("@neurocore/protocol").SkillTransferResult
  ): SkillTransferEvent {
    const transferredSkill = this.proceduralMemoryProvider.getStore().get(result.target_skill_id);
    const metadata =
      transferredSkill?.metadata && typeof transferredSkill.metadata === "object"
        ? (transferredSkill.metadata as Record<string, unknown>)
        : undefined;
    return {
      source_skill_id: result.source_skill_id,
      transferred_skill_id: result.target_skill_id,
      tenant_id: session.tenant_id,
      source_domain: result.source_domain,
      target_domain: result.target_domain,
      similarity_score: result.similarity_score,
      confidence_penalty: typeof metadata?.confidence_penalty === "number" ? metadata.confidence_penalty : undefined,
      validation_remaining_uses:
        typeof metadata?.validation_remaining_uses === "number" ? metadata.validation_remaining_uses : undefined,
      emitted_at: nowIso()
    };
  }

  private toSkillPruneEvent(
    tenantId: string,
    skill: import("@neurocore/protocol").SkillDefinition,
    reason: string
  ): SkillPruneEvent {
    return {
      skill_id: skill.skill_id,
      tenant_id: tenantId,
      prune_mode: skill.status === "pruned" ? "soft" : "hard",
      final_status: skill.status ?? "pruned",
      reason,
      emitted_at: nowIso()
    };
  }

  private async trySkillExecution(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    startedAt: string,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): Promise<AgentRunResult | null> {
    if (!selectedAction.source_proposal_id) return null;

    const skillProposal = cycle.proposals.find(
      (p) => p.proposal_id === selectedAction.source_proposal_id && p.proposal_type === "skill_match"
    );
    if (!skillProposal) return null;

    const skillId = skillProposal.payload.skill_id;
    if (typeof skillId !== "string") return null;

    const provider = this.skillProviders.find((sp) => sp.execute);
    if (!provider) return null;

    const ctx = buildMemoryContext(
      profile,
      session,
      this.goals.active(session.session_id),
      input,
      this.getTraceRecords(session.session_id),
      this.autonomyStates.get(session.session_id)
    );
    const skillResult = await executeSkill(provider, ctx, skillId, selectedAction);
    if (!skillResult) return null;

    const { execution, observation } = skillResult;
    this.emitEvent(session, "skill.executed", execution, cycle.cycleId);
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "tool_execution",
      state: observation.status === "failure" ? "failed" : "completed",
      summary: `Tool ${selectedAction.tool_name ?? "unknown"} finished`,
      detail: observation.summary,
      data: {
        action_id: selectedAction.action_id,
        tool_name: selectedAction.tool_name,
        status: execution.status,
        observation_status: observation.status,
        skill_id: skillId
      }
    });

    const { predictionErrors, calibrationRecord, createdReflectionRule } = await this.recordObservation(
      profile, session, input, cycle.cycleId, selectedAction, observation,
      observation.status === "failure" ? "failure" : "success",
      cycle.predictions, execution, cycle.metaAssessment, cycle.metaSignalFrame,
      {
        skill_id: skillId,
        selection: this.proceduralMemoryProvider.getLastSelection()
      }
    );

    const sessionState = this.updateSessionState(session.session_id, "waiting").state;
    const trace = this.recordTrace({
      sessionId: session.session_id,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      predictionErrors,
      selectedAction,
      selectedActionId: selectedAction.action_id,
      actionExecution: execution,
      observation,
      workspace: cycle.workspace,
      calibrationRecord,
      createdReflectionRule,
      ...toMetaTraceFields(cycle),
      startedAt
    });

    debugLog("runtime", "Skill execution completed", {
      sessionId: session.session_id,
      cycleId: cycle.cycleId,
      skillId,
      providerName: provider.name
    });

    this.maybeCreateCheckpoint(profile, session.session_id);
    this.persistSessionState(session.session_id);

    return {
      sessionId: session.session_id,
      cycleId: cycle.cycleId,
      sessionState,
      selectedAction,
      actionExecution: execution,
      observation,
      outputText: observation.summary,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors,
      calibrationRecord
    };
  }

  private async tryActuatorOrchestration(
    profile: AgentProfile,
    session: AgentSession,
    input: UserInput,
    startedAt: string,
    cycle: ExecutionCycleState,
    selectedAction: CandidateAction
  ): Promise<AgentRunResult | null> {
    if (
      !this.actuatorOrchestrator ||
      !this.deviceRegistry ||
      selectedAction.tool_name !== "device.orchestrate"
    ) {
      return null;
    }

    const commands = normalizeActuatorCommands(selectedAction.tool_args?.commands);
    if (commands.length === 0) {
      return null;
    }

    const strategy = selectedAction.tool_args?.execution_strategy === "parallel" ? "parallel" : "serial";
    this.emitEvent(session, "actuator.command", selectedAction, cycle.cycleId);
    const results = await this.actuatorOrchestrator.execute(commands, this.deviceRegistry, strategy);
    const failureCount = results.filter((result) => result.status !== "completed").length;
    const observation: Observation = {
      observation_id: generateId("obs"),
      session_id: session.session_id,
      cycle_id: cycle.cycleId,
      source_action_id: selectedAction.action_id,
      source_type: "tool",
      status: failureCount > 0 ? "failure" : "success",
      summary:
        failureCount > 0
          ? `Device orchestration finished with ${failureCount} failed command(s).`
          : `Device orchestration completed ${results.length} command(s).`,
      structured_payload: {
        tool_name: selectedAction.tool_name,
        execution_strategy: strategy,
        results
      },
      created_at: nowIso()
    };
    const execution = buildRuntimeActionExecution(
      session,
      cycle.cycleId,
      selectedAction,
      failureCount > 0 ? "failed" : "succeeded"
    );
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    this.emitEvent(session, "actuator.result", observation, cycle.cycleId);
    if (failureCount > 0) {
      this.emitEvent(session, "device.error", observation, cycle.cycleId);
    }
    this.emitRuntimeStatus(session, {
      cycle_id: cycle.cycleId,
      phase: "tool_execution",
      state: failureCount > 0 ? "failed" : "completed",
      summary: "Device orchestration finished",
      detail: observation.summary,
      data: {
        action_id: selectedAction.action_id,
        tool_name: selectedAction.tool_name,
        command_count: results.length,
        failed_count: failureCount
      }
    });

    const { predictionErrors, calibrationRecord, createdReflectionRule } = await this.recordObservation(
      profile,
      session,
      input,
      cycle.cycleId,
      selectedAction,
      observation,
      failureCount > 0 ? "failure" : "partial",
      cycle.predictions,
      execution,
      cycle.metaAssessment,
      cycle.metaSignalFrame,
      deriveSkillLearningContext(this.proceduralMemoryProvider, cycle.proposals, selectedAction)
    );

    const sessionState = this.updateSessionState(session.session_id, "waiting").state;
    const trace = this.recordTrace({
      sessionId: session.session_id,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      predictionErrors,
      selectedAction,
      selectedActionId: selectedAction.action_id,
      actionExecution: execution,
      observation,
      workspace: cycle.workspace,
      calibrationRecord,
      createdReflectionRule,
      ...toMetaTraceFields(cycle),
      startedAt
    });
    this.maybeCreateCheckpoint(profile, session.session_id);
    this.persistSessionState(session.session_id);

    return {
      sessionId: session.session_id,
      cycleId: cycle.cycleId,
      sessionState,
      selectedAction,
      actionExecution: execution,
      observation,
      outputText: observation.summary,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors,
      calibrationRecord
    };
  }

  private ensureSessionLoaded(sessionId: string): void {
    if (this.sessions.get(sessionId) || !this.stateStore) {
      return;
    }

    const snapshot = this.stateStore.getSession(sessionId);
    if (!snapshot) {
      return;
    }

    this.hydratePersistedSession(snapshot);
  }

  private ensureAllPersistedSessionsLoaded(): void {
    if (!this.stateStore) {
      return;
    }

    for (const snapshot of this.stateStore.listSessions()) {
      if (!this.sessions.get(snapshot.session.session_id)) {
        this.hydratePersistedSession(snapshot);
      }
    }
  }

  private requireSession(sessionId: string): AgentSession {
    this.ensureSessionLoaded(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private hydratePersistedSession(snapshot: RuntimeSessionSnapshot): void {
    validateRuntimeSessionSnapshot(snapshot);
    assertNoLegacyRuntimeSnapshotPayload(snapshot);
    const sessionId = snapshot.session.session_id;
    this.sessions.hydrate(structuredClone(snapshot.session));
    this.goals.hydrate(sessionId, structuredClone(snapshot.goals));
    this.replaceAutonomyState(sessionId, snapshot.autonomy_state);
    this.hydrateProceduralStateFromPersistedEpisodes(sessionId, snapshot.session.tenant_id);
    this.traceRecorder.getStore().replaceSession(sessionId, structuredClone(snapshot.trace_records));

    for (const approval of snapshot.approvals) {
      this.approvals.set(approval.approval_id, structuredClone(approval));
    }

    for (const pending of snapshot.pending_approvals) {
      this.pendingApprovals.set(pending.approval_id, fromPendingApprovalSnapshot(pending));
    }

    this.eventBus.replaceSession(sessionId, []);
    this.eventSequences.delete(sessionId);
  }

  private restoreCheckpointMemory(checkpoint: SessionCheckpoint, tenantId: string): void {
    const sessionId = checkpoint.session.session_id;
    if (checkpoint.working_memory !== undefined) {
      this.workingMemoryProvider.replace(
        sessionId,
        structuredClone(checkpoint.working_memory)
      );
    }

    if (checkpoint.episodes !== undefined) {
      const episodes = structuredClone(checkpoint.episodes);
      this.episodicMemoryProvider.replace(sessionId, tenantId, episodes);
      this.semanticMemoryProvider.replaceSession(sessionId, tenantId, structuredClone(episodes));
      if (checkpoint.procedural_memory === undefined && this.memoryPersistence?.skillStore !== undefined) {
        this.proceduralMemoryProvider.hydrateSession(sessionId, tenantId, structuredClone(episodes));
      } else {
        this.proceduralMemoryProvider.replaceSession(sessionId, tenantId, structuredClone(episodes));
      }
    } else {
      this.hydrateProceduralStateFromPersistedEpisodes(sessionId, tenantId);
    }

    if (checkpoint.semantic_memory !== undefined) {
      this.semanticMemoryProvider.restoreSnapshot(
        sessionId,
        tenantId,
        structuredClone(checkpoint.semantic_memory)
      );
    }

    if (checkpoint.procedural_memory !== undefined) {
      this.proceduralMemoryProvider.restoreSnapshot(
        tenantId,
        structuredClone(checkpoint.procedural_memory)
      );
    }
  }

  private hydrateProceduralStateFromPersistedEpisodes(sessionId: string, tenantId: string): void {
    if (!this.memoryPersistence?.episodic || !this.memoryPersistence?.skillStore) {
      return;
    }

    const episodes = this.episodicMemoryProvider.list(sessionId);
    if (episodes.length > 0) {
      this.proceduralMemoryProvider.hydrateSession(sessionId, tenantId, structuredClone(episodes));
    }
  }

  private persistSessionState(sessionId: string): boolean {
    if (!this.stateStore) {
      return false;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const snapshot: RuntimeSessionSnapshot = {
      session: structuredClone(session),
      goals: structuredClone(this.goals.list(sessionId)),
      trace_records: structuredClone(this.traceRecorder.listRecords(sessionId)),
      approvals: structuredClone(
        [...this.approvals.values()].filter((approval) => approval.session_id === sessionId)
      ),
      pending_approvals: structuredClone(
        [...this.pendingApprovals.values()]
          .filter((pending) => this.approvals.get(pending.approval_id)?.session_id === sessionId)
          .map(toPendingApprovalSnapshot)
      ),
      autonomy_state: structuredClone(this.autonomyStates.get(sessionId))
    };

    try {
      this.stateStore.saveSession(snapshot);
      this.clearStatePersistenceDegraded(session);
      this.applySessionRetention(sessionId);
      return true;
    } catch (error) {
      this.handleStatePersistenceError(session, "save_session", error);
      return false;
    }
  }

  private applySessionRetention(protectedSessionId?: string): void {
    if (!this.stateStore) {
      return;
    }

    const protectedIds = new Set<string>(protectedSessionId ? [protectedSessionId] : []);
    const expiredSessionIds = this.sessions.collectExpiredSessionIds(Date.now(), protectedIds);
    for (const sessionId of expiredSessionIds) {
      this.evictResidentSession(sessionId, "ttl");
    }

    const lruEvictionIds = this.sessions.collectLruEvictionSessionIds(protectedIds);
    for (const sessionId of lruEvictionIds) {
      this.evictResidentSession(sessionId, "lru");
    }
  }

  private evictResidentSession(sessionId: string, reason: "ttl" | "lru"): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    for (const approval of [...this.approvals.values()]) {
      if (approval.session_id === sessionId) {
        this.approvals.delete(approval.approval_id);
        this.pendingApprovals.delete(approval.approval_id);
      }
    }

    this.goals.deleteSession(sessionId);
    this.workingMemoryProvider.evictSession(sessionId);
    this.episodicMemoryProvider.evictSession(sessionId);
    this.semanticMemoryProvider.evictSession(sessionId);
    this.traceRecorder.getStore().deleteSession?.(sessionId);
    this.autonomyPlanStore.deleteSession(sessionId);
    this.eventBus.deleteSession(sessionId);
    this.eventSequences.delete(sessionId);
    this.autonomyStates.delete(sessionId);
    this.sessions.deleteSession(sessionId);

    debugLog("runtime", "Evicted resident session state", {
      sessionId,
      reason,
      state: session.state
    });
  }

  private handleStatePersistenceError(
    session: AgentSession,
    operation: string,
    error: unknown
  ): void {
    const metadata = (session.metadata ??= {});
    const persistenceStatus =
      metadata.persistence_status && typeof metadata.persistence_status === "object"
        ? (metadata.persistence_status as Record<string, unknown>)
        : {};
    const errorCount =
      typeof persistenceStatus.error_count === "number" && Number.isFinite(persistenceStatus.error_count)
        ? persistenceStatus.error_count + 1
        : 1;

    metadata.persistence_status = {
      state: "degraded",
      operation,
      error_count: errorCount,
      last_error_at: nowIso(),
      last_error_message: error instanceof Error ? error.message : String(error)
    };

    this.emitRuntimeStatus(session, {
      phase: "session",
      state: "failed",
      summary: "State persistence degraded",
      detail: error instanceof Error ? error.message : String(error),
      data: {
        operation,
        persistence_state: "degraded",
        error_count: errorCount
      }
    });
    debugLog("runtime", "State persistence failed", {
      sessionId: session.session_id,
      operation,
      error: error instanceof Error ? error.message : String(error),
      errorCount
    });
  }

  private clearStatePersistenceDegraded(session: AgentSession): void {
    if (!session.metadata || !("persistence_status" in session.metadata)) {
      return;
    }

    const raw = session.metadata.persistence_status;
    if (!raw || typeof raw !== "object") {
      delete session.metadata.persistence_status;
      return;
    }

    const persistenceStatus = raw as Record<string, unknown>;
    if (persistenceStatus.state !== "degraded") {
      return;
    }

    session.metadata.persistence_status = {
      ...persistenceStatus,
      state: "healthy",
      recovered_at: nowIso()
    };
  }

  private replaceAutonomyState(sessionId: string, state: AutonomyState | undefined): void {
    if (state) {
      this.autonomyStates.set(sessionId, structuredClone(state));
      if (state.active_plan) {
        this.autonomyPlanStore.save(state.active_plan);
      }
      return;
    }
    this.autonomyStates.delete(sessionId);
  }
}

function buildEpisodeEvidenceRefs(
  input: UserInput,
  observation: Observation,
  traceRecord?: CycleTraceRecord
): Episode["evidence_refs"] {
  const refs: NonNullable<Episode["evidence_refs"]> = [
    {
      ref_id: input.input_id,
      ref_type: "input",
      summary: input.content
    },
    {
      ref_id: observation.observation_id,
      ref_type: "observation",
      summary: observation.summary,
      source_id: observation.source_action_id
    }
  ];
  if (traceRecord) {
    refs.push({
      ref_id: traceRecord.trace.trace_id,
      ref_type: "trace",
      summary: traceRecord.trace.selected_action_ref
    });
  }
  return refs;
}

function buildEpisodeArtifactRefs(
  cycleId: string,
  traceRecord: CycleTraceRecord | undefined,
  activePlanId: string | undefined
): Episode["artifact_refs"] {
  const refs: NonNullable<Episode["artifact_refs"]> = [];
  if (traceRecord) {
    refs.push({
      artifact_id: traceRecord.trace.trace_id,
      artifact_type: "trace",
      summary: `cycle:${cycleId}`,
      ref: traceRecord.trace.trace_id
    });
    if (traceRecord.workspace) {
      refs.push({
        artifact_id: traceRecord.workspace.workspace_id,
        artifact_type: "workspace",
        summary: traceRecord.workspace.context_summary,
        ref: traceRecord.workspace.workspace_id
      });
    }
  }
  if (activePlanId) {
    refs.push({
      artifact_id: activePlanId,
      artifact_type: "plan",
      ref: activePlanId
    });
  }
  return refs.length > 0 ? refs : undefined;
}

function buildEpisodeCausalLinks(
  input: UserInput,
  action: CandidateAction,
  observation: Observation,
  traceRecord?: CycleTraceRecord
): Episode["causal_links"] {
  const links: NonNullable<Episode["causal_links"]> = [
    {
      link_id: `${action.action_id}_caused_${observation.observation_id}`,
      source_ref: input.input_id,
      target_ref: action.action_id,
      relation: "enabled",
      summary: action.title
    },
    {
      link_id: `${action.action_id}_observed_${observation.observation_id}`,
      source_ref: action.action_id,
      target_ref: observation.observation_id,
      relation: "caused",
      summary: observation.summary
    }
  ];
  if (traceRecord?.prediction_errors?.length) {
    for (const predictionError of traceRecord.prediction_errors) {
      links.push({
        link_id: `${predictionError.prediction_error_id}_corrected`,
        source_ref: predictionError.prediction_id,
        target_ref: observation.observation_id,
        relation: "corrected",
        summary: predictionError.error_type
      });
    }
  }
  return links;
}

function deriveSqlitePersistenceFromStateStore(
  stateStore: RuntimeStateStore | undefined,
  memoryPersistence: AgentMemoryPersistence | undefined,
  checkpointStore: CheckpointStore | undefined,
  calibrationStore?: CalibrationStore,
  providerReliabilityStore?: MetaSignalProviderReliabilityStore,
  reflectionStore?: ReflectionStore,
  rewardStore?: RewardStore
): {
  memoryPersistence?: AgentMemoryPersistence;
  checkpointStore?: CheckpointStore;
  calibrationStore?: CalibrationStore;
  providerReliabilityStore?: MetaSignalProviderReliabilityStore;
  reflectionStore?: ReflectionStore;
  rewardStore?: RewardStore;
  skillPolicyStateStore?: SqliteSkillPolicyStateStore;
} {
  if (!(stateStore instanceof SqliteRuntimeStateStore)) {
    return {};
  }

  const filename = stateStore.getFilename();
  return {
    memoryPersistence: memoryPersistence ?? createSqliteMemoryPersistence({ filename }),
    checkpointStore: checkpointStore ?? new SqliteCheckpointStore({ filename }),
    calibrationStore: calibrationStore ?? new SqliteCalibrationStore({ filename }),
    providerReliabilityStore:
      providerReliabilityStore ?? new SqliteProviderReliabilityStore({ filename }),
    reflectionStore: reflectionStore ?? new SqliteReflectionStore({ filename }),
    rewardStore: rewardStore ?? new SqliteRewardStore({ filename }),
    skillPolicyStateStore: new SqliteSkillPolicyStateStore({ filename })
  };
}

function isTerminalState(state: SessionState): boolean {
  return state === "completed" || state === "failed" || state === "aborted";
}

function worseProviderStatus(
  left: import("@neurocore/protocol").MetaSignalProvenance["status"] | undefined,
  right: import("@neurocore/protocol").MetaSignalProvenance["status"]
) {
  if (!left) {
    return right;
  }
  const severity = {
    ok: 0,
    degraded: 1,
    fallback: 2,
    missing: 3
  } as const;
  return severity[right] > severity[left] ? right : left;
}

function selectAction(
  actions: CandidateAction[],
  decision: Awaited<ReturnType<CycleEngine["run"]>>["decision"]
): CandidateAction | undefined {
  if (decision.decision_type !== "execute_action" && decision.decision_type !== "request_approval") {
    return undefined;
  }

  const selectedActionId = decision.selected_action_id;
  if (!selectedActionId) {
    if (decision.decision_type === "request_approval") {
      return actions.find((action) => action.action_type === "call_tool" || action.side_effect_level === "high") ??
        actions[0];
    }
    return actions.find((action) => action.action_type === "respond" || action.action_type === "ask_user");
  }
  const match = actions.find((action) => action.action_id === selectedActionId);
  if (!match) {
    throw new Error(
      `selected_action_id "${selectedActionId}" does not match any candidate action. ` +
        `Available: [${actions.map((a) => a.action_id).join(", ")}]`
    );
  }
  return match;
}

function formatAbortDecision(decision: Awaited<ReturnType<CycleEngine["run"]>>["decision"]): string {
  if (Array.isArray(decision.rejection_reasons) && decision.rejection_reasons.length > 0) {
    return decision.rejection_reasons.join(" ");
  }
  if (typeof decision.explanation === "string" && decision.explanation.trim().length > 0) {
    return decision.explanation;
  }
  return "The runtime aborted before executing any action.";
}

function findSkillProposal(
  proposals: Proposal[],
  action: CandidateAction
): Proposal | undefined {
  if (!action.source_proposal_id) {
    return undefined;
  }

  return proposals.find(
    (proposal) =>
      proposal.proposal_id === action.source_proposal_id &&
      proposal.proposal_type === "skill_match"
  );
}

function deriveSkillLearningContext(
  provider: ProceduralMemoryProvider,
  proposals: Proposal[],
  action: CandidateAction
): { skill_id?: string; selection?: SkillSelection | null } | undefined {
  const proposal = findSkillProposal(proposals, action);
  if (!proposal || typeof proposal.payload.skill_id !== "string") {
    return undefined;
  }

  const selection = provider.getLastSelection();
  return {
    skill_id: proposal.payload.skill_id,
    selection: selection && selection.skill_id === proposal.payload.skill_id ? selection : null
  };
}

function deriveSessionState(actionType: CandidateAction["action_type"]) {
  if (actionType === "ask_user") {
    return "waiting" as const;
  }
  if (actionType === "abort") {
    return "aborted" as const;
  }
  return "completed" as const;
}

function buildSyntheticObservation(
  session: ReturnType<SessionManager["get"]> extends infer T ? NonNullable<T> : never,
  cycleId: string,
  action: CandidateAction,
  text: string
): Observation {
  const askUserPayload =
    action.action_type === "ask_user" && action.ask_user_schema
      ? { ask_user_schema: structuredClone(action.ask_user_schema) }
      : undefined;
  return {
    observation_id: `obs_${action.action_id}`,
    session_id: session.session_id,
    cycle_id: cycleId,
    source_action_id: action.action_id,
    source_type: "runtime",
    status: "success",
    summary: text,
    structured_payload: askUserPayload,
    created_at: new Date().toISOString()
  };
}

function buildRuntimeActionExecution(
  session: ReturnType<SessionManager["get"]> extends infer T ? NonNullable<T> : never,
  cycleId: string,
  action: CandidateAction,
  status: ActionExecution["status"]
): ActionExecution {
  const timestamp = nowIso();
  return {
    execution_id: generateId("exe"),
    session_id: session.session_id,
    cycle_id: cycleId,
    action_id: action.action_id,
    status,
    started_at: timestamp,
    ended_at: timestamp,
    executor: "runtime"
  };
}

function normalizeActuatorCommands(value: unknown): ActuatorCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.actuator_id !== "string" || typeof candidate.command_type !== "string") {
      return [];
    }
    return [{
      command_id:
        typeof candidate.command_id === "string" ? candidate.command_id : `cmd-${Date.now()}-${index}`,
      actuator_id: candidate.actuator_id,
      command_type: candidate.command_type,
      parameters:
        candidate.parameters && typeof candidate.parameters === "object" && !Array.isArray(candidate.parameters)
          ? structuredClone(candidate.parameters as Record<string, unknown>)
          : {},
      timeout_ms: typeof candidate.timeout_ms === "number" ? candidate.timeout_ms : undefined,
      priority: typeof candidate.priority === "number" ? candidate.priority : undefined,
      preconditions: Array.isArray(candidate.preconditions)
        ? candidate.preconditions.filter((item): item is string => typeof item === "string")
        : undefined,
      safety_constraints:
        candidate.safety_constraints &&
        typeof candidate.safety_constraints === "object" &&
        !Array.isArray(candidate.safety_constraints)
          ? structuredClone(candidate.safety_constraints as Record<string, unknown>)
          : undefined
    }];
  });
}

function buildParallelToolObservation(
  session: ReturnType<SessionManager["get"]> extends infer T ? NonNullable<T> : never,
  cycleId: string,
  primaryAction: CandidateAction,
  outcomes: ToolActionExecutionOutcome[]
): Observation {
  const failureCount = outcomes.filter((outcome) => outcome.observation.status === "failure").length;
  return {
    observation_id: generateId("obs"),
    session_id: session.session_id,
    cycle_id: cycleId,
    source_action_id: primaryAction.action_id,
    source_type: "tool",
    status:
      failureCount === outcomes.length
        ? "failure"
        : "partial",
    summary: `Parallel tool observations: ${outcomes
      .map((outcome) => `${outcome.action.tool_name ?? outcome.action.title}: ${outcome.observation.summary}`)
      .join(" | ")}`,
    structured_payload: {
      parallel_results: outcomes.map((outcome) => ({
        action_id: outcome.action.action_id,
        tool_name: outcome.action.tool_name,
        status: outcome.observation.status,
        summary: outcome.observation.summary
      }))
    },
    created_at: nowIso()
  };
}

function shouldContinue(step: AgentRunResult): boolean {
  if (step.sessionState !== "waiting" || !step.observation) {
    return false;
  }

  if (step.selectedAction?.action_type === "call_tool") {
    return true;
  }

  if (step.selectedAction?.action_type === "delegate") {
    const status = step.observation.structured_payload?.delegation_status;
    return (
      status === "completed" ||
      status === "failed" ||
      status === "rejected" ||
      status === "timeout"
    );
  }

  return false;
}

function observationToInput(
  observation?: Observation,
  actionType: CandidateAction["action_type"] = "call_tool"
): UserInput {
  if (!observation) {
    throw new Error("Cannot continue without an observation to feed into the next cycle.");
  }

  const isDelegation = actionType === "delegate";
  const delegationPayload = observation.structured_payload;

  return {
    input_id: `inp_${observation.observation_id}`,
    content: `${isDelegation ? "Delegation" : "Tool"} observation: ${observation.summary}`,
    created_at: observation.created_at,
    content_parts: observation.content_parts ? structuredClone(observation.content_parts) : undefined,
    metadata: {
      sourceObservationId: observation.observation_id,
      sourceType: observation.source_type,
      sourceObservationStatus: observation.status,
      sourceActionType: actionType,
      sourceObservationMimeType: observation.mime_type,
      sourceToolName:
        typeof delegationPayload?.tool_name === "string"
          ? delegationPayload.tool_name
          : undefined,
      sourceToolArgs:
        delegationPayload?.tool_args &&
        typeof delegationPayload.tool_args === "object" &&
        !Array.isArray(delegationPayload.tool_args)
          ? structuredClone(delegationPayload.tool_args as Record<string, unknown>)
          : undefined,
      sourceActionId: observation.source_action_id,
      delegation_status:
        typeof delegationPayload?.delegation_status === "string"
          ? delegationPayload.delegation_status
          : undefined,
      assigned_agent_id:
        typeof delegationPayload?.assigned_agent_id === "string"
          ? delegationPayload.assigned_agent_id
          : undefined,
      assigned_session_id:
        typeof delegationPayload?.assigned_session_id === "string"
          ? delegationPayload.assigned_session_id
          : undefined
    }
  };
}

function derivePendingInput(
  records: CycleTraceRecord[],
  session: ReturnType<SessionManager["get"]> extends infer T ? NonNullable<T> : never
): UserInput | undefined {
  if (session.state !== "waiting" && session.state !== "suspended" && session.state !== "hydrated") {
    return undefined;
  }

  const lastRecord = records.at(-1);
  const lastActionType = lastRecord?.selected_action?.action_type;
  if (
    !lastRecord?.observation ||
    (lastActionType !== "call_tool" && lastActionType !== "delegate")
  ) {
    return undefined;
  }

  return observationToInput(lastRecord.observation, lastActionType);
}

function toDelegationEventType(
  status: string
): "delegation.accepted" | "delegation.rejected" | "delegation.completed" | "delegation.failed" | "delegation.timeout" {
  if (status === "accepted") {
    return "delegation.accepted";
  }
  if (status === "rejected") {
    return "delegation.rejected";
  }
  if (status === "timeout") {
    return "delegation.timeout";
  }
  if (status === "completed") {
    return "delegation.completed";
  }
  return "delegation.failed";
}

function derivePendingAskUserSchema(
  records: CycleTraceRecord[],
  session: ReturnType<SessionManager["get"]> extends infer T ? NonNullable<T> : never
): AskUserPromptSchema | undefined {
  if (session.state !== "waiting" && session.state !== "suspended" && session.state !== "hydrated") {
    return undefined;
  }

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.selected_action?.action_type !== "ask_user") {
      continue;
    }
    if (isAskUserPromptSchema(record.selected_action.ask_user_schema)) {
      return structuredClone(record.selected_action.ask_user_schema);
    }
    const schema = record.observation?.structured_payload?.ask_user_schema;
    if (isAskUserPromptSchema(schema)) {
      return structuredClone(schema);
    }
    break;
  }

  return undefined;
}

function getMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function getCompletedActionIds(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.completed_action_ids;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function resolvePlannedActionSelection(
  actions: CandidateAction[],
  selectedAction: CandidateAction | undefined
): CandidateAction | undefined {
  if (!selectedAction) {
    return undefined;
  }

  if (hasSatisfiedActionDependencies(selectedAction, [])) {
    return selectedAction;
  }

  const sameGroupReady = actions.find((action) =>
    action.plan_group_id &&
    action.plan_group_id === selectedAction.plan_group_id &&
    hasSatisfiedActionDependencies(action, [])
  );
  if (sameGroupReady) {
    return sameGroupReady;
  }

  const firstReady = actions.find((action) => hasSatisfiedActionDependencies(action, []));
  return firstReady ?? selectedAction;
}

function resolveFailureFallbackAction(
  actions: CandidateAction[],
  selectedAction: CandidateAction,
  completedActionIds: string[]
): CandidateAction | undefined {
  const nextActionId =
    typeof selectedAction.next_action_id_on_failure === "string" &&
    selectedAction.next_action_id_on_failure.trim().length > 0
      ? selectedAction.next_action_id_on_failure
      : undefined;
  if (!nextActionId) {
    return undefined;
  }

  const fallback = actions.find((action) => action.action_id === nextActionId);
  if (!fallback) {
    return undefined;
  }

  return hasSatisfiedActionDependencies(fallback, completedActionIds) ? fallback : undefined;
}

function hasSatisfiedActionDependencies(
  action: CandidateAction,
  completedActionIds: string[]
): boolean {
  const dependencies = Array.isArray(action.depends_on_action_ids) ? action.depends_on_action_ids : [];
  if (dependencies.length === 0) {
    return true;
  }
  const completed = new Set(completedActionIds);
  return dependencies.every((dependencyId) => completed.has(dependencyId));
}

function buildMemoryContext(
  profile: AgentProfile,
  session: NonNullable<ReturnType<SessionManager["get"]>>,
  goals: ReturnType<GoalManager["active"]>,
  input: UserInput,
  traceRecords: CycleTraceRecord[] = [],
  autonomyState?: AutonomyState
) {
  return {
    tenant_id: session.tenant_id,
    session,
    profile,
    goals,
    runtime_state: {
      current_input_content: input.content,
      current_input_parts: input.content_parts ?? [],
      current_input_metadata: input.metadata ?? null,
      current_input_structured_response: input.structured_response ?? null,
      autonomy_state: autonomyState ? structuredClone(autonomyState) : null,
      autonomy_plan_summary: autonomyState?.active_plan?.summary ?? null,
      autonomy_current_phase: autonomyState?.active_plan?.phase ?? null,
      autonomy_health_status: autonomyState?.health_report?.overall_status ?? null,
      autonomy_transfer_confidence: autonomyState?.latest_transfer?.confidence ?? null,
      autonomy_curriculum_stage: autonomyState?.curriculum_stage?.name ?? null,
      ...buildConversationRuntimeState(traceRecords, profile, input.content)
    },
    services: {
      now: nowIso,
      generateId
    }
  };
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

function createAutonomyState(schemaVersion: string, sessionId: string): AutonomyState {
  return {
    schema_version: schemaVersion,
    session_id: sessionId,
    plan_history: [],
    suggested_goals: [],
    drift_signals: [],
    recovery_queue: [],
    updated_at: nowIso()
  };
}

function shouldRunAutonomyMaintenance(profile: AgentProfile): boolean {
  const config = profile.autonomy_config;
  return Boolean(
    config?.monitor_enabled === true ||
    config?.self_goal_enabled === true ||
    config?.transfer_enabled === true ||
    config?.continual_learning_enabled === true
  );
}

function measureFailureRate(traceRecords: CycleTraceRecord[]): number {
  const terminal = traceRecords.filter((record) => record.observation);
  if (terminal.length === 0) {
    return 0;
  }
  const failures = terminal.filter((record) => record.observation?.status === "failure").length;
  return failures / terminal.length;
}

function measureSuccessRate(traceRecords: CycleTraceRecord[]): number {
  const terminal = traceRecords.filter((record) => record.observation);
  if (terminal.length === 0) {
    return 0;
  }
  const successes = terminal.filter((record) => record.observation?.status === "success").length;
  return successes / terminal.length;
}

function measureTimeoutRate(traceRecords: CycleTraceRecord[]): number {
  const executions = traceRecords.filter((record) => record.action_execution);
  if (executions.length === 0) {
    return 0;
  }
  const timeouts = executions.filter((record) => {
    const errorRef = record.action_execution?.error_ref;
    return typeof errorRef === "string" && errorRef.toLowerCase().includes("timeout");
  }).length;
  return timeouts / executions.length;
}

function computeSkillCoverage(goals: Goal[], skills: import("@neurocore/protocol").SkillDefinition[]): number {
  const activeGoals = goals.filter((goal) => !isTerminalGoalStatus(goal.status));
  if (activeGoals.length === 0) {
    return skills.length > 0 ? 1 : 0;
  }
  const goalTypes = new Set(activeGoals.map((goal) => goal.goal_type));
  const coveredGoalTypes = new Set<string>();
  for (const skill of skills) {
    const metadata =
      skill.metadata && typeof skill.metadata === "object"
        ? (skill.metadata as Record<string, unknown>)
        : undefined;
    const patternKey = typeof metadata?.pattern_key === "string" ? metadata.pattern_key : undefined;
    for (const goalType of goalTypes) {
      if (patternKey?.includes(goalType) || skill.description?.toLowerCase().includes(goalType)) {
        coveredGoalTypes.add(goalType);
      }
    }
  }
  return coveredGoalTypes.size / goalTypes.size;
}

function isTerminalGoalStatus(status: Goal["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function toRecoveryRecommendation(
  action: import("@neurocore/protocol").RecoveryAction
): RecoveryRecommendation {
  return {
    recommendation_id: action.recovery_action_id,
    action_type: action.action_type,
    reason: action.summary,
    priority: action.action_type === "request_approval" ? 100 : 70
  };
}

function shouldGenerateSelfGoals(session: AgentSession, goals: Goal[]): boolean {
  if (session.state !== "waiting" && session.state !== "hydrated") {
    return false;
  }
  return goals.every(
    (goal) =>
      isTerminalGoalStatus(goal.status) ||
      goal.status === "blocked" ||
      goal.owner === "system"
  );
}

function shouldAdoptTransferResult(
  current: import("@neurocore/protocol").TransferResult | undefined,
  next: import("@neurocore/protocol").TransferResult
): boolean {
  if (!current) {
    return true;
  }
  return (
    current.source_domain.domain_id !== next.source_domain.domain_id ||
    current.target_domain.domain_id !== next.target_domain.domain_id ||
    current.validation_status !== next.validation_status ||
    Math.abs(current.confidence - next.confidence) >= 0.05
  );
}

function shouldConsolidateKnowledge(
  session: AgentSession,
  state: AutonomyState,
  step: AgentRunResult
): boolean {
  if (session.state !== "waiting" && step.sessionState !== "completed") {
    return false;
  }
  if (!state.active_plan) {
    return true;
  }
  if (!state.latest_knowledge_snapshot) {
    return true;
  }
  return Date.parse(state.latest_knowledge_snapshot.created_at) < Date.parse(state.active_plan.updated_at);
}

function buildPerformanceBaseline(
  sessionId: string,
  runtimeState: Record<string, unknown>
): import("@neurocore/protocol").PerformanceBaseline {
  const successRate =
    typeof runtimeState.recent_success_rate === "number" ? runtimeState.recent_success_rate : 0;
  const failureRate =
    typeof runtimeState.recent_failure_rate === "number" ? runtimeState.recent_failure_rate : 0;
  const predictionErrorRate =
    typeof runtimeState.recent_prediction_error_rate === "number"
      ? runtimeState.recent_prediction_error_rate
      : 0;
  return {
    baseline_id: generateId("bln"),
    scope: sessionId,
    metrics: {
      success_rate: successRate,
      failure_rate: failureRate,
      prediction_error_rate: predictionErrorRate
    },
    sample_count:
      typeof runtimeState.active_goal_count === "number"
        ? Math.max(1, runtimeState.active_goal_count)
        : 1,
    created_at: nowIso()
  };
}

function buildCurriculumStage(
  state: AutonomyState,
  step: AgentRunResult
): import("@neurocore/protocol").CurriculumStage {
  const status =
    step.sessionState === "completed"
      ? "completed"
      : state.health_report?.overall_status === "failed"
        ? "failed"
        : "active";
  return {
    stage_id: generateId("cur"),
    name: state.latest_transfer ? "transfer-validation" : "autonomy-stabilization",
    objective: state.latest_transfer
      ? "Validate transferred assets in the current domain."
      : "Stabilize autonomous execution and preserve prior performance.",
    status
  };
}

function mergeDriftSignals(
  current: import("@neurocore/protocol").DriftSignal[] | undefined,
  next: import("@neurocore/protocol").DriftSignal[]
): import("@neurocore/protocol").DriftSignal[] {
  const merged = [...(current ?? [])];
  for (const signal of next) {
    const duplicate = merged.find(
      (candidate) =>
        candidate.category === signal.category &&
        candidate.severity === signal.severity &&
        candidate.summary === signal.summary
    );
    if (!duplicate) {
      merged.push(signal);
    }
  }
  return merged;
}

function replacePlanInHistory(
  history: import("@neurocore/protocol").AutonomousPlan[] | undefined,
  plan: import("@neurocore/protocol").AutonomousPlan
): import("@neurocore/protocol").AutonomousPlan[] {
  return [
    ...(history ?? []).filter((candidate) => candidate.plan_id !== plan.plan_id),
    plan
  ];
}

function toGoalFromSuggestedGoal(
  ctx: ModuleContext,
  suggestedGoal: SuggestedGoal
): Goal {
  return {
    goal_id: generateId("gol"),
    schema_version: ctx.profile.schema_version,
    session_id: ctx.session.session_id,
    title: suggestedGoal.title,
    description: suggestedGoal.description,
    goal_type: suggestedGoal.goal_type,
    status: "pending",
    priority: suggestedGoal.priority,
    owner: "agent",
    created_at: nowIso(),
    updated_at: nowIso(),
    metadata: {
      self_generated: true,
      suggested_goal_id: suggestedGoal.suggested_goal_id
    }
  };
}

function toGoalCandidate(
  suggestedGoal: SuggestedGoal,
  schemaVersion: string
): Goal {
  return {
    goal_id: suggestedGoal.suggested_goal_id,
    schema_version: schemaVersion,
    session_id: suggestedGoal.session_id,
    title: suggestedGoal.title,
    description: suggestedGoal.description,
    goal_type: suggestedGoal.goal_type,
    status: "pending",
    priority: suggestedGoal.priority,
    owner: "agent",
    created_at: suggestedGoal.created_at,
    updated_at: suggestedGoal.created_at,
    metadata: {
      self_generated: true,
      suggested_goal_id: suggestedGoal.suggested_goal_id
    }
  };
}

function mergeSuggestedGoals(
  current: SuggestedGoal[] | undefined,
  next: SuggestedGoal[]
): SuggestedGoal[] {
  return [
    ...(current ?? []).filter(
      (goal) => !next.some((candidate) => candidate.suggested_goal_id === goal.suggested_goal_id)
    ),
    ...next
  ];
}

function validateStructuredUserInput(
  input: UserInput,
  schema: AskUserPromptSchema | undefined
): UserInput {
  if (!schema) {
    return input;
  }

  const normalized =
    schema.mode === "options"
      ? normalizeStructuredOptionsResponse(input, schema)
      : normalizeStructuredFormResponse(input, schema);

  return {
    ...input,
    structured_response: normalized
  };
}

function normalizeStructuredOptionsResponse(
  input: UserInput,
  schema: AskUserPromptSchema
): string {
  const options = Array.isArray(schema.options) ? schema.options : [];
  const candidate =
    typeof input.structured_response === "string"
      ? input.structured_response.trim()
      : typeof input.content === "string"
        ? input.content.trim()
        : "";

  if (!candidate) {
    throw new Error("Structured ask_user response requires a selected option.");
  }

  if (!options.some((option) => option.value === candidate)) {
    throw new Error(
      `Structured ask_user response must match one of: ${options.map((option) => option.value).join(", ")}`
    );
  }

  return candidate;
}

function normalizeStructuredFormResponse(
  input: UserInput,
  schema: AskUserPromptSchema
): Record<string, JsonValue> {
  if (!isJsonRecord(input.structured_response)) {
    throw new Error("Structured ask_user form response requires an object payload.");
  }

  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  for (const field of fields) {
    const value = input.structured_response[field.name];
    if (field.required && typeof value === "undefined") {
      throw new Error(`Structured ask_user response is missing required field "${field.name}".`);
    }
    if (typeof value !== "undefined" && !isValidStructuredFieldValue(value, field)) {
      throw new Error(`Structured ask_user response field "${field.name}" failed ${field.type} validation.`);
    }
  }

  return structuredClone(input.structured_response);
}

function isValidStructuredFieldValue(value: unknown, field: AskUserField): boolean {
  switch (field.type) {
    case "text":
    case "textarea":
      return typeof value === "string";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "select":
      return (
        typeof value === "string" &&
        (!Array.isArray(field.options) || field.options.some((option) => option.value === value))
      );
    default:
      return false;
  }
}

function isAskUserPromptSchema(value: unknown): value is AskUserPromptSchema {
  return isPlainRecord(value) && (value.mode === "options" || value.mode === "form");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isPlainRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function matchesPreconditionValue(actual: unknown, expectedRaw: string): boolean {
  const normalizedExpected =
    expectedRaw === "true"
      ? true
      : expectedRaw === "false"
        ? false
        : expectedRaw === "null"
          ? null
          : Number.isFinite(Number(expectedRaw)) && expectedRaw.trim() !== ""
            ? Number(expectedRaw)
            : expectedRaw;
  return actual === normalizedExpected;
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

function collectContentPartText(
  parts?: Array<{ type: string; text?: string; alt_text?: string; text_excerpt?: string }>
): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }
  return parts
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.alt_text === "string") {
        return part.alt_text;
      }
      if (typeof part.text_excerpt === "string") {
        return part.text_excerpt;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function deriveWorkingMemoryMaxEntries(profile: AgentProfile): number {
  if (
    typeof profile.memory_config.working_memory_max_entries === "number" &&
    Number.isFinite(profile.memory_config.working_memory_max_entries) &&
    profile.memory_config.working_memory_max_entries > 0
  ) {
    return Math.floor(profile.memory_config.working_memory_max_entries);
  }

  const topK = profile.memory_config.retrieval_top_k ?? 5;
  return Math.max(12, Math.min(48, topK * 4));
}

function deriveWorkingMemoryTtlMs(profile: AgentProfile): number | undefined {
  if (
    typeof profile.memory_config.working_memory_ttl_ms === "number" &&
    Number.isFinite(profile.memory_config.working_memory_ttl_ms) &&
    profile.memory_config.working_memory_ttl_ms > 0
  ) {
    return Math.floor(profile.memory_config.working_memory_ttl_ms);
  }
  return undefined;
}

function resolveAllowedApprovers(
  profile: AgentProfile,
  approval: ApprovalRequest
): string[] | undefined {
  const policy = profile.approval_policy;
  if (!policy) {
    return undefined;
  }

  const tenantId = approval.tenant_id;
  const riskLevel = approval.action.side_effect_level;
  const byTenantAndRisk =
    tenantId && riskLevel
      ? policy.allowed_approvers_by_tenant_and_risk?.[tenantId]?.[riskLevel]
      : undefined;
  if (byTenantAndRisk && byTenantAndRisk.length > 0) {
    return byTenantAndRisk;
  }

  const byTenant = tenantId ? policy.allowed_approvers_by_tenant?.[tenantId] : undefined;
  if (byTenant && byTenant.length > 0) {
    return byTenant;
  }

  const byRisk = riskLevel ? policy.allowed_approvers_by_risk?.[riskLevel] : undefined;
  if (byRisk && byRisk.length > 0) {
    return byRisk;
  }

  return policy.allowed_approvers;
}

function toExecutionCycleState(cycle: Awaited<ReturnType<CycleEngine["run"]>>): ExecutionCycleState {
  return {
    cycleId: cycle.cycleId,
    proposals: structuredClone(cycle.proposals),
    actions: structuredClone(cycle.actions),
    predictions: structuredClone(cycle.predictions),
    workspace: structuredClone(cycle.workspace),
    metaSignalFrame: structuredClone(cycle.metaSignalFrame),
    fastMetaAssessment: structuredClone(cycle.fastMetaAssessment),
    metaAssessment: structuredClone(cycle.metaAssessment),
    metaDecisionV2: structuredClone(cycle.metaDecisionV2),
    selfEvaluationReport: structuredClone(cycle.selfEvaluationReport)
  };
}

function normalizeDecomposedGoal(
  profile: AgentProfile,
  sessionId: string,
  parentGoal: Goal,
  goal: Goal
): Goal {
  const title =
    typeof goal.title === "string" && goal.title.trim().length > 0
      ? goal.title
      : typeof goal.description === "string" && goal.description.trim().length > 0
        ? goal.description
        : `Subgoal for ${parentGoal.title}`;
  const now = nowIso();

  return {
    goal_id: goal.goal_id,
    schema_version: goal.schema_version ?? profile.schema_version,
    session_id: goal.session_id ?? sessionId,
    parent_goal_id: goal.parent_goal_id ?? parentGoal.goal_id,
    title,
    description: goal.description,
    goal_type: goal.goal_type ?? "subtask",
    status: goal.status ?? "pending",
    priority: typeof goal.priority === "number" ? goal.priority : Math.max(parentGoal.priority - 10, 1),
    importance: goal.importance,
    urgency: goal.urgency,
    deadline_at: goal.deadline_at,
    dependencies: goal.dependencies,
    constraints: goal.constraints,
    acceptance_criteria: goal.acceptance_criteria,
    progress: goal.progress,
    owner: goal.owner ?? "agent",
    created_at: goal.created_at ?? now,
    updated_at: now,
    metadata: {
      ...(goal.metadata ?? {}),
      decomposition_status:
        goal.metadata && typeof goal.metadata.decomposition_status === "string"
          ? goal.metadata.decomposition_status
          : "pending",
      decomposed_from_goal_id: parentGoal.goal_id
    }
  };
}

function toAgentCycleState(cycle: ExecutionCycleState): Awaited<ReturnType<CycleEngine["run"]>> {
  return {
    cycleId: cycle.cycleId,
    proposals: structuredClone(cycle.proposals),
    memoryRetrievalPlan: structuredClone(cycle.memoryRetrievalPlan),
    memoryRecallBundle: structuredClone(cycle.memoryRecallBundle),
    actions: structuredClone(cycle.actions),
    predictions: structuredClone(cycle.predictions),
    workspace: structuredClone(cycle.workspace),
    metaSignalFrame: structuredClone(cycle.metaSignalFrame),
    fastMetaAssessment: structuredClone(cycle.fastMetaAssessment),
    metaAssessment: structuredClone(cycle.metaAssessment),
    metaDecisionV2: structuredClone(cycle.metaDecisionV2),
    selfEvaluationReport: structuredClone(cycle.selfEvaluationReport),
    decision: {
      decision_type: "execute_action"
    }
  } as Awaited<ReturnType<CycleEngine["run"]>>;
}

function toMetaTraceFields(
      cycle:
        | ExecutionCycleState
        | Pick<
        Awaited<ReturnType<CycleEngine["run"]>>,
        | "memoryRetrievalPlan"
        | "memoryRecallBundle"
        | "metaSignalFrame"
        | "fastMetaAssessment"
        | "metaAssessment"
        | "selfEvaluationReport"
        | "metaDecisionV2"
        | "appliedReflectionRule"
      >
): {
  memoryRetrievalPlan?: import("@neurocore/protocol").MemoryRetrievalPlan;
  memoryRecallBundle?: import("@neurocore/protocol").MemoryRecallBundle;
  metaSignalFrame?: import("@neurocore/protocol").MetaSignalFrame;
  fastMetaAssessment?: import("@neurocore/protocol").FastMetaAssessment;
  metaAssessment?: import("@neurocore/protocol").MetaAssessment;
  metaDecisionV2?: import("@neurocore/protocol").MetaDecisionV2;
  selfEvaluationReport?: import("@neurocore/protocol").SelfEvaluationReport;
  appliedReflectionRule?: ReflectionRule;
} {
  return {
    memoryRetrievalPlan: structuredClone(cycle.memoryRetrievalPlan),
    memoryRecallBundle: structuredClone(cycle.memoryRecallBundle),
    metaSignalFrame: structuredClone(cycle.metaSignalFrame),
    fastMetaAssessment: structuredClone(cycle.fastMetaAssessment),
    metaAssessment: structuredClone(cycle.metaAssessment),
    metaDecisionV2: structuredClone(cycle.metaDecisionV2),
    selfEvaluationReport: structuredClone(cycle.selfEvaluationReport),
    appliedReflectionRule: structuredClone(cycle.appliedReflectionRule)
  };
}

function inferReflectionRiskLevel(
  metaAssessment: import("@neurocore/protocol").MetaAssessment,
  action: CandidateAction
): string | undefined {
  if (metaAssessment.meta_state === "high-risk" || action.side_effect_level === "high") {
    return "high";
  }
  if (metaAssessment.meta_state === "simulation-unreliable" || action.side_effect_level === "medium") {
    return "medium";
  }
  if (metaAssessment.meta_state === "routine-safe" || action.side_effect_level === "low") {
    return "low";
  }
  return undefined;
}

function toPendingApprovalSnapshot(pending: PendingApprovalContext): PendingApprovalContextSnapshot {
  return {
    approval_id: pending.approval_id,
    cycle_id: pending.cycle_id,
    input: structuredClone(pending.input),
    proposals: structuredClone(pending.proposals),
    candidate_actions: structuredClone(pending.candidate_actions),
    predictions: structuredClone(pending.predictions),
    workspace: structuredClone(pending.workspace),
    selected_action: structuredClone(pending.selectedAction),
    started_at: pending.startedAt
  };
}

function fromPendingApprovalSnapshot(snapshot: PendingApprovalContextSnapshot): PendingApprovalContext {
  return {
    approval_id: snapshot.approval_id,
    cycle_id: snapshot.cycle_id,
    input: structuredClone(snapshot.input),
    proposals: structuredClone(snapshot.proposals),
    candidate_actions: structuredClone(snapshot.candidate_actions),
    predictions: structuredClone(snapshot.predictions),
    workspace: structuredClone(snapshot.workspace),
    selectedAction: structuredClone(snapshot.selected_action),
    startedAt: snapshot.started_at
  };
}

function validateRuntimeSessionSnapshot(snapshot: RuntimeSessionSnapshot): void {
  const pendingApprovalIds = snapshot.pending_approvals.map((pending) => pending.approval_id);
  const metadataPendingApprovalId =
    snapshot.session.metadata && typeof snapshot.session.metadata.pending_approval_id === "string"
      ? snapshot.session.metadata.pending_approval_id
      : undefined;

  if (pendingApprovalIds.length > 1) {
    throw new Error(
      `Session ${snapshot.session.session_id} has multiple pending approvals, which is not yet supported.`
    );
  }

  if (snapshot.session.state === "escalated") {
    if (pendingApprovalIds.length !== 1) {
      throw new Error(
        `Escalated session ${snapshot.session.session_id} must have exactly one pending approval.`
      );
    }

    if (metadataPendingApprovalId && metadataPendingApprovalId !== pendingApprovalIds[0]) {
      throw new Error(
        `Session ${snapshot.session.session_id} points to pending approval ${metadataPendingApprovalId}, but snapshot has ${pendingApprovalIds[0]}.`
      );
    }
  }

  if (
    (snapshot.session.state === "completed" ||
      snapshot.session.state === "failed" ||
      snapshot.session.state === "aborted") &&
    pendingApprovalIds.length > 0
  ) {
    throw new Error(
      `Terminal session ${snapshot.session.session_id} cannot retain a pending approval.`
    );
  }
}

function assertNoLegacyRuntimeSnapshotPayload(snapshot: RuntimeSessionSnapshot): void {
  const raw = snapshot as unknown as Record<string, unknown>;
  const hasLegacyPayload =
    raw.working_memory !== undefined ||
    raw.episodes !== undefined ||
    raw.semantic_memory !== undefined ||
    raw.procedural_memory !== undefined ||
    raw.checkpoints !== undefined;

  if (hasLegacyPayload) {
    throw new Error(
      `Session ${snapshot.session.session_id} uses a legacy runtime snapshot payload. Run migrateSqliteRuntimeStateToSqlFirst(...) before loading this session.`
    );
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
