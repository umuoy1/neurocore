import type { AgentBuilder } from "@neurocore/sdk-core";
import { createUserInput } from "../im-gateway/input/input-factory.js";
import type { IMGateway } from "../im-gateway/gateway.js";
import { HeartbeatScheduler } from "./heartbeat/heartbeat-scheduler.js";
import { CronScheduler } from "./scheduler/cron-scheduler.js";
import type { CheckResult, HeartbeatCheck, ScheduleEntry } from "./types.js";

export interface ProactiveEngineOptions {
  agent: AgentBuilder;
  gateway: IMGateway;
  tenantId: string;
}

export class ProactiveEngine {
  private heartbeatScheduler?: HeartbeatScheduler;
  private readonly cronScheduler: CronScheduler;

  public constructor(private readonly options: ProactiveEngineOptions) {
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

  private async runHeartbeatResults(results: CheckResult[]): Promise<void> {
    for (const result of results) {
      const session = this.options.agent.createSession({
        agent_id: this.options.agent.getProfile().agent_id,
        tenant_id: this.options.tenantId,
        user_id: result.target_user,
        session_mode: "async",
        initial_input: createUserInput(
          `System heartbeat detected:\n${result.summary}\nDecide whether the user should be notified.`,
          {
            source: "heartbeat",
            payload: result.payload ?? {}
          }
        )
      });

      const run = await session.run();
      const lastStep = run.steps.at(-1);
      if (lastStep?.approval) {
        await this.options.gateway.pushApprovalRequest(
          result.target_user,
          session.id,
          lastStep.approval,
          { platform: result.target_platform, priority: result.priority }
        );
        continue;
      }

      if (run.outputText) {
        await this.options.gateway.pushNotification(
          result.target_user,
          { type: "text", text: run.outputText },
          { platform: result.target_platform, priority: result.priority }
        );
      }
    }
  }

  private async runScheduledTask(entry: ScheduleEntry): Promise<void> {
    const session = this.options.agent.createSession({
      agent_id: this.options.agent.getProfile().agent_id,
      tenant_id: this.options.tenantId,
      user_id: entry.target_user,
      session_mode: "async",
      initial_input: createUserInput(`Execute scheduled task: ${entry.task_description}`, {
        source: "schedule",
        schedule_id: entry.id
      })
    });

    const run = await session.run();
    const lastStep = run.steps.at(-1);
    if (lastStep?.approval) {
      await this.options.gateway.pushApprovalRequest(
        entry.target_user,
        session.id,
        lastStep.approval,
        { platform: entry.target_platform }
      );
      return;
    }

    if (run.outputText) {
      await this.options.gateway.pushNotification(
        entry.target_user,
        { type: "text", text: run.outputText },
        { platform: entry.target_platform }
      );
    }
  }
}
