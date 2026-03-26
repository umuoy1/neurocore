import type { AgentProfile, AgentSession, CreateSessionCommand, SessionState } from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

const ALLOWED_SESSION_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  created: ["running", "suspended", "aborted", "failed"],
  hydrated: ["running", "suspended", "aborted", "failed"],
  running: ["waiting", "suspended", "escalated", "completed", "failed", "aborted"],
  waiting: ["running", "suspended", "aborted", "failed"],
  suspended: ["hydrated", "aborted", "failed"],
  escalated: ["running", "waiting", "suspended", "aborted", "failed"],
  completed: [],
  failed: [],
  aborted: []
};

export class SessionStateConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SessionStateConflictError";
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>();

  public create(profile: AgentProfile, command: CreateSessionCommand): AgentSession {
    const session: AgentSession = {
      session_id: generateId("ses"),
      schema_version: profile.schema_version,
      tenant_id: command.tenant_id,
      agent_id: profile.agent_id,
      user_id: command.user_id,
      state: "created",
      session_mode: command.session_mode ?? "sync",
      goal_tree_ref: generateId("goaltree"),
      budget_state: {
        cycle_limit: profile.runtime_config.max_cycles,
        cycle_used: 0,
        tool_call_used: 0
      },
      policy_state: {},
      started_at: nowIso()
    };

    this.sessions.set(session.session_id, session);
    return session;
  }

  public get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  public hydrate(session: AgentSession): AgentSession {
    this.sessions.set(session.session_id, session);
    return session;
  }

  public list(): AgentSession[] {
    return [...this.sessions.values()];
  }

  public updateState(sessionId: string, state: SessionState): AgentSession {
    const session = this.require(sessionId);
    return this.transition(session, state);
  }

  public beginRun(sessionId: string): AgentSession {
    const session = this.require(sessionId);
    if (session.state === "running") {
      return session;
    }
    return this.transition(session, "running");
  }

  public ensureResumable(sessionId: string): AgentSession {
    const session = this.require(sessionId);
    if (session.state === "waiting" || session.state === "suspended" || session.state === "hydrated") {
      return session;
    }

    if (session.state === "escalated") {
      throw new SessionStateConflictError(
        `Session ${sessionId} is waiting for approval and cannot be resumed yet.`
      );
    }

    throw new SessionStateConflictError(
      `Session ${sessionId} cannot be resumed from state ${session.state}.`
    );
  }

  public ensureAwaitingApproval(sessionId: string, approvalId?: string): AgentSession {
    const session = this.require(sessionId);
    const pendingApprovalId =
      session.metadata && typeof session.metadata.pending_approval_id === "string"
        ? session.metadata.pending_approval_id
        : undefined;

    if (session.state !== "escalated" || !pendingApprovalId) {
      throw new SessionStateConflictError(
        `Session ${sessionId} is not waiting on an approval decision.`
      );
    }

    if (approvalId && pendingApprovalId !== approvalId) {
      throw new SessionStateConflictError(
        `Session ${sessionId} is waiting on approval ${pendingApprovalId}, not ${approvalId}.`
      );
    }

    return session;
  }

  public cancel(sessionId: string): AgentSession {
    const session = this.require(sessionId);
    if (session.state === "aborted") {
      return session;
    }
    return this.transition(session, "aborted");
  }

  public setCurrentCycle(sessionId: string, cycleId: string): AgentSession {
    const session = this.require(sessionId);
    session.current_cycle_id = cycleId;
    session.budget_state.cycle_used = (session.budget_state.cycle_used ?? 0) + 1;
    return session;
  }

  public setCheckpointRef(sessionId: string, checkpointRef: string): AgentSession {
    const session = this.require(sessionId);
    session.checkpoint_ref = checkpointRef;
    return session;
  }

  public setApprovalState(sessionId: string, approvalId: string): AgentSession {
    const session = this.require(sessionId);
    session.policy_state.approval_required = true;
    session.policy_state.escalation_level = "approval";
    const metadata = (session.metadata ??= {});
    metadata.pending_approval_id = approvalId;
    return session;
  }

  public clearApprovalState(sessionId: string): AgentSession {
    const session = this.require(sessionId);
    session.policy_state.approval_required = false;
    if (session.policy_state.escalation_level === "approval") {
      session.policy_state.escalation_level = "none";
    }

    if (session.metadata && "pending_approval_id" in session.metadata) {
      delete session.metadata.pending_approval_id;
    }

    return session;
  }

  private require(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private transition(session: AgentSession, nextState: SessionState): AgentSession {
    if (session.state === nextState) {
      return session;
    }

    const allowed = ALLOWED_SESSION_TRANSITIONS[session.state];
    if (!allowed.includes(nextState)) {
      throw new SessionStateConflictError(
        `Invalid session state transition: ${session.state} -> ${nextState} for ${session.session_id}.`
      );
    }

    session.state = nextState;
    if (nextState === "completed" || nextState === "failed" || nextState === "aborted") {
      session.ended_at = session.ended_at ?? nowIso();
    } else {
      session.ended_at = undefined;
    }
    return session;
  }
}
