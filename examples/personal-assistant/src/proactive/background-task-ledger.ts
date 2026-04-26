import { randomUUID } from "node:crypto";
import type { BackgroundTaskEntry } from "./types.js";

export interface CreateBackgroundTaskInput {
  source: BackgroundTaskEntry["source"];
  description: string;
  target_user: string;
  target_platform?: BackgroundTaskEntry["target_platform"];
  priority?: BackgroundTaskEntry["priority"];
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export class BackgroundTaskLedger {
  private readonly tasks = new Map<string, BackgroundTaskEntry>();

  public create(input: CreateBackgroundTaskInput): BackgroundTaskEntry {
    const now = input.created_at ?? new Date().toISOString();
    const task: BackgroundTaskEntry = {
      task_id: `bgt_${randomUUID()}`,
      source: input.source,
      status: "created",
      description: input.description,
      target_user: input.target_user,
      target_platform: input.target_platform,
      priority: input.priority,
      created_at: now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    this.tasks.set(task.task_id, task);
    return structuredClone(task);
  }

  public markRunning(taskId: string, sessionId: string, startedAt = new Date().toISOString()): BackgroundTaskEntry {
    return this.update(taskId, {
      status: "running",
      session_id: sessionId,
      started_at: startedAt,
      updated_at: startedAt
    });
  }

  public markSucceeded(
    taskId: string,
    input: {
      result_text?: string;
      delivered_at?: string;
      delivery_target?: BackgroundTaskEntry["delivery_target"];
      completed_at?: string;
    } = {}
  ): BackgroundTaskEntry {
    const completedAt = input.completed_at ?? new Date().toISOString();
    return this.update(taskId, {
      status: "succeeded",
      result_text: input.result_text,
      delivered_at: input.delivered_at,
      delivery_target: input.delivery_target,
      completed_at: completedAt,
      updated_at: completedAt
    });
  }

  public markFailed(taskId: string, error: unknown, failedAt = new Date().toISOString()): BackgroundTaskEntry {
    return this.update(taskId, {
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      completed_at: failedAt,
      updated_at: failedAt
    });
  }

  public markApprovalRequested(
    taskId: string,
    approvalId: string,
    deliveryTarget: BackgroundTaskEntry["delivery_target"],
    updatedAt = new Date().toISOString()
  ): BackgroundTaskEntry {
    return this.update(taskId, {
      status: "running",
      approval_id: approvalId,
      delivery_target: deliveryTarget,
      delivered_at: updatedAt,
      updated_at: updatedAt
    });
  }

  public mergeMetadata(taskId: string, metadata: Record<string, unknown>): BackgroundTaskEntry {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown background task: ${taskId}`);
    }
    return this.update(taskId, {
      metadata: {
        ...task.metadata,
        ...metadata
      },
      updated_at: new Date().toISOString()
    });
  }

  public cancel(taskId: string, cancelledAt = new Date().toISOString()): BackgroundTaskEntry | undefined {
    const task = this.tasks.get(taskId);
    if (!task || task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") {
      return task ? structuredClone(task) : undefined;
    }
    return this.update(taskId, {
      status: "cancelled",
      cancelled_at: cancelledAt,
      completed_at: cancelledAt,
      updated_at: cancelledAt
    });
  }

  public get(taskId: string): BackgroundTaskEntry | undefined {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  public list(): BackgroundTaskEntry[] {
    return [...this.tasks.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((task) => structuredClone(task));
  }

  private update(taskId: string, patch: Partial<BackgroundTaskEntry>): BackgroundTaskEntry {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown background task: ${taskId}`);
    }
    const next = {
      ...task,
      ...patch
    };
    this.tasks.set(taskId, next);
    return structuredClone(next);
  }
}
