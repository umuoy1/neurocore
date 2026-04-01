import type { Percept, SensorReading } from "../types.js";

export interface PerceptionProcessor {
  name: string;
  supported_modalities: string[];
  process(readings: SensorReading[]): Promise<Percept[]>;
}
