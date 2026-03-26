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
  Observation,
  PendingApprovalContextSnapshot,
  Prediction,
  Proposal,
  Reasoner,
  RuntimeSessionSnapshot,
  RuntimeStateStore,
  SessionCheckpoint,
  SessionReplay,
  SessionState,
  TraceStore,
  UserInput,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import { EpisodicMemoryProvider, WorkingMemoryProvider } from "@neurocore/memory-core";
import { InMemoryCheckpointStore } from "../checkpoint/in-memory-checkpoint-store.js";
import { CycleEngine } from "../cycle/cycle-engine.js";
import { ToolGateway } from "../execution/tool-gateway.js";
import { GoalManager } from "../goal/goal-manager.js";
import { DefaultMetaController } from "../meta/meta-controller.js";
import { ReplayRunner } from "../replay/replay-runner.js";
import { SessionManager } from "../session/session-manager.js";
import { InMemoryTraceStore } from "../trace/in-memory-trace-store.js";
import { TraceRecorder } from "../trace/trace-recorder.js";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";

export interface AgentRuntimeOptions {
  reasoner: Reasoner;
  metaController?: MetaController;
  memoryProviders?: MemoryProvider[];
  traceStore?: TraceStore;
  checkpointStore?: CheckpointStore;
  stateStore?: RuntimeStateStore;
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
  private readonly workingMemoryProvider = new WorkingMemoryProvider();
  private readonly episodicMemoryProvider = new EpisodicMemoryProvider();
  private readonly memoryProviders: MemoryProvider[];
  private readonly reasoner: Reasoner;
  private readonly metaController: MetaController;
  private readonly traceRecorder: TraceRecorder;
  private readonly replayRunner: ReplayRunner;
  private readonly checkpointStore: CheckpointStore;
  private readonly stateStore?: RuntimeStateStore;
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly pendingApprovals = new Map<string, PendingApprovalContext>();

  public constructor(options: AgentRuntimeOptions) {
    this.reasoner = options.reasoner;
    this.metaController = options.metaController ?? new DefaultMetaController();
    const traceStore = options.traceStore ?? new InMemoryTraceStore();
    this.checkpointStore = options.checkpointStore ?? new InMemoryCheckpointStore();
    this.stateStore = options.stateStore;
    this.traceRecorder = new TraceRecorder(traceStore);
    this.replayRunner = new ReplayRunner(traceStore);
    this.memoryProviders = [
      this.workingMemoryProvider,
      this.episodicMemoryProvider,
      ...(options.memoryProviders ?? [])
    ];
  }

  public createSession(profile: AgentProfile, command: CreateSessionCommand) {
    const session = this.sessions.create(profile, command);
    this.goals.initializeRootGoal(session.session_id, command.initial_input);
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
    const session = this.requireSession(sessionId);
    const startedAt = nowIso();

    debugLog("runtime", "Starting runOnce", {
      sessionId,
      agentId: profile.agent_id,
      inputChars: input.content.length
    });

    const result = await this.cycleEngine.run({
      tenantId: session.tenant_id,
      session,
      profile,
      input,
      goals: this.goals.active(sessionId),
      memoryProviders: this.memoryProviders,
      reasoner: this.reasoner,
      metaController: this.metaController
    });

    this.sessions.setCurrentCycle(sessionId, result.cycleId);
    const selectedAction = selectAction(result.actions, result.decision.selected_action_id);
    debugLog("runtime", "Selected action after cycle", {
      sessionId,
      cycleId: result.cycleId,
      selectedActionId: selectedAction?.action_id,
      selectedActionType: selectedAction?.action_type,
      decisionType: result.decision.decision_type
    });

    if (!selectedAction) {
      const sessionState = this.sessions.updateState(sessionId, "failed").state;
      const trace = this.traceRecorder.record({
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
      const sessionState = this.sessions.updateState(sessionId, "escalated").state;
      const trace = this.traceRecorder.record({
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
  }

  public async runUntilSettled(
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

      const step = await this.runOnce(profile, sessionId, currentInput);
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

      currentInput = observationToInput(step.observation);
    }

    const finalSession = this.sessions.updateState(sessionId, "failed");
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

  public getTraceRecords(sessionId: string): CycleTraceRecord[] {
    this.requireSession(sessionId);
    return this.traceRecorder.listRecords(sessionId);
  }

  public getEpisodes(sessionId: string): Episode[] {
    this.requireSession(sessionId);
    return structuredClone(this.episodicMemoryProvider.list(sessionId));
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
    this.sessions.updateState(sessionId, "suspended");
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
      structuredClone(checkpoint.episodes)
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

    return restoredSession;
  }

  public async resume(
    profile: AgentProfile,
    sessionId: string,
    input?: UserInput
  ): Promise<AgentRunLoopResult> {
    const session = this.requireSession(sessionId);

    const resumeInput = input ?? derivePendingInput(this.getTraceRecords(sessionId), session);
    if (!resumeInput) {
      throw new Error(
        `Session ${sessionId} has no resumable pending input. Provide an explicit input to resume.`
      );
    }

    debugLog("runtime", "Resuming session", {
      sessionId,
      restoredState: session.state,
      resumeInputId: resumeInput.input_id,
      resumeInputChars: resumeInput.content.length
    });

    return this.runUntilSettled(profile, sessionId, resumeInput);
  }

  public listCheckpoints(sessionId: string): SessionCheckpoint[] {
    this.requireSession(sessionId);
    return this.checkpointStore.list(sessionId);
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
    if (approval.status !== "pending") {
      throw new Error(`Approval request ${approvalId} is already ${approval.status}.`);
    }

    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`Approval request ${approvalId} is no longer executable.`);
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
      this.sessions.updateState(approval.session_id, "waiting");
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
    this.requireSession(sessionId);
    const session = this.sessions.updateState(sessionId, "aborted");
    this.persistSessionState(sessionId);
    debugLog("runtime", "Cancelled session", {
      sessionId: session.session_id,
      state: session.state
    });
    return structuredClone(session);
  }

  private maybeCreateCheckpoint(profile: AgentProfile, sessionId: string): void {
    if (profile.runtime_config.checkpoint_interval === "cycle") {
      this.createCheckpoint(sessionId);
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
      const sessionState = this.sessions.updateState(sessionId, "aborted").state;
      const trace = this.traceRecorder.record({
        sessionId,
        cycleId: cycle.cycleId,
        input,
        proposals: cycle.proposals,
        candidateActions: cycle.actions,
        predictions: cycle.predictions,
        policyDecisions: cycle.workspace.policy_decisions ?? [],
        selectedAction,
        selectedActionId: selectedAction.action_id,
        workspace: cycle.workspace,
        startedAt
      });
      debugLog("runtime", "Run aborted", {
        sessionId,
        cycleId: cycle.cycleId,
        actionId: selectedAction.action_id
      });
      this.maybeCreateCheckpoint(profile, sessionId);
      this.persistSessionState(sessionId);
      return {
        sessionId,
        cycleId: cycle.cycleId,
        sessionState,
        selectedAction,
        outputText: selectedAction.description ?? selectedAction.title,
        trace,
        cycle: toAgentCycleState(cycle)
      };
    }

    if (selectedAction.action_type === "call_tool") {
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
      await this.recordObservation(
        profile,
        session,
        input,
        cycle.cycleId,
        selectedAction,
        observation,
        observation.status === "failure" ? "failure" : "partial"
      );

      const sessionState = this.sessions.updateState(sessionId, "waiting").state;
      const trace = this.traceRecorder.record({
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
        observation,
        workspace: cycle.workspace,
        startedAt
      });
      debugLog("runtime", "Run waiting after tool execution", {
        sessionId,
        cycleId: cycle.cycleId,
        actionId: selectedAction.action_id,
        toolName: selectedAction.tool_name,
        executionStatus: execution.status,
        observationStatus: observation.status,
        observationSummary: observation.summary.slice(0, 160)
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
        cycle: toAgentCycleState(cycle)
      };
    }

    const sessionState = this.sessions.updateState(
      sessionId,
      deriveSessionState(selectedAction.action_type)
    ).state;
    const observation = buildSyntheticObservation(session, cycle.cycleId, selectedAction);
    await this.recordObservation(profile, session, input, cycle.cycleId, selectedAction, observation, "success");
    const trace = this.traceRecorder.record({
      sessionId,
      cycleId: cycle.cycleId,
      input,
      proposals: cycle.proposals,
      candidateActions: cycle.actions,
      predictions: cycle.predictions,
      policyDecisions: cycle.workspace.policy_decisions ?? [],
      selectedAction,
      selectedActionId: selectedAction.action_id,
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
      observation,
      outputText: selectedAction.description ?? selectedAction.title,
      trace,
      cycle: toAgentCycleState(cycle)
    };
  }

  private async recordObservation(
    profile: AgentProfile,
    session: NonNullable<ReturnType<SessionManager["get"]>>,
    input: UserInput,
    cycleId: string,
    action: CandidateAction,
    observation: Observation,
    outcome: Episode["outcome"]
  ): Promise<void> {
    this.workingMemoryProvider.appendObservation(session.session_id, observation);
    await this.persistEpisode(profile, session, input, cycleId, action, observation, outcome);

    debugLog("runtime", "Recorded observation into session memory", {
      sessionId: session.session_id,
      observationId: observation.observation_id,
      sourceType: observation.source_type,
      summaryPreview: observation.summary.slice(0, 160),
      episodicCount: this.episodicMemoryProvider.list(session.session_id).length
    });
  }

  private async persistEpisode(
    profile: AgentProfile,
    session: NonNullable<ReturnType<SessionManager["get"]>>,
    input: UserInput,
    cycleId: string,
    action: CandidateAction,
    observation: Observation,
    outcome: Episode["outcome"]
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
    const sessionId = snapshot.session.session_id;
    this.sessions.hydrate(structuredClone(snapshot.session));
    this.goals.hydrate(sessionId, structuredClone(snapshot.goals));
    this.workingMemoryProvider.replace(sessionId, structuredClone(snapshot.working_memory));
    this.episodicMemoryProvider.replace(sessionId, structuredClone(snapshot.episodes));
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

function selectAction(actions: CandidateAction[], selectedActionId?: string): CandidateAction | undefined {
  if (!selectedActionId) {
    return actions[0];
  }
  return actions.find((action) => action.action_id === selectedActionId) ?? actions[0];
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

function shouldContinue(step: AgentRunResult): boolean {
  return step.sessionState === "waiting" && step.selectedAction?.action_type === "call_tool" && Boolean(step.observation);
}

function observationToInput(observation?: Observation): UserInput {
  if (!observation) {
    throw new Error("Cannot continue without an observation to feed into the next cycle.");
  }

  return {
    input_id: `inp_${observation.observation_id}`,
    content: `Tool observation: ${observation.summary}`,
    created_at: observation.created_at,
    metadata: {
      sourceObservationId: observation.observation_id,
      sourceType: observation.source_type,
      sourceObservationStatus: observation.status,
      sourceToolName:
        typeof observation.structured_payload?.tool_name === "string"
          ? observation.structured_payload.tool_name
          : undefined,
      sourceActionId: observation.source_action_id
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
  if (!lastRecord?.observation || lastRecord.selected_action?.action_type !== "call_tool") {
    return undefined;
  }

  return observationToInput(lastRecord.observation);
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

function toExecutionCycleState(cycle: Awaited<ReturnType<CycleEngine["run"]>>): ExecutionCycleState {
  return {
    cycleId: cycle.cycleId,
    proposals: structuredClone(cycle.proposals),
    actions: structuredClone(cycle.actions),
    predictions: structuredClone(cycle.predictions),
    workspace: structuredClone(cycle.workspace)
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
