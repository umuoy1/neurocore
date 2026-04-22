import type { AgentSpawnOptions } from "../types.js";

export interface AgentLifecycleManager {
  spawn(agentId: string, instanceId: string, options?: AgentSpawnOptions): Promise<string>;
  terminate(instanceId: string, force?: boolean): Promise<void>;
  drain(instanceId: string): Promise<void>;
  pause(instanceId: string): Promise<void>;
  resume(instanceId: string): Promise<void>;
}
