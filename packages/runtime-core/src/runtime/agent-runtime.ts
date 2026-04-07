import type {
  ActionExecution,
  AgentProfile,
  AgentSession,
  ApprovalRequest,
  CandidateAction,
  CheckpointStore,
  CycleTrace,
  CycleTraceRecord,
  CreateSessionCommand,
  Episode,
  MemoryProvider,
  MetaController,
  NeuroCoreEvent,
  NeuroCoreEventType,
  Observation,
  PendingApprovalContextSnapshot,
  PolicyProvider,
  Predictor,
  Prediction,
  PredictionError,
  PredictionStore,
  Proposal,
  Reasoner,
  RuntimeSessionSnapshot,
  RuntimeStateStore,
  SessionCheckpoint,
  SessionReplay,
  SessionState,
  SkillProvider,
  SkillStore,
  TraceStore,
  Goal,
  UserInput,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import type { DeviceRegistry, PerceptionPipeline } from "@neurocore/device-core";
import { type ForwardSimulator, type WorldStateGraph, SimulationBasedPredictor } from "@neurocore/world-model";
import type {
  TaskDelegator,
  AgentRegistry as MultiAgentRegistry,
  InterAgentBus,
  DistributedGoalManager,
  AgentLifecycleManager,
  SharedStateStore,
  CoordinationStrategy
} from "@neurocore/multi-agent";
import { EpisodicMemoryProvider, SemanticMemoryProvider, WorkingMemoryProvider } from "@neurocore/memory-core";
import { InMemoryCheckpointStore } from "../checkpoint/in-memory-checkpoint-store.js";
import { CycleEngine } from "../cycle/cycle-engine.js";
import { InMemoryEventBus } from "../events/in-memory-event-bus.js";
import { ToolGateway } from "../execution/tool-gateway.js";
import { GoalManager } from "../goal/goal-manager.js";
import { DefaultMetaController } from "../meta/meta-controller.js";
import { InMemoryPredictionStore } from "../prediction/in-memory-prediction-store.js";
import { computePredictionErrors } from "../prediction/prediction-error-computer.js";
import { ReplayRunner } from "../replay/replay-runner.js";
import { SessionManager, SessionStateConflictError } from "../session/session-manager.js";
import { ProceduralMemoryProvider } from "../skill/procedural-memory-provider.js";
import { executeSkill } from "../skill/skill-executor.js";
import { InMemoryTraceStore } from "../trace/in-memory-trace-store.js";
import { TraceRecorder } from "../trace/trace-recorder.js";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";

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
  predictionStore?: PredictionStore;
  deviceRegistry?: DeviceRegistry;
  worldStateGraph?: WorldStateGraph;
  perceptionPipeline?: PerceptionPipeline;
  forwardSimulator?: ForwardSimulator;
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
  actions: CandidateAction[];
  predictions: Prediction[];
  workspace: WorkspaceSnapshot;
}

export class AgentRuntime {
  public readonly sessions = new SessionManager();
  public readonly goals = new GoalManager();
  public readonly tools = new ToolGateway();

  private readonly cycleEngine = new CycleEngine();
  private readonly eventBus = new InMemoryEventBus();
  private readonly workingMemoryProvider = new WorkingMemoryProvider();
  private readonly episodicMemoryProvider = new EpisodicMemoryProvider();
  private readonly semanticMemoryProvider = new SemanticMemoryProvider();
  private readonly proceduralMemoryProvider: ProceduralMemoryProvider;
  private readonly memoryProviders: MemoryProvider[];
  private readonly predictors: Predictor[];
  private readonly policyProviders: PolicyProvider[];
  private readonly skillProviders: SkillProvider[];
  private readonly reasoner: Reasoner;
  private readonly metaController: MetaController;
  private readonly traceRecorder: TraceRecorder;
  private readonly replayRunner: ReplayRunner;
  private readonly checkpointStore: CheckpointStore;
  private readonly stateStore?: RuntimeStateStore;
  private readonly predictionStore: PredictionStore;
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly pendingApprovals = new Map<string, PendingApprovalContext>();
  private readonly deviceRegistry?: DeviceRegistry;
  private readonly worldStateGraph?: WorldStateGraph;
  private readonly perceptionPipeline?: PerceptionPipeline;
  private readonly taskDelegator?: TaskDelegator;
  private readonly agentRegistry?: MultiAgentRegistry;

  public constructor(options: AgentRuntimeOptions) {
    this.reasoner = options.reasoner;
    this.metaController = options.metaController ?? new DefaultMetaController();
    const traceStore = options.traceStore ?? new InMemoryTraceStore();
    this.checkpointStore = options.checkpointStore ?? new InMemoryCheckpointStore();
    this.stateStore = options.stateStore;
    this.predictionStore = options.predictionStore ?? new InMemoryPredictionStore();
    this.traceRecorder = new TraceRecorder(traceStore);
    this.replayRunner = new ReplayRunner(traceStore);
    this.proceduralMemoryProvider = new ProceduralMemoryProvider(options.skillStore);
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
    this.taskDelegator = options.taskDelegator;
    this.agentRegistry = options.agentRegistry;
    if (options.forwardSimulator && options.worldStateGraph) {
      this.predictors = [
        ...this.predictors,
        new SimulationBasedPredictor(options.forwardSimulator, options.worldStateGraph)
      ];
    }
  }

  public createSession(profile: AgentProfile, command: CreateSessionCommand) {
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
      return await this.runOnceUnlocked(profile, sessionId, input);
    } finally {
      releaseLock();
    }
  }

  private async runOnceUnlocked(profile: AgentProfile, sessionId: string, input: UserInput) {
    const session = this.beginRun(sessionId);
    const startedAt = nowIso();

    debugLog("runtime", "Starting runOnce", {
      sessionId,
      agentId: profile.agent_id,
      inputChars: input.content.length
    });

    try {
    await this.decomposeGoals(profile, session, input);
    const activeGoals = this.goals.active(sessionId);

    const predictionErrorRate = this.predictionStore.getRecentErrorRate(sessionId, 5);

    const result = await this.cycleEngine.run({
      tenantId: session.tenant_id,
      session,
      profile,
      input,
      goals: activeGoals,
      memoryProviders: this.memoryProviders,
      predictors: this.predictors,
      policies: this.policyProviders,
      skillProviders: this.skillProviders,
      reasoner: this.reasoner,
      metaController: this.metaController,
      predictionErrorRate,
      deviceRegistry: this.deviceRegistry,
      perceptionPipeline: this.perceptionPipeline,
      worldStateGraph: this.worldStateGraph,
      taskDelegator: this.taskDelegator,
      agentRegistry: this.agentRegistry
    });

    for (const prediction of result.predictions) {
      this.predictionStore.recordPrediction(prediction);
    }

    this.sessions.setCurrentCycle(sessionId, result.cycleId);
    const selectedAction = selectAction(result.actions, result.decision);
    this.emitCycleStarted(session, result.cycleId, startedAt);
    for (const proposal of result.proposals) {
      this.emitEvent(session, "proposal.submitted", proposal, result.cycleId);
    }
    for (const prediction of result.predictions) {
      this.emitEvent(session, "prediction.recorded", prediction, result.cycleId);
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
        outputText: selectedAction.description ?? selectedAction.title,
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

  public listGoals(sessionId: string): Goal[] {
    this.requireSession(sessionId);
    return structuredClone(this.goals.list(sessionId));
  }

  public getTraceRecords(sessionId: string): CycleTraceRecord[] {
    this.requireSession(sessionId);
    return this.traceRecorder.listRecords(sessionId);
  }

  public getEpisodes(sessionId: string): Episode[] {
    this.requireSession(sessionId);
    return structuredClone(this.episodicMemoryProvider.list(sessionId));
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

  public createCheckpoint(sessionId: string): SessionCheckpoint {
    const session = this.requireSession(sessionId);

    const snapshot: SessionCheckpoint = {
      checkpoint_id: generateId("chk"),
      session: structuredClone(session),
      goals: structuredClone(this.goals.list(sessionId)),
      working_memory: structuredClone(this.workingMemoryProvider.list(sessionId)),
      episodes: structuredClone(this.episodicMemoryProvider.list(sessionId)),
      semantic_memory: structuredClone(this.semanticMemoryProvider.buildSnapshot(sessionId)),
      procedural_memory: structuredClone(this.proceduralMemoryProvider.buildSnapshot(sessionId)),
      traces: structuredClone(this.getTraceRecords(sessionId)),
      pending_input: derivePendingInput(this.getTraceRecords(sessionId), session),
      created_at: nowIso()
    };

    this.checkpointStore.save(snapshot);
    this.sessions.setCheckpointRef(sessionId, snapshot.checkpoint_id);
    this.persistSessionState(sessionId);

    debugLog("runtime", "Created session checkpoint", {
      sessionId,
      checkpointId: snapshot.checkpoint_id,
      goalCount: snapshot.goals.length,
      workingMemoryCount: snapshot.working_memory.length,
      episodeCount: snapshot.episodes.length,
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
    this.updateSessionState(sessionId, "suspended");
    const checkpoint = this.createCheckpoint(sessionId);
    debugLog("runtime", "Suspended session", {
      sessionId: session.session_id,
      checkpointId: checkpoint.checkpoint_id
    });
    return checkpoint;
  }

  public restoreSession(checkpoint: SessionCheckpoint) {
    const restoredSession = structuredClone(checkpoint.session);
    if (!isTerminalState(restoredSession.state)) {
      restoredSession.state = "hydrated";
      restoredSession.ended_at = undefined;
    }
    restoredSession.checkpoint_ref = checkpoint.checkpoint_id;

    this.sessions.hydrate(restoredSession);
    this.goals.hydrate(restoredSession.session_id, structuredClone(checkpoint.goals));
    this.workingMemoryProvider.replace(
      restoredSession.session_id,
      structuredClone(checkpoint.working_memory)
    );
    this.episodicMemoryProvider.replace(
      restoredSession.session_id,
      restoredSession.tenant_id,
      structuredClone(checkpoint.episodes)
    );
    this.semanticMemoryProvider.replaceSession(
      restoredSession.session_id,
      restoredSession.tenant_id,
      structuredClone(checkpoint.episodes)
    );
    this.semanticMemoryProvider.restoreSnapshot(
      restoredSession.session_id,
      restoredSession.tenant_id,
      structuredClone(checkpoint.semantic_memory)
    );
    this.proceduralMemoryProvider.replaceSession(
      restoredSession.session_id,
      restoredSession.tenant_id,
      structuredClone(checkpoint.episodes)
    );
    this.proceduralMemoryProvider.restoreSnapshot(
      restoredSession.tenant_id,
      structuredClone(checkpoint.procedural_memory)
    );
    this.traceRecorder.getStore().replaceSession(
      restoredSession.session_id,
      structuredClone(checkpoint.traces)
    );
    this.checkpointStore.save(structuredClone(checkpoint));
    this.persistSessionState(restoredSession.session_id);

    debugLog("runtime", "Restored session from checkpoint", {
      sessionId: restoredSession.session_id,
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
    const session = this.sessions.ensureResumable(sessionId);

    const resumeInput = input ?? derivePendingInput(this.getTraceRecords(sessionId), session);
    if (!resumeInput) {
      throw new Error(
        `Session ${sessionId} has no resumable pending input. Provide an explicit input to resume.`
      );
    }

    if (input) {
      this.rebaseGoalsForExplicitInput(sessionId, input);
    }

    debugLog("runtime", "Resuming session", {
      sessionId,
      restoredState: session.state,
      resumeInputId: resumeInput.input_id,
      resumeInputChars: resumeInput.content.length
    });

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
    this.eventBus.deleteSession(sessionId);
    this.sessions.deleteSession(sessionId);
    this.stateStore?.deleteSession?.(sessionId);

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

    if (profile.approval_policy?.allowed_approvers) {
      const allowed = profile.approval_policy.allowed_approvers;
      if (!allowed.includes(decision.approver_id)) {
        throw new Error(`Approver ${decision.approver_id} is not in the allowed approvers list.`);
      }
    }

    approval.status = decision.decision;
    approval.decision = decision.decision;
    approval.approver_id = decision.approver_id;
    approval.comment = decision.comment;
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

  private recordTrace(input: Parameters<TraceRecorder["record"]>[0]): CycleTrace {
    return this.traceRecorder.record(input);
  }

  private emitEvent(
    session: Pick<AgentSession, "schema_version" | "tenant_id" | "session_id">,
    eventType: NeuroCoreEventType,
    payload: NeuroCoreEvent["payload"],
    cycleId?: string
  ): void {
    this.eventBus.append({
      event_id: generateId("evt"),
      event_type: eventType,
      schema_version: session.schema_version,
      tenant_id: session.tenant_id,
      session_id: session.session_id,
      cycle_id: cycleId,
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
      const ctx = buildMemoryContext(profile, session, this.goals.active(session.session_id), input);
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
        outputText: selectedAction.description ?? selectedAction.title,
        trace,
        cycle: toAgentCycleState(cycle)
      };
    }

    if (selectedAction.action_type === "call_tool") {
      const skillResult = await this.trySkillExecution(profile, session, input, startedAt, cycle, selectedAction);
      if (skillResult) return skillResult;

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
      this.sessions.incrementToolCallUsed(sessionId);
      const predictionErrors = await this.recordObservation(
        profile,
        session,
        input,
        cycle.cycleId,
        selectedAction,
        observationWithSkill,
        observationWithSkill.status === "failure" ? "failure" : "partial",
        cycle.predictions,
        execution
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
        predictionErrors
      };
    }

    if (selectedAction.action_type === "delegate") {
      return this.executeDelegateAction(profile, session, input, startedAt, cycle, selectedAction);
    }

    const targetState = deriveSessionState(selectedAction.action_type);
    const observation = buildSyntheticObservation(session, cycle.cycleId, selectedAction);
    const execution = buildRuntimeActionExecution(session, cycle.cycleId, selectedAction, "succeeded");
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    const predictionErrors = await this.recordObservation(
      profile, session, input, cycle.cycleId, selectedAction, observation, "success",
      cycle.predictions, execution
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
      outputText: selectedAction.description ?? selectedAction.title,
      trace,
      cycle: toAgentCycleState(cycle),
      predictionErrors
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
            result: response.result,
            bids: response.bids,
            selected_bid: response.selected_bid
          },
          created_at: nowIso()
        };
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
    }

    this.emitEvent(session, "action.executed", execution, cycle.cycleId);
    const predictionErrors = await this.recordObservation(
      profile, session, input, cycle.cycleId, selectedAction, observation,
      observation.status === "failure" ? "failure" : "partial",
      cycle.predictions, execution
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
      predictionErrors
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
    execution?: ActionExecution
  ): Promise<PredictionError[]> {
    if (profile.memory_config.working_memory_enabled !== false) {
      this.workingMemoryProvider.appendObservation(
        session.session_id,
        observation,
        deriveWorkingMemoryMaxEntries(profile)
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
    await this.persistEpisode(profile, session, input, cycleId, action, observation, outcome, valence, lessons);

    debugLog("runtime", "Recorded observation into session memory", {
      sessionId: session.session_id,
      observationId: observation.observation_id,
      sourceType: observation.source_type,
      summaryPreview: observation.summary.slice(0, 160),
      episodicCount: this.episodicMemoryProvider.list(session.session_id).length,
      predictionErrorCount: predictionErrors.length
    });

    return predictionErrors;
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
  ): Promise<void> {
    const episode: Episode = {
      episode_id: `epi_${observation.observation_id}`,
      schema_version: profile.schema_version,
      session_id: session.session_id,
      trigger_summary: input.content,
      goal_refs: this.goals.active(session.session_id).map((goal) => goal.goal_id),
      context_digest: input.content,
      selected_strategy: action.title,
      action_refs: [action.action_id],
      observation_refs: [observation.observation_id],
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

    const ctx = buildMemoryContext(profile, session, this.goals.active(session.session_id), input);
    await Promise.all(this.memoryProviders.map(async (provider) => provider.writeEpisode(ctx, episode)));
    this.emitEvent(session, "memory.written", episode, cycleId);

    const promoted = this.proceduralMemoryProvider.getLastPromotedSkill();
    if (promoted) {
      episode.promoted_to_skill = true;
      this.emitEvent(session, "skill.promoted", promoted, cycleId);
      this.proceduralMemoryProvider.clearLastPromotedSkill();
    }
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

    const ctx = buildMemoryContext(profile, session, this.goals.active(session.session_id), input);
    const skillResult = await executeSkill(provider, ctx, skillId, selectedAction);
    if (!skillResult) return null;

    const { execution, observation } = skillResult;
    this.emitEvent(session, "skill.executed", execution, cycle.cycleId);
    this.emitEvent(session, "action.executed", execution, cycle.cycleId);

    const predictionErrors = await this.recordObservation(
      profile, session, input, cycle.cycleId, selectedAction, observation,
      observation.status === "failure" ? "failure" : "success",
      cycle.predictions, execution
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
      predictionErrors
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
    const sessionId = snapshot.session.session_id;
    this.sessions.hydrate(structuredClone(snapshot.session));
    this.goals.hydrate(sessionId, structuredClone(snapshot.goals));
    this.workingMemoryProvider.replace(sessionId, structuredClone(snapshot.working_memory));
    this.episodicMemoryProvider.replace(sessionId, snapshot.session.tenant_id, structuredClone(snapshot.episodes));
    this.semanticMemoryProvider.replaceSession(
      sessionId,
      snapshot.session.tenant_id,
      structuredClone(snapshot.episodes)
    );
    this.semanticMemoryProvider.restoreSnapshot(
      sessionId,
      snapshot.session.tenant_id,
      structuredClone(snapshot.semantic_memory)
    );
    this.proceduralMemoryProvider.replaceSession(
      sessionId,
      snapshot.session.tenant_id,
      structuredClone(snapshot.episodes)
    );
    this.proceduralMemoryProvider.restoreSnapshot(
      snapshot.session.tenant_id,
      structuredClone(snapshot.procedural_memory)
    );
    this.traceRecorder.getStore().replaceSession(sessionId, structuredClone(snapshot.trace_records));

    for (const checkpoint of snapshot.checkpoints) {
      this.checkpointStore.save(structuredClone(checkpoint));
    }

    for (const approval of snapshot.approvals) {
      this.approvals.set(approval.approval_id, structuredClone(approval));
    }

    for (const pending of snapshot.pending_approvals) {
      this.pendingApprovals.set(pending.approval_id, fromPendingApprovalSnapshot(pending));
    }

    this.eventBus.replaceSession(sessionId, []);
  }

  private persistSessionState(sessionId: string): void {
    if (!this.stateStore) {
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const snapshot: RuntimeSessionSnapshot = {
      session: structuredClone(session),
      goals: structuredClone(this.goals.list(sessionId)),
      working_memory: structuredClone(this.workingMemoryProvider.list(sessionId)),
      episodes: structuredClone(this.episodicMemoryProvider.list(sessionId)),
      semantic_memory: structuredClone(this.semanticMemoryProvider.buildSnapshot(sessionId)),
      procedural_memory: structuredClone(this.proceduralMemoryProvider.buildSnapshot(sessionId)),
      trace_records: structuredClone(this.traceRecorder.listRecords(sessionId)),
      approvals: structuredClone(
        [...this.approvals.values()].filter((approval) => approval.session_id === sessionId)
      ),
      pending_approvals: structuredClone(
        [...this.pendingApprovals.values()]
          .filter((pending) => this.approvals.get(pending.approval_id)?.session_id === sessionId)
          .map(toPendingApprovalSnapshot)
      ),
      checkpoints: structuredClone(this.checkpointStore.list(sessionId))
    };

    this.stateStore.saveSession(snapshot);
  }
}

function isTerminalState(state: SessionState): boolean {
  return state === "completed" || state === "failed" || state === "aborted";
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
    return actions[0];
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
  action: CandidateAction
): Observation {
  return {
    observation_id: `obs_${action.action_id}`,
    session_id: session.session_id,
    cycle_id: cycleId,
    source_action_id: action.action_id,
    source_type: "runtime",
    status: "success",
    summary: action.description ?? action.title,
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
    metadata: {
      sourceObservationId: observation.observation_id,
      sourceType: observation.source_type,
      sourceObservationStatus: observation.status,
      sourceActionType: actionType,
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

function getMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function buildMemoryContext(
  profile: AgentProfile,
  session: NonNullable<ReturnType<SessionManager["get"]>>,
  goals: ReturnType<GoalManager["active"]>,
  input: UserInput
) {
  return {
    tenant_id: session.tenant_id,
    session,
    profile,
    goals,
    runtime_state: {
      current_input_content: input.content,
      current_input_metadata: input.metadata ?? null
    },
    services: {
      now: nowIso,
      generateId
    }
  };
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

function toExecutionCycleState(cycle: Awaited<ReturnType<CycleEngine["run"]>>): ExecutionCycleState {
  return {
    cycleId: cycle.cycleId,
    proposals: structuredClone(cycle.proposals),
    actions: structuredClone(cycle.actions),
    predictions: structuredClone(cycle.predictions),
    workspace: structuredClone(cycle.workspace)
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
    actions: structuredClone(cycle.actions),
    predictions: structuredClone(cycle.predictions),
    workspace: structuredClone(cycle.workspace),
    decision: {
      decision_type: "execute_action"
    }
  } as Awaited<ReturnType<CycleEngine["run"]>>;
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
