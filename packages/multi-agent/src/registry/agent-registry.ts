import type { AgentDescriptor, AgentQuery, AgentStatus, StatusChangeCallback } from "../types.js";

export interface AgentRegistry {
  register(descriptor: AgentDescriptor): Promise<void>;
  deregister(instanceId: string): Promise<void>;
  heartbeat(instanceId: string): Promise<void>;
  discover(query: AgentQuery): Promise<AgentDescriptor[]>;
  get(instanceId: string): Promise<AgentDescriptor | undefined>;
  listAll(): Promise<AgentDescriptor[]>;
  onStatusChange(callback: StatusChangeCallback): void;
}
