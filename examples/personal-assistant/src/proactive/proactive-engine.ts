import type { AgentBuilder } from "@neurocore/sdk-core";
import { createUserInput } from "../im-gateway/input/input-factory.js";
import type { IMGateway } from "../im-gateway/gateway.js";
import { BackgroundTaskLedger } from "./background-task-ledger.js";
import { HeartbeatScheduler } from "./heartbeat/heartbeat-scheduler.js";
import { CronScheduler } from "./scheduler/cron-scheduler.js";
import type { BackgroundTaskEntry, CheckResult, HeartbeatCheck, ScheduleEntry } from "./types.js";

export interface ProactiveEngineOptions {
  agent: AgentBuilder;
  gateway: IMGateway;
  tenantId: string;
}

export class ProactiveEngine {
  private heartbeatScheduler?: HeartbeatScheduler;
  private readonly cronScheduler: CronScheduler;
  public readonly taskLedger: BackgroundTaskLedger;

  public constructor(private readonly options: ProactiveEngineOptions) {
    this.taskLedger = new BackgroundTaskLedger();
    this.cronScheduler = new CronScheduler({
      onTriggered: async (entry) => {
        await this.runScheduledTask(entry);
      }
    });
  }

  public registerHeartbeat(checks: HeartbeatCheck[], intervalMs = 30 * 60 * 1000): void {
    this.heartbeatScheduler = new HeartbeatScheduler({
      checks,
      intervalMs,
      onTriggered: async (results) => {
        await this.runHeartbeatResults(results);
      }
    });
  }

  public registerSchedule(entry: ScheduleEntry): void {
    this.cronScheduler.register(entry);
  }

  public async start(): Promise<void> {
    this.heartbeatScheduler?.start();
    this.cronScheduler.start();
  }

  public async stop(): Promise<void> {
    this.heartbeatScheduler?.stop();
    this.cronScheduler.stop();
  }

  public listBackgroundTasks(): BackgroundTaskEntry[] {
    return this.taskLedger.list();
  }

  public getBackgroundTask(taskId: string): BackgroundTaskEntry | undefined {
    return this.taskLedger.get(taskId);
  }

  public cancelBackgroundTask(taskId: string): BackgroundTaskEntry | undefined {
    const task = this.taskLedger.get(taskId);
    if (task?.session_id) {
      try {
        this.options.agent.connectSession(task.session_id).cancel();
      } catch {}
    }
    return this.taskLedger.cancel(taskId);
  }

  private async runHeartbeatResults(results: CheckResult[]): Promise<void> {
    for (const result of results) {
      const task = this.taskLedger.create({
        source: "heartbeat",
        description: result.summary,
        target_user: result.target_user,
        target_platform: result.target_platform,
        priority: result.priority,
        metadata: {
          payload: result.payload ?? {}
        }
      });
      const session = this.options.agent.createSession({
        agent_id: this.options.agent.getProfile().agent_id,
        tenant_id: this.options.tenantId,
        user_id: result.target_user,
        session_mode: "async",
        initial_input: createUserInput(
          `System heartbeat detected:\n${result.summary}\nDecide whether the user should be notified.`,
          {
            source: "heartbeat",
            background_task_id: task.task_id,
            payload: result.payload ?? {}
          }
        )
      });
      this.taskLedger.markRunning(task.task_id, session.id);

      try {
        const run = await session.run();
        const lastStep = run.steps.at(-1);
        if (lastStep?.approval) {
          const deliveryTarget = { platform: result.target_platform, priority: result.priority };
          await this.options.gateway.pushApprovalRequest(
            result.target_user,
            session.id,
            lastStep.approval,
            deliveryTarget
          );
          this.taskLedger.markApprovalRequested(task.task_id, lastStep.approval.approval_id, deliveryTarget);
          continue;
        }

        if (run.outputText) {
          const deliveryTarget = { platform: result.target_platform, priority: result.priority };
          await this.options.gateway.pushNotification(
            result.target_user,
            { type: "text", text: run.outputText },
            deliveryTarget
          );
          this.taskLedger.markSucceeded(task.task_id, {
            result_text: run.outputText,
            delivered_at: new Date().toISOString(),
            delivery_target: deliveryTarget
          });
          continue;
        }

        this.taskLedger.markSucceeded(task.task_id);
      } catch (error) {
        this.taskLedger.markFailed(task.task_id, error);
        throw error;
      }
    }
  }

  private async runScheduledTask(entry: ScheduleEntry): Promise<void> {
    const task = this.taskLedger.create({
      source: "schedule",
      description: entry.task_description,
      target_user: entry.target_user,
      target_platform: entry.target_platform,
      metadata: {
        schedule_id: entry.id
      }
    });
    const session = this.options.agent.createSession({
      agent_id: this.options.agent.getProfile().agent_id,
      tenant_id: this.options.tenantId,
      user_id: entry.target_user,
      session_mode: "async",
      initial_input: createUserInput(`Execute scheduled task: ${entry.task_description}`, {
        source: "schedule",
        background_task_id: task.task_id,
        schedule_id: entry.id
      })
    });
    this.taskLedger.markRunning(task.task_id, session.id);

    try {
      const run = await session.run();
      const lastStep = run.steps.at(-1);
      if (lastStep?.approval) {
        const deliveryTarget = { platform: entry.target_platform };
        await this.options.gateway.pushApprovalRequest(
          entry.target_user,
          session.id,
          lastStep.approval,
          deliveryTarget
        );
        this.taskLedger.markApprovalRequested(task.task_id, lastStep.approval.approval_id, deliveryTarget);
        return;
      }

      if (run.outputText) {
        const deliveryTarget = { platform: entry.target_platform };
        await this.options.gateway.pushNotification(
          entry.target_user,
          { type: "text", text: run.outputText },
          deliveryTarget
        );
        this.taskLedger.markSucceeded(task.task_id, {
          result_text: run.outputText,
          delivered_at: new Date().toISOString(),
          delivery_target: deliveryTarget
        });
        return;
      }

      this.taskLedger.markSucceeded(task.task_id);
    } catch (error) {
      this.taskLedger.markFailed(task.task_id, error);
      throw error;
    }
  }
}
