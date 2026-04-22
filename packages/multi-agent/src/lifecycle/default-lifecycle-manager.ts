import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import type { AgentSpawnOptions, AgentStatus } from "../types.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { InterAgentBus } from "../bus/inter-agent-bus.js";
import type { DistributedGoalManager } from "../goal/distributed-goal-manager.js";
import type { AgentLifecycleManager } from "./agent-lifecycle-manager.js";

interface ManagedInstance {
  agentId: string;
  instanceId: string;
  status: AgentStatus;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  paused: boolean;
  mode: "in_memory" | "child_process" | "remote";
  endpoint?: string;
  process?: ChildProcess;
  resourceLimits?: AgentSpawnOptions["resource_limits"];
  gracefulShutdownTimeoutMs: number;
  saveState?: AgentSpawnOptions["save_state"];
  stateSnapshot?: Record<string, unknown>;
}

export class DefaultAgentLifecycleManager implements AgentLifecycleManager {
  private readonly instances = new Map<string, ManagedInstance>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly bus: InterAgentBus,
    private readonly goalManager?: DistributedGoalManager
  ) {}

  async spawn(agentId: string, instanceId: string, options?: AgentSpawnOptions): Promise<string> {
    const now = new Date().toISOString();
    const mode = options?.mode ?? "in_memory";
    const childProcess = mode === "child_process" && options?.command
      ? spawnChildProcess(options.command, options.args ?? [], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: "ignore"
      })
      : undefined;
    await this.registry.register({
      agent_id: agentId,
      instance_id: instanceId,
      name: agentId,
      version: "1.0.0",
      status: "idle",
      capabilities: [],
      domains: [],
      current_load: 0,
      endpoint: options?.endpoint,
      max_capacity: options?.max_capacity ?? 5,
      heartbeat_interval_ms: options?.heartbeat_interval_ms ?? 30_000,
      last_heartbeat_at: now,
      registered_at: now,
      metadata: {
        mode,
        resource_limits: options?.resource_limits,
        state_snapshot: options?.state_snapshot
      }
    });

    this.instances.set(instanceId, {
      agentId,
      instanceId,
      status: "idle",
      paused: false,
      mode,
      endpoint: options?.endpoint,
      process: childProcess,
      resourceLimits: options?.resource_limits,
      gracefulShutdownTimeoutMs: options?.graceful_shutdown_timeout_ms ?? 5_000,
      saveState: options?.save_state,
      stateSnapshot: options?.state_snapshot
    });

    if (childProcess) {
      childProcess.once("exit", async () => {
        await this.registry.deregister(instanceId);
        this.instances.delete(instanceId);
      });
    }

    return instanceId;
  }

  async terminate(instanceId: string, force = false): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    if (!force && instance.status === "busy") {
      await this.drain(instanceId);
      return;
    }

    if (instance.heartbeatTimer) {
      clearInterval(instance.heartbeatTimer);
    }
    instance.stateSnapshot = await instance.saveState?.(instanceId) ?? instance.stateSnapshot;
    if (instance.process) {
      if (force) {
        instance.process.kill("SIGKILL");
      } else {
        instance.process.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => instance.process?.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, instance.gracefulShutdownTimeoutMs))
        ]);
        if (!instance.process.killed) {
          instance.process.kill("SIGKILL");
        }
      }
    }
    await this.registry.deregister(instanceId);
    this.instances.delete(instanceId);
  }

  async drain(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.status = "draining";
    const agent = await this.registry.get(instanceId);
    if (agent) {
      (agent as { status: AgentStatus }).status = "draining";
    }
  }

  async pause(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.paused = true;
  }

  async resume(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.paused = false;
  }

  isDraining(instanceId: string): boolean {
    return this.instances.get(instanceId)?.status === "draining";
  }

  isPaused(instanceId: string): boolean {
    return this.instances.get(instanceId)?.paused ?? false;
  }

  getInstance(instanceId: string): ManagedInstance | undefined {
    return this.instances.get(instanceId);
  }
}
