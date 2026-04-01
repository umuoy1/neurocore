export type DeviceType = "sensor" | "actuator";

export interface SensorDescriptor {
  sensor_id: string;
  sensor_type: string;
  modality: string;
  capabilities: Record<string, unknown>;
  sampling_rate_hz?: number;
  resolution?: Record<string, number>;
  status: "online" | "offline" | "error";
  metadata?: Record<string, unknown>;
}

export interface SensorReading {
  sensor_id: string;
  timestamp: string;
  modality: string;
  raw_data_ref?: string;
  structured_data?: Record<string, unknown>;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface ActuatorDescriptor {
  actuator_id: string;
  actuator_type: string;
  modality: string;
  capabilities: Record<string, unknown>;
  degrees_of_freedom?: number;
  max_force?: number;
  status: "ready" | "busy" | "error" | "offline";
  metadata?: Record<string, unknown>;
}

export interface ActuatorCommand {
  command_id: string;
  actuator_id: string;
  command_type: string;
  parameters: Record<string, unknown>;
  timeout_ms?: number;
  priority?: number;
  preconditions?: string[];
  safety_constraints?: Record<string, unknown>;
}

export interface ActuatorResult {
  command_id: string;
  actuator_id: string;
  command_type: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  result?: Record<string, unknown>;
  error?: string;
  duration_ms: number;
  side_effects?: string[];
}

export interface DeviceInfo {
  device_id: string;
  device_type: DeviceType;
  descriptor: SensorDescriptor | ActuatorDescriptor;
  registered_at: string;
  last_health_check?: string;
  health_status: "healthy" | "degraded" | "unreachable" | "unknown";
}

export interface DeviceQuery {
  device_type?: DeviceType;
  sensor_type?: string;
  actuator_type?: string;
  modality?: string;
  status?: string;
  capability?: string;
}

export interface DeviceHealthCallback {
  (device_id: string, status: DeviceInfo["health_status"], error?: string): void;
}

export interface Percept {
  percept_id: string;
  source_sensor_ids: string[];
  modality: string;
  percept_type: string;
  timestamp: string;
  data: Record<string, unknown>;
  confidence: number;
  spatial_ref?: { x?: number; y?: number; z?: number; frame?: string };
  metadata?: Record<string, unknown>;
}
