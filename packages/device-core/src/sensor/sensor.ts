import type { SensorDescriptor, SensorReading } from "../types.js";

export interface Sensor {
  readonly descriptor: SensorDescriptor;
  start(): Promise<void>;
  stop(): Promise<void>;
  read(): Promise<SensorReading>;
  subscribe?(callback: (reading: SensorReading) => void): () => void;
}
