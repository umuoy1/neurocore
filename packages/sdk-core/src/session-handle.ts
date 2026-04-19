import type {
  AgentProfile,
  AgentSession,
  CreateSessionCommand,
  ApprovalRequest,
  CycleTrace,
  CycleTraceRecord,
  Episode,
  Goal,
  NeuroCoreEvent,
  SessionCheckpoint,
  SessionReplay,
  UserInput
} from "@neurocore/protocol";
import type { AgentRuntime, AgentRunLoopResult } from "@neurocore/runtime-core";
import { randomUUID } from "node:crypto";
import type {
  PaginatedResult,
  SessionApprovalDecisionInput,
  SessionApprovalDecisionResult,
  SessionHandleLike,
  SessionEventFilter
} from "./types.js";

export interface LocalSessionCreateInput extends Omit<CreateSessionCommand, "command_type" | "agent_id"> {
  agent_id?: string;
}

export class AgentSessionHandle implements SessionHandleLike<AgentSession, SessionReplay, AgentRunLoopResult | AgentSession> {
  public constructor(
    private readonly runtime: AgentRuntime,
    private readonly profile: AgentProfile,
    private readonly sessionId: string,
    private readonly initialInput?: UserInput
  ) {}

  public get id(): string {
    return this.sessionId;
  }

  public async runOnce() {
    return this.runtime.runOnce(this.profile, this.sessionId, this.requireSeedInput());
  }

  public async run() {
    return this.runtime.runUntilSettled(this.profile, this.sessionId, this.requireSeedInput());
  }

  public async runInput(input: UserInput) {
    return this.runtime.runUntilSettled(this.profile, this.sessionId, input);
  }

  public async runText(content: string, metadata?: Record<string, unknown>) {
    const createdAt = new Date().toISOString();
    return this.runInput({
      input_id: `inp_${randomUUID()}`,
      content,
      created_at: createdAt,
      metadata
    });
  }

  public getTraces(): CycleTrace[] {
    return this.runtime.getTraces(this.sessionId);
  }

  public getSession(): AgentSession | undefined {
    return this.runtime.getSession(this.sessionId);
  }

  public getState(): AgentSession["state"] | undefined {
    return this.getSession()?.state;
  }

  public isTerminal(): boolean {
    const state = this.getState();
    return state === "completed" || state === "failed" || state === "aborted";
  }

  public isRunning(): boolean {
    return this.getState() === "running";
  }

  public getTraceRecords(): CycleTraceRecord[] {
    return this.runtime.getTraceRecords(this.sessionId);
  }

  public getTraceRecordsPage(pagination?: { offset?: number; limit?: number }): PaginatedResult<CycleTraceRecord> {
    return paginate(this.getTraceRecords(), pagination);
  }

  public getEpisodes(): Episode[] {
    return this.runtime.getEpisodes(this.sessionId);
  }

  public getEpisodesPage(pagination?: { offset?: number; limit?: number }): PaginatedResult<Episode> {
    return paginate(this.getEpisodes(), pagination);
  }

  public getEvents(filter?: SessionEventFilter): NeuroCoreEvent[] {
    return filterEvents(this.runtime.listEvents(this.sessionId), filter);
  }

  public getEventsPage(
    pagination?: { offset?: number; limit?: number },
    filter?: SessionEventFilter
  ): PaginatedResult<NeuroCoreEvent> {
    return paginate(this.getEvents(filter), pagination);
  }

  public subscribeToEvents(
    listener: (event: NeuroCoreEvent) => void,
    filter?: SessionEventFilter
  ): () => void {
    return this.runtime.subscribeToSessionEvents(this.sessionId, (event) => {
      if (matchesEventFilter(event, filter)) {
        listener(event);
      }
    });
  }

  public getGoals(): Goal[] {
    return this.runtime.listGoals(this.sessionId);
  }

  public getApproval(approvalId: string): ApprovalRequest | undefined {
    return this.runtime.getApproval(approvalId);
  }

  public getPendingApproval(): ApprovalRequest | undefined {
    return this.runtime.getPendingApproval(this.sessionId);
  }

  public listApprovals(): ApprovalRequest[] {
    return this.runtime.listApprovals(this.sessionId);
  }

  public replay(): SessionReplay {
    return this.runtime.replaySession(this.sessionId);
  }

  public async waitForSettled(options?: { pollIntervalMs?: number; timeoutMs?: number }): Promise<AgentRunLoopResult | AgentSession> {
    const pollIntervalMs = Math.max(25, options?.pollIntervalMs ?? 100);
    const timeoutAt = Date.now() + (options?.timeoutMs ?? 30_000);

    while (true) {
      const session = this.getSession();
      if (!session) {
        throw new Error(`Unknown session: ${this.sessionId}`);
      }
      if (session.state !== "running") {
        return session;
      }
      if (Date.now() >= timeoutAt) {
        throw new Error(`Timed out waiting for session ${this.sessionId} to settle.`);
      }
      await sleep(pollIntervalMs);
    }
  }

  public checkpoint(): SessionCheckpoint {
    return this.runtime.createCheckpoint(this.sessionId);
  }

  public getCheckpoints(): SessionCheckpoint[] {
    return this.runtime.listCheckpoints(this.sessionId);
  }

  public suspend(): SessionCheckpoint {
    return this.runtime.suspendSession(this.sessionId);
  }

  public async resume(input?: UserInput) {
    return this.runtime.resume(this.profile, this.sessionId, input);
  }

  public async decideApproval(input: SessionApprovalDecisionInput): Promise<SessionApprovalDecisionResult> {
    const approvalId = input.approval_id ?? this.getPendingApproval()?.approval_id;
    if (!approvalId) {
      throw new Error(`Session ${this.sessionId} does not have a pending approval request.`);
    }

    return this.runtime.decideApproval(this.profile, approvalId, {
      approver_id: input.approver_id,
      decision: input.decision,
      comment: input.comment,
      reviewer_identity: input.reviewer_identity
    });
  }

  public async approve(input: Omit<SessionApprovalDecisionInput, "decision">): Promise<SessionApprovalDecisionResult> {
    return this.decideApproval({
      ...input,
      decision: "approved"
    });
  }

  public async reject(input: Omit<SessionApprovalDecisionInput, "decision">): Promise<SessionApprovalDecisionResult> {
    return this.decideApproval({
      ...input,
      decision: "rejected"
    });
  }

  public cancel(): AgentSession {
    return this.runtime.cancelSession(this.sessionId);
  }

  public cleanup(options?: { force?: boolean }): void {
    this.runtime.cleanupSession(this.sessionId, options);
  }

  public async resumeText(content: string, metadata?: Record<string, unknown>) {
    return this.resume({
      input_id: `inp_${randomUUID()}`,
      content,
      created_at: new Date().toISOString(),
      metadata
    });
  }

  private requireSeedInput(): UserInput {
    if (!this.initialInput) {
      throw new Error("This session handle does not have a default seed input. Use runInput or resume instead.");
    }
    return this.initialInput;
  }
}

function paginate<T>(items: T[], pagination?: { offset?: number; limit?: number }): PaginatedResult<T> {
  const offset = Math.max(0, pagination?.offset ?? 0);
  const limit = Math.max(0, pagination?.limit ?? items.length);
  const paged = limit === 0 ? [] : items.slice(offset, offset + limit);
  return {
    items: paged,
    total: items.length,
    offset,
    limit,
    has_more: offset + paged.length < items.length
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function filterEvents(events: NeuroCoreEvent[], filter?: SessionEventFilter): NeuroCoreEvent[] {
  if (!filter) {
    return events;
  }
  return events.filter((event) => matchesEventFilter(event, filter));
}

function matchesEventFilter(event: NeuroCoreEvent, filter?: SessionEventFilter): boolean {
  if (!filter) {
    return true;
  }
  if (filter.event_types && !filter.event_types.includes(event.event_type)) {
    return false;
  }
  if (filter.cycle_id && event.cycle_id !== filter.cycle_id) {
    return false;
  }
  if (
    typeof filter.since_sequence_no === "number" &&
    Number.isFinite(filter.since_sequence_no) &&
    event.sequence_no <= filter.since_sequence_no
  ) {
    return false;
  }
  return true;
}
