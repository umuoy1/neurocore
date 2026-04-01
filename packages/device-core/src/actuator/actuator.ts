import type { ActuatorCommand, ActuatorDescriptor, ActuatorResult } from "../types.js";

export interface Actuator {
  readonly descriptor: ActuatorDescriptor;
  initialize(): Promise<void>;
  execute(command: ActuatorCommand): Promise<ActuatorResult>;
  stop(): Promise<void>;
  emergencyStop?(): Promise<void>;
  getStatus(): ActuatorDescriptor["status"];
}
