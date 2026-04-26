import type { AgentBuilder } from "@neurocore/sdk-core";
import { createUserInput } from "../im-gateway/input/input-factory.js";
import type { IMGateway } from "../im-gateway/gateway.js";
import { BackgroundTaskLedger } from "./background-task-ledger.js";
import { HeartbeatScheduler } from "./heartbeat/heartbeat-scheduler.js";
import { CronScheduler } from "./scheduler/cron-scheduler.js";
import type {
  BackgroundTaskEntry,
  CheckResult,
  CreateStandingOrderInput,
  HeartbeatCheck,
  ScheduleEntry,
  StandingOrderRecord
} from "./types.js";
import type { StandingOrderStore } from "./standing-order-store.js";

export interface ProactiveEngineOptions {
  agent: AgentBuilder;
  gateway: IMGateway;
  tenantId: string;
  standingOrderStore?: StandingOrderStore;
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

  public registerStandingOrder(input: CreateStandingOrderInput): StandingOrderRecord {
    return this.requireStandingOrderStore().create(input);
  }

  public listStandingOrders(input: {
    owner_user_id?: string;
    user_id?: string;
    target_platform?: CheckResult["target_platform"];
    now?: string;
  } = {}): StandingOrderRecord[] {
    const store = this.options.standingOrderStore;
    if (!store) {
      return [];
    }
    return store.listActive({
      owner_user_id: input.owner_user_id,
      user_id: input.user_id,
      platform: input.target_platform,
      now: input.now
    });
  }

  public pauseStandingOrder(orderId: string): StandingOrderRecord | undefined {
    return this.options.standingOrderStore?.updateStatus(orderId, "paused");
  }

  public resumeStandingOrder(orderId: string): StandingOrderRecord | undefined {
    return this.options.standingOrderStore?.updateStatus(orderId, "active");
  }

  public listSchedules(): ScheduleEntry[] {
    return this.cronScheduler.list();
  }

  public getSchedule(entryId: string): ScheduleEntry | undefined {
    return this.cronScheduler.get(entryId);
  }

  public pauseSchedule(entryId: string): ScheduleEntry | undefined {
    return this.cronScheduler.pause(entryId);
  }

  public resumeSchedule(entryId: string): ScheduleEntry | undefined {
    return this.cronScheduler.resume(entryId);
  }

  public removeSchedule(entryId: string): boolean {
    return this.cronScheduler.remove(entryId);
  }

  public async runScheduleNow(entryId: string): Promise<boolean> {
    return this.cronScheduler.runNow(entryId);
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
      const standingOrders = this.getStandingOrdersForHeartbeat(result);
      const task = this.taskLedger.create({
        source: "heartbeat",
        description: result.summary,
        target_user: result.target_user,
        target_platform: result.target_platform,
        priority: result.priority,
        metadata: {
          payload: result.payload ?? {},
          standing_order_ids: standingOrders.map((order) => order.order_id),
          standing_orders: standingOrders.map(toStandingOrderMetadata)
        }
      });
      const session = this.options.agent.createSession({
        agent_id: this.options.agent.getProfile().agent_id,
        tenant_id: this.options.tenantId,
        user_id: result.target_user,
        session_mode: "async",
        initial_input: createUserInput(
          buildHeartbeatPrompt(result, standingOrders),
          {
            source: "heartbeat",
            background_task_id: task.task_id,
            payload: result.payload ?? {},
            standing_order_ids: standingOrders.map((order) => order.order_id),
            standing_orders: standingOrders.map(toStandingOrderMetadata)
          }
        )
      });
      this.taskLedger.markRunning(task.task_id, session.id);
      for (const order of standingOrders) {
        this.options.standingOrderStore?.markApplied(order.order_id);
      }

      try {
        const run = await session.run();
        this.taskLedger.mergeMetadata(task.task_id, {
          trace_ids: run.traces.map((trace) => trace.trace_id),
          cycle_ids: run.traces.map((trace) => trace.cycle_id)
        });
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

  private getStandingOrdersForHeartbeat(result: CheckResult): StandingOrderRecord[] {
    return this.options.standingOrderStore?.listActive({
      user_id: result.target_user,
      platform: result.target_platform
    }) ?? [];
  }

  private requireStandingOrderStore(): StandingOrderStore {
    if (!this.options.standingOrderStore) {
      throw new Error("Standing order store is not configured.");
    }
    return this.options.standingOrderStore;
  }
}

function buildHeartbeatPrompt(result: CheckResult, standingOrders: StandingOrderRecord[]): string {
  const orders = standingOrders.length > 0
    ? `Standing orders:\n${standingOrders.map((order) => `- [${order.order_id}] ${order.instruction}`).join("\n")}\n\n`
    : "";
  return `${orders}System heartbeat detected:\n${result.summary}\nDecide whether the user should be notified.`;
}

function toStandingOrderMetadata(order: StandingOrderRecord): Record<string, unknown> {
  return {
    order_id: order.order_id,
    owner_user_id: order.owner_user_id,
    instruction: order.instruction,
    scope: order.scope,
    permission: order.permission,
    expires_at: order.expires_at,
    metadata: order.metadata
  };
}
