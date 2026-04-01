export interface AgentLifecycleManager {
  spawn(agentId: string, instanceId: string, options?: Record<string, unknown>): Promise<string>;
  terminate(instanceId: string, force?: boolean): Promise<void>;
  drain(instanceId: string): Promise<void>;
  pause(instanceId: string): Promise<void>;
  resume(instanceId: string): Promise<void>;
}
