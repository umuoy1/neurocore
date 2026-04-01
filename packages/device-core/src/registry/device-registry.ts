import type { Sensor } from "../sensor/sensor.js";
import type { Actuator } from "../actuator/actuator.js";
import type { DeviceHealthCallback, DeviceInfo, DeviceQuery } from "../types.js";

export interface DeviceRegistry {
  registerSensor(sensor: Sensor): void;
  registerActuator(actuator: Actuator): void;
  unregister(device_id: string): void;

  getSensor(sensor_id: string): Sensor | undefined;
  getActuator(actuator_id: string): Actuator | undefined;

  query(query: DeviceQuery): DeviceInfo[];
  listAll(): DeviceInfo[];

  startHealthCheck(interval_ms: number): void;
  stopHealthCheck(): void;
  onHealthChange(callback: DeviceHealthCallback): () => void;
}
