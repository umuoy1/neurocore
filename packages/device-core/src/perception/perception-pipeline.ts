import type { Percept, SensorReading } from "../types.js";
import type { PerceptionProcessor } from "./perception-processor.js";

export interface PerceptionPipeline {
  addProcessor(processor: PerceptionProcessor): void;
  removeProcessor(name: string): void;
  ingest(readings: SensorReading[]): Promise<Percept[]>;
}
