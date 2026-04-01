import type { Sensor } from "../sensor/sensor.js";
import type { Actuator } from "../actuator/actuator.js";
import type {
  DeviceHealthCallback,
  DeviceInfo,
  DeviceQuery,
  SensorDescriptor,
  ActuatorDescriptor
} from "../types.js";
import type { DeviceRegistry } from "./device-registry.js";

export class InMemoryDeviceRegistry implements DeviceRegistry {
  private readonly sensors = new Map<string, { sensor: Sensor; info: DeviceInfo }>();
  private readonly actuators = new Map<string, { actuator: Actuator; info: DeviceInfo }>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly healthCallbacks = new Set<DeviceHealthCallback>();
  private readonly failureCounts = new Map<string, number>();

  registerSensor(sensor: Sensor): void {
    const id = sensor.descriptor.sensor_id;
    if (this.sensors.has(id) || this.actuators.has(id)) {
      throw new Error(`Device ${id} is already registered`);
    }
    const info: DeviceInfo = {
      device_id: id,
      device_type: "sensor",
      descriptor: sensor.descriptor,
      registered_at: new Date().toISOString(),
      health_status: "unknown"
    };
    this.sensors.set(id, { sensor, info });
  }

  registerActuator(actuator: Actuator): void {
    const id = actuator.descriptor.actuator_id;
    if (this.sensors.has(id) || this.actuators.has(id)) {
      throw new Error(`Device ${id} is already registered`);
    }
    const info: DeviceInfo = {
      device_id: id,
      device_type: "actuator",
      descriptor: actuator.descriptor,
      registered_at: new Date().toISOString(),
      health_status: "unknown"
    };
    this.actuators.set(id, { actuator, info });
  }

  unregister(device_id: string): void {
    this.sensors.delete(device_id);
    this.actuators.delete(device_id);
    this.failureCounts.delete(device_id);
  }

  getSensor(sensor_id: string): Sensor | undefined {
    return this.sensors.get(sensor_id)?.sensor;
  }

  getActuator(actuator_id: string): Actuator | undefined {
    return this.actuators.get(actuator_id)?.actuator;
  }

  query(q: DeviceQuery): DeviceInfo[] {
    const results: DeviceInfo[] = [];
    for (const { info } of this.sensors.values()) {
      if (this.matchesQuery(info, q)) results.push(info);
    }
    for (const { info } of this.actuators.values()) {
      if (this.matchesQuery(info, q)) results.push(info);
    }
    return results;
  }

  listAll(): DeviceInfo[] {
    return [
      ...[...this.sensors.values()].map((e) => e.info),
      ...[...this.actuators.values()].map((e) => e.info)
    ];
  }

  startHealthCheck(interval_ms: number): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck();
    }, interval_ms);
  }

  stopHealthCheck(): void {
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  onHealthChange(callback: DeviceHealthCallback): () => void {
    this.healthCallbacks.add(callback);
    return () => {
      this.healthCallbacks.delete(callback);
    };
  }

  private async runHealthCheck(): Promise<void> {
    for (const [id, entry] of this.sensors) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 3000)
        );
        await Promise.race([entry.sensor.read(), timeoutPromise]);
        this.failureCounts.set(id, 0);
        this.updateHealth(entry.info, "healthy");
      } catch (error) {
        const count = (this.failureCounts.get(id) ?? 0) + 1;
        this.failureCounts.set(id, count);
        const newStatus = count >= 3 ? "unreachable" : "degraded";
        this.updateHealth(
          entry.info,
          newStatus,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    for (const [id, entry] of this.actuators) {
      try {
        const status = entry.actuator.getStatus();
        if (status === "error" || status === "offline") {
          const count = (this.failureCounts.get(id) ?? 0) + 1;
          this.failureCounts.set(id, count);
          const newStatus = count >= 3 ? "unreachable" : "degraded";
          this.updateHealth(entry.info, newStatus, `Actuator status: ${status}`);
        } else {
          this.failureCounts.set(id, 0);
          this.updateHealth(entry.info, "healthy");
        }
      } catch (error) {
        const count = (this.failureCounts.get(id) ?? 0) + 1;
        this.failureCounts.set(id, count);
        const newStatus = count >= 3 ? "unreachable" : "degraded";
        this.updateHealth(
          entry.info,
          newStatus,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  private updateHealth(
    info: DeviceInfo,
    newStatus: DeviceInfo["health_status"],
    error?: string
  ): void {
    const oldStatus = info.health_status;
    info.health_status = newStatus;
    info.last_health_check = new Date().toISOString();
    if (oldStatus !== newStatus) {
      for (const cb of this.healthCallbacks) {
        cb(info.device_id, newStatus, error);
      }
    }
  }

  private matchesQuery(info: DeviceInfo, q: DeviceQuery): boolean {
    if (q.device_type !== undefined && info.device_type !== q.device_type) return false;
    if (q.modality !== undefined) {
      const desc = info.descriptor;
      if ("modality" in desc && desc.modality !== q.modality) return false;
    }
    if (q.sensor_type !== undefined && info.device_type === "sensor") {
      if ((info.descriptor as SensorDescriptor).sensor_type !== q.sensor_type) return false;
    }
    if (q.actuator_type !== undefined && info.device_type === "actuator") {
      if ((info.descriptor as ActuatorDescriptor).actuator_type !== q.actuator_type) return false;
    }
    if (q.status !== undefined) {
      if (info.descriptor.status !== q.status) return false;
    }
    if (q.capability !== undefined) {
      if (!(q.capability in info.descriptor.capabilities)) return false;
    }
    return true;
  }
}
