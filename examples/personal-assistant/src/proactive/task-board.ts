import { BackgroundTaskLedger } from "./background-task-ledger.js";
import type { BackgroundTaskEntry } from "./types.js";

export interface TaskBoardArtifactRef {
  artifact_id: string;
  artifact_type: string;
  ref?: string;
  title?: string;
}

export interface TaskBoardItem {
  task_id: string;
  source: BackgroundTaskEntry["source"];
  status: BackgroundTaskEntry["status"];
  description: string;
  target_user: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  error_message?: string;
  trace_ids: string[];
  goal_ids: string[];
  artifacts: TaskBoardArtifactRef[];
  retry_of?: string;
  retry_attempt: number;
  can_cancel: boolean;
  can_retry: boolean;
}

export interface TaskBoardDetail extends TaskBoardItem {
  task: BackgroundTaskEntry;
  timeline: Array<{
    event: string;
    at: string;
  }>;
}

export interface TaskBoardAuditRecord {
  audit_id: string;
  action: "task.cancelled" | "task.retried";
  task_id: string;
  actor_id: string;
  created_at: string;
  before?: BackgroundTaskEntry;
  after?: BackgroundTaskEntry;
  details?: Record<string, unknown>;
}

export interface PersonalAssistantTaskBoardOptions {
  ledger: BackgroundTaskLedger;
  now?: () => string;
}

export class PersonalAssistantTaskBoard {
  private readonly auditRecords: TaskBoardAuditRecord[] = [];
  private readonly now: () => string;

  public constructor(private readonly options: PersonalAssistantTaskBoardOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public list(): TaskBoardItem[] {
    return this.options.ledger.list().map(toTaskBoardItem);
  }

  public detail(taskId: string): TaskBoardDetail {
    const task = this.requireTask(taskId);
    return {
      ...toTaskBoardItem(task),
      task,
      timeline: buildTimeline(task)
    };
  }

  public cancel(taskId: string, actorId: string, details?: Record<string, unknown>): TaskBoardDetail {
    const before = this.requireTask(taskId);
    const after = this.options.ledger.cancel(taskId, this.now()) ?? before;
    if (before.status !== after.status) {
      this.auditRecords.push({
        audit_id: `tba_${this.auditRecords.length + 1}`,
        action: "task.cancelled",
        task_id: taskId,
        actor_id: actorId,
        created_at: this.now(),
        before,
        after,
        details
      });
    }
    return this.detail(taskId);
  }

  public retry(taskId: string, actorId: string, details?: Record<string, unknown>): TaskBoardDetail {
    const before = this.requireTask(taskId);
    if (!["failed", "cancelled"].includes(before.status)) {
      return this.detail(taskId);
    }
    const retryAttempt = readRetryAttempt(before) + 1;
    const next = this.options.ledger.create({
      source: before.source,
      description: before.description,
      target_user: before.target_user,
      target_platform: before.target_platform,
      priority: before.priority,
      metadata: {
        ...before.metadata,
        retry_of: before.task_id,
        retry_attempt: retryAttempt,
        original_task_id: before.metadata.original_task_id ?? before.task_id
      },
      created_at: this.now()
    });
    this.auditRecords.push({
      audit_id: `tba_${this.auditRecords.length + 1}`,
      action: "task.retried",
      task_id: next.task_id,
      actor_id: actorId,
      created_at: this.now(),
      before,
      after: next,
      details
    });
    return this.detail(next.task_id);
  }

  public listAuditRecords(): TaskBoardAuditRecord[] {
    return this.auditRecords.map((record) => structuredClone(record));
  }

  private requireTask(taskId: string): BackgroundTaskEntry {
    const task = this.options.ledger.get(taskId);
    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }
}

function toTaskBoardItem(task: BackgroundTaskEntry): TaskBoardItem {
  const status = task.status;
  return {
    task_id: task.task_id,
    source: task.source,
    status,
    description: task.description,
    target_user: task.target_user,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    error_message: task.error_message,
    trace_ids: readStringList(task.metadata.trace_ids),
    goal_ids: readStringList(task.metadata.goal_ids ?? task.metadata.standing_order_ids),
    artifacts: readArtifacts(task.metadata.artifacts ?? task.metadata.artifact_refs),
    retry_of: typeof task.metadata.retry_of === "string" ? task.metadata.retry_of : undefined,
    retry_attempt: readRetryAttempt(task),
    can_cancel: !["succeeded", "failed", "cancelled"].includes(status),
    can_retry: status === "failed" || status === "cancelled"
  };
}

function buildTimeline(task: BackgroundTaskEntry): TaskBoardDetail["timeline"] {
  return [
    { event: "created", at: task.created_at },
    task.started_at ? { event: "running", at: task.started_at } : undefined,
    task.delivered_at ? { event: "delivered", at: task.delivered_at } : undefined,
    task.completed_at ? { event: task.status, at: task.completed_at } : undefined,
    task.cancelled_at ? { event: "cancelled", at: task.cancelled_at } : undefined
  ].filter((event): event is { event: string; at: string } => Boolean(event));
}

function readRetryAttempt(task: BackgroundTaskEntry): number {
  return typeof task.metadata.retry_attempt === "number" ? task.metadata.retry_attempt : 0;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readArtifacts(value: unknown): TaskBoardArtifactRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({
      artifact_id: typeof item.artifact_id === "string" ? item.artifact_id : String(item.ref ?? "artifact"),
      artifact_type: typeof item.artifact_type === "string" ? item.artifact_type : "artifact",
      ref: typeof item.ref === "string" ? item.ref : undefined,
      title: typeof item.title === "string" ? item.title : undefined
    }));
}
