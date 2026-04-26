import { randomUUID } from "node:crypto";
import type { BackgroundTaskEntry, BackgroundTaskStatus, ScheduleEntry } from "../proactive/types.js";

export type PersonalAssistantGovernanceSessionState =
  | "created"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface PersonalAssistantGovernanceSession {
  session_id: string;
  agent_id: string;
  user_id?: string;
  state: PersonalAssistantGovernanceSessionState;
  route?: {
    platform?: string;
    chat_id?: string;
    thread_id?: string;
    profile_id?: string;
  };
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface PersonalAssistantGovernanceApproval {
  approval_id: string;
  session_id: string;
  status: PersonalAssistantGovernanceApprovalStatus;
  action_title: string;
  action_type?: string;
  risk_level?: string;
  requested_at: string;
  decided_at?: string;
  approver_id?: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceScheduleStatus = "active" | "paused" | "disabled";

export interface PersonalAssistantGovernanceSchedule extends ScheduleEntry {
  status: PersonalAssistantGovernanceScheduleStatus;
  next_run_at?: string;
  last_run_at?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceChildAgentStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface PersonalAssistantGovernanceChildAgent {
  child_agent_id: string;
  parent_session_id: string;
  task_id?: string;
  agent_id: string;
  status: PersonalAssistantGovernanceChildAgentStatus;
  goal: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceMemoryRecord {
  memory_id: string;
  subject: string;
  claim: string;
  lifecycle: "candidate" | "active" | "retired";
  confidence?: number;
  source_session_ids?: string[];
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceToolAction {
  tool_action_id: string;
  session_id?: string;
  task_id?: string;
  tool_name: string;
  status: "requested" | "approved" | "rejected" | "running" | "succeeded" | "failed" | "cancelled";
  risk_level?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceTargetType =
  | "approval"
  | "background_task"
  | "schedule"
  | "child_agent"
  | "session"
  | "memory"
  | "tool_action";

export interface PersonalAssistantGovernanceAuditRecord {
  audit_id: string;
  action: string;
  target_type: PersonalAssistantGovernanceTargetType;
  target_id: string;
  actor_id: string;
  created_at: string;
  before?: unknown;
  after?: unknown;
  details?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceSnapshot {
  sessions: PersonalAssistantGovernanceSession[];
  background_tasks: BackgroundTaskEntry[];
  approvals: PersonalAssistantGovernanceApproval[];
  schedules: PersonalAssistantGovernanceSchedule[];
  child_agents: PersonalAssistantGovernanceChildAgent[];
  memories: PersonalAssistantGovernanceMemoryRecord[];
  tool_actions: PersonalAssistantGovernanceToolAction[];
  audit_records: PersonalAssistantGovernanceAuditRecord[];
  summary: {
    total_sessions: number;
    active_sessions: number;
    running_background_tasks: number;
    pending_approvals: number;
    active_schedules: number;
    active_child_agents: number;
    memory_records: number;
    tool_actions: number;
    audit_records: number;
  };
}

export interface PersonalAssistantGovernanceConsoleInput {
  sessions?: PersonalAssistantGovernanceSession[];
  background_tasks?: BackgroundTaskEntry[];
  approvals?: PersonalAssistantGovernanceApproval[];
  schedules?: PersonalAssistantGovernanceSchedule[];
  child_agents?: PersonalAssistantGovernanceChildAgent[];
  memories?: PersonalAssistantGovernanceMemoryRecord[];
  tool_actions?: PersonalAssistantGovernanceToolAction[];
  audit_records?: PersonalAssistantGovernanceAuditRecord[];
}

export class PersonalAssistantGovernanceConsole {
  private readonly sessions = new Map<string, PersonalAssistantGovernanceSession>();
  private readonly backgroundTasks = new Map<string, BackgroundTaskEntry>();
  private readonly approvals = new Map<string, PersonalAssistantGovernanceApproval>();
  private readonly schedules = new Map<string, PersonalAssistantGovernanceSchedule>();
  private readonly childAgents = new Map<string, PersonalAssistantGovernanceChildAgent>();
  private readonly memories = new Map<string, PersonalAssistantGovernanceMemoryRecord>();
  private readonly toolActions = new Map<string, PersonalAssistantGovernanceToolAction>();
  private readonly auditRecords: PersonalAssistantGovernanceAuditRecord[] = [];

  public constructor(input: PersonalAssistantGovernanceConsoleInput = {}) {
    for (const session of input.sessions ?? []) this.sessions.set(session.session_id, clone(session));
    for (const task of input.background_tasks ?? []) this.backgroundTasks.set(task.task_id, clone(task));
    for (const approval of input.approvals ?? []) this.approvals.set(approval.approval_id, clone(approval));
    for (const schedule of input.schedules ?? []) this.schedules.set(schedule.id, clone(schedule));
    for (const childAgent of input.child_agents ?? []) this.childAgents.set(childAgent.child_agent_id, clone(childAgent));
    for (const memory of input.memories ?? []) this.memories.set(memory.memory_id, clone(memory));
    for (const toolAction of input.tool_actions ?? []) this.toolActions.set(toolAction.tool_action_id, clone(toolAction));
    this.auditRecords.push(...(input.audit_records ?? []).map((record) => clone(record)));
  }

  public snapshot(): PersonalAssistantGovernanceSnapshot {
    const sessions = sortByUpdatedAt([...this.sessions.values()]);
    const backgroundTasks = sortByUpdatedAt([...this.backgroundTasks.values()]);
    const approvals = sortByTimestamp([...this.approvals.values()], "requested_at");
    const schedules = sortByUpdatedAt([...this.schedules.values()]);
    const childAgents = sortByUpdatedAt([...this.childAgents.values()]);
    const memories = sortByUpdatedAt([...this.memories.values()]);
    const toolActions = sortByUpdatedAt([...this.toolActions.values()]);
    const auditRecords = [...this.auditRecords].sort((left, right) => right.created_at.localeCompare(left.created_at));

    return clone({
      sessions,
      background_tasks: backgroundTasks,
      approvals,
      schedules,
      child_agents: childAgents,
      memories,
      tool_actions: toolActions,
      audit_records: auditRecords,
      summary: {
        total_sessions: sessions.length,
        active_sessions: sessions.filter((session) => !["completed", "failed", "cancelled"].includes(session.state)).length,
        running_background_tasks: backgroundTasks.filter((task) => task.status === "running").length,
        pending_approvals: approvals.filter((approval) => approval.status === "pending").length,
        active_schedules: schedules.filter((schedule) => schedule.status === "active").length,
        active_child_agents: childAgents.filter((agent) => agent.status === "running" || agent.status === "paused").length,
        memory_records: memories.length,
        tool_actions: toolActions.length,
        audit_records: auditRecords.length
      }
    });
  }

  public addSession(session: PersonalAssistantGovernanceSession): PersonalAssistantGovernanceSession {
    this.sessions.set(session.session_id, clone(session));
    return clone(session);
  }

  public addBackgroundTask(task: BackgroundTaskEntry): BackgroundTaskEntry {
    this.backgroundTasks.set(task.task_id, clone(task));
    return clone(task);
  }

  public addApproval(approval: PersonalAssistantGovernanceApproval): PersonalAssistantGovernanceApproval {
    this.approvals.set(approval.approval_id, clone(approval));
    return clone(approval);
  }

  public addSchedule(schedule: PersonalAssistantGovernanceSchedule): PersonalAssistantGovernanceSchedule {
    this.schedules.set(schedule.id, clone(schedule));
    return clone(schedule);
  }

  public addChildAgent(childAgent: PersonalAssistantGovernanceChildAgent): PersonalAssistantGovernanceChildAgent {
    this.childAgents.set(childAgent.child_agent_id, clone(childAgent));
    return clone(childAgent);
  }

  public addMemory(memory: PersonalAssistantGovernanceMemoryRecord): PersonalAssistantGovernanceMemoryRecord {
    this.memories.set(memory.memory_id, clone(memory));
    return clone(memory);
  }

  public addToolAction(toolAction: PersonalAssistantGovernanceToolAction): PersonalAssistantGovernanceToolAction {
    this.toolActions.set(toolAction.tool_action_id, clone(toolAction));
    return clone(toolAction);
  }

  public approve(approvalId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceApproval {
    return this.updateApproval(approvalId, "approved", actorId, details);
  }

  public reject(approvalId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceApproval {
    return this.updateApproval(approvalId, "rejected", actorId, details);
  }

  public pauseSchedule(scheduleId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceSchedule {
    const schedule = this.requireSchedule(scheduleId);
    if (schedule.status === "disabled") return clone(schedule);
    const next = this.setScheduleStatus(schedule, "paused");
    this.recordAudit("schedule.paused", "schedule", scheduleId, actorId, schedule, next, details);
    return clone(next);
  }

  public resumeSchedule(scheduleId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceSchedule {
    const schedule = this.requireSchedule(scheduleId);
    if (schedule.status === "disabled") return clone(schedule);
    const next = this.setScheduleStatus(schedule, "active");
    this.recordAudit("schedule.resumed", "schedule", scheduleId, actorId, schedule, next, details);
    return clone(next);
  }

  public cancelBackgroundTask(taskId: string, actorId: string, details?: Record<string, unknown>): BackgroundTaskEntry {
    const task = this.requireBackgroundTask(taskId);
    const terminal: BackgroundTaskStatus[] = ["succeeded", "failed", "cancelled"];
    if (terminal.includes(task.status)) return clone(task);
    const now = new Date().toISOString();
    const next: BackgroundTaskEntry = {
      ...task,
      status: "cancelled",
      cancelled_at: now,
      completed_at: now,
      updated_at: now
    };
    this.backgroundTasks.set(taskId, clone(next));
    this.recordAudit("background_task.cancelled", "background_task", taskId, actorId, task, next, details);
    return clone(next);
  }

  public pauseChildAgent(childAgentId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceChildAgent {
    const childAgent = this.requireChildAgent(childAgentId);
    if (childAgent.status !== "running" && childAgent.status !== "created") return clone(childAgent);
    const next = this.setChildAgentStatus(childAgent, "paused");
    this.recordAudit("child_agent.paused", "child_agent", childAgentId, actorId, childAgent, next, details);
    return clone(next);
  }

  public resumeChildAgent(childAgentId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceChildAgent {
    const childAgent = this.requireChildAgent(childAgentId);
    if (childAgent.status !== "paused") return clone(childAgent);
    const next = this.setChildAgentStatus(childAgent, "running");
    this.recordAudit("child_agent.resumed", "child_agent", childAgentId, actorId, childAgent, next, details);
    return clone(next);
  }

  public cancelChildAgent(childAgentId: string, actorId: string, details?: Record<string, unknown>): PersonalAssistantGovernanceChildAgent {
    const childAgent = this.requireChildAgent(childAgentId);
    if (["completed", "failed", "cancelled"].includes(childAgent.status)) return clone(childAgent);
    const next = this.setChildAgentStatus(childAgent, "cancelled");
    this.recordAudit("child_agent.cancelled", "child_agent", childAgentId, actorId, childAgent, next, details);
    return clone(next);
  }

  private updateApproval(
    approvalId: string,
    status: "approved" | "rejected",
    actorId: string,
    details?: Record<string, unknown>
  ): PersonalAssistantGovernanceApproval {
    const approval = this.requireApproval(approvalId);
    if (approval.status !== "pending") return clone(approval);
    const now = new Date().toISOString();
    const next: PersonalAssistantGovernanceApproval = {
      ...approval,
      status,
      approver_id: actorId,
      decided_at: now
    };
    this.approvals.set(approvalId, clone(next));
    this.recordAudit(`approval.${status}`, "approval", approvalId, actorId, approval, next, details);
    return clone(next);
  }

  private setScheduleStatus(
    schedule: PersonalAssistantGovernanceSchedule,
    status: PersonalAssistantGovernanceScheduleStatus
  ): PersonalAssistantGovernanceSchedule {
    const next = {
      ...schedule,
      status,
      enabled: status === "active",
      updated_at: new Date().toISOString()
    };
    this.schedules.set(schedule.id, clone(next));
    return next;
  }

  private setChildAgentStatus(
    childAgent: PersonalAssistantGovernanceChildAgent,
    status: PersonalAssistantGovernanceChildAgentStatus
  ): PersonalAssistantGovernanceChildAgent {
    const next = {
      ...childAgent,
      status,
      updated_at: new Date().toISOString()
    };
    this.childAgents.set(childAgent.child_agent_id, clone(next));
    return next;
  }

  private recordAudit(
    action: string,
    targetType: PersonalAssistantGovernanceTargetType,
    targetId: string,
    actorId: string,
    before: unknown,
    after: unknown,
    details?: Record<string, unknown>
  ): void {
    this.auditRecords.push({
      audit_id: `pag_${randomUUID()}`,
      action,
      target_type: targetType,
      target_id: targetId,
      actor_id: actorId,
      created_at: new Date().toISOString(),
      before: clone(before),
      after: clone(after),
      details: details ? clone(details) : undefined
    });
  }

  private requireApproval(approvalId: string): PersonalAssistantGovernanceApproval {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`Unknown approval: ${approvalId}`);
    return clone(approval);
  }

  private requireBackgroundTask(taskId: string): BackgroundTaskEntry {
    const task = this.backgroundTasks.get(taskId);
    if (!task) throw new Error(`Unknown background task: ${taskId}`);
    return clone(task);
  }

  private requireSchedule(scheduleId: string): PersonalAssistantGovernanceSchedule {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new Error(`Unknown schedule: ${scheduleId}`);
    return clone(schedule);
  }

  private requireChildAgent(childAgentId: string): PersonalAssistantGovernanceChildAgent {
    const childAgent = this.childAgents.get(childAgentId);
    if (!childAgent) throw new Error(`Unknown child agent: ${childAgentId}`);
    return clone(childAgent);
  }
}

function sortByUpdatedAt<T extends { updated_at: string }>(items: T[]): T[] {
  return items.sort((left, right) => right.updated_at.localeCompare(left.updated_at)).map((item) => clone(item));
}

function sortByTimestamp<T extends object>(items: T[], key: keyof T): T[] {
  return items.sort((left, right) => String(right[key] ?? "").localeCompare(String(left[key] ?? ""))).map((item) => clone(item));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
