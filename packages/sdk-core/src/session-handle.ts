import type {
  AgentProfile,
  AgentSession,
  ApprovalRequest,
  CycleTrace,
  CycleTraceRecord,
  Episode,
  SessionCheckpoint,
  SessionReplay,
  UserInput
} from "@neurocore/protocol";
import type { AgentRuntime } from "@neurocore/runtime-core";
import type { SessionApprovalDecisionInput, SessionApprovalDecisionResult } from "./types.js";

export class AgentSessionHandle {
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
      input_id: `inp_${Date.now()}`,
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

  public getTraceRecords(): CycleTraceRecord[] {
    return this.runtime.getTraceRecords(this.sessionId);
  }

  public getEpisodes(): Episode[] {
    return this.runtime.getEpisodes(this.sessionId);
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

  public checkpoint(): SessionCheckpoint {
    return this.runtime.createCheckpoint(this.sessionId);
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
      comment: input.comment
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

  public async resumeText(content: string, metadata?: Record<string, unknown>) {
    return this.resume({
      input_id: `inp_${Date.now()}`,
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
