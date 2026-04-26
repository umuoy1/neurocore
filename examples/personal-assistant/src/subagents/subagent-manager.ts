import type { AgentBuilder, AgentSessionHandle } from "@neurocore/sdk-core";
import { createUserInput } from "../im-gateway/input/input-factory.js";
import { BackgroundTaskLedger } from "../proactive/background-task-ledger.js";
import type { BackgroundTaskEntry } from "../proactive/types.js";

export interface SubagentManagerOptions {
  agent: AgentBuilder;
  tenantId: string;
  taskLedger?: BackgroundTaskLedger;
}

export interface SpawnSubagentInput {
  parent_session_id: string;
  target_user: string;
  description: string;
  input?: string;
  auto_run?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SpawnedSubagentTask {
  task: BackgroundTaskEntry;
  session: AgentSessionHandle;
  completion?: Promise<BackgroundTaskEntry>;
}

export class SubagentManager {
  public readonly taskLedger: BackgroundTaskLedger;
  private readonly sessionByTaskId = new Map<string, AgentSessionHandle>();

  public constructor(private readonly options: SubagentManagerOptions) {
    this.taskLedger = options.taskLedger ?? new BackgroundTaskLedger();
  }

  public spawn(input: SpawnSubagentInput): SpawnedSubagentTask {
    const task = this.taskLedger.create({
      source: "manual",
      description: input.description,
      target_user: input.target_user,
      metadata: {
        ...(input.metadata ?? {}),
        parent_session_id: input.parent_session_id,
        subagent: true
      }
    });
    const session = this.options.agent.createSession({
      agent_id: this.options.agent.getProfile().agent_id,
      tenant_id: this.options.tenantId,
      user_id: input.target_user,
      session_mode: "async",
      initial_input: createUserInput(input.input ?? input.description, {
        source: "subagent",
        background_task_id: task.task_id,
        parent_session_id: input.parent_session_id
      })
    });
    this.sessionByTaskId.set(task.task_id, session);
    const running = this.taskLedger.markRunning(task.task_id, session.id);

    if (input.auto_run === false) {
      return { task: running, session };
    }

    const completion = this.runSubagentTask(task.task_id, session);
    return { task: running, session, completion };
  }

  public list(): BackgroundTaskEntry[] {
    return this.taskLedger.list().filter((task) => task.metadata.subagent === true);
  }

  public get(taskId: string): BackgroundTaskEntry | undefined {
    const task = this.taskLedger.get(taskId);
    return task?.metadata.subagent === true ? task : undefined;
  }

  public cancel(taskId: string): BackgroundTaskEntry | undefined {
    const session = this.sessionByTaskId.get(taskId);
    if (session) {
      try {
        session.cancel();
      } catch {}
    }
    return this.taskLedger.cancel(taskId);
  }

  public cancelByParentSession(parentSessionId: string): BackgroundTaskEntry[] {
    return this.list()
      .filter((task) => task.metadata.parent_session_id === parentSessionId)
      .map((task) => this.cancel(task.task_id))
      .filter((task): task is BackgroundTaskEntry => Boolean(task));
  }

  private async runSubagentTask(taskId: string, session: AgentSessionHandle): Promise<BackgroundTaskEntry> {
    try {
      const run = await session.run();
      if (run.outputText) {
        return this.taskLedger.markSucceeded(taskId, {
          result_text: run.outputText
        });
      }
      return this.taskLedger.markSucceeded(taskId);
    } catch (error) {
      return this.taskLedger.markFailed(taskId, error);
    }
  }
}
