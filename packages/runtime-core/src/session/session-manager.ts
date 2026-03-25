import type { AgentProfile, AgentSession, CreateSessionCommand, SessionState } from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

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
    session.state = state;
    if (state === "completed" || state === "failed" || state === "aborted") {
      session.ended_at = nowIso();
    }
    return session;
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
}
