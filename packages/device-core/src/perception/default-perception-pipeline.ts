import type { Percept, SensorReading } from "../types.js";
import type { PerceptionProcessor } from "./perception-processor.js";
import type { PerceptionPipeline } from "./perception-pipeline.js";

export class DefaultPerceptionPipeline implements PerceptionPipeline {
  private readonly processors: PerceptionProcessor[] = [];
  private readonly timeoutMs: number;

  constructor(timeoutMs = 5000) {
    this.timeoutMs = timeoutMs;
  }

  addProcessor(processor: PerceptionProcessor): void {
    this.processors.push(processor);
  }

  removeProcessor(name: string): void {
    const idx = this.processors.findIndex((p) => p.name === name);
    if (idx >= 0) this.processors.splice(idx, 1);
  }

  async ingest(readings: SensorReading[]): Promise<Percept[]> {
    if (readings.length === 0 || this.processors.length === 0) return [];

    const grouped = new Map<string, SensorReading[]>();
    for (const reading of readings) {
      const group = grouped.get(reading.modality) ?? [];
      group.push(reading);
      grouped.set(reading.modality, group);
    }

    const tasks: Promise<Percept[]>[] = [];
    for (const [modality, modalityReadings] of grouped) {
      const matchingProcessors = this.processors.filter((p) =>
        p.supported_modalities.includes(modality)
      );
      for (const processor of matchingProcessors) {
        tasks.push(
          processor.process(modalityReadings).catch(() => [])
        );
      }
    }

    if (tasks.length === 0) return [];

    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), this.timeoutMs)
    );

    const resultsPromise = Promise.allSettled(tasks);
    const raceResult = await Promise.race([resultsPromise, timeoutPromise]);

    if (raceResult === "timeout") {
      return [];
    }

    const allPercepts: Percept[] = [];
    for (const result of raceResult) {
      if (result.status === "fulfilled") {
        allPercepts.push(...result.value);
      }
    }
    return allPercepts;
  }
}
