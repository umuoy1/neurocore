import type { Experience } from "@neurocore/protocol";

export class PrioritizedReplayBuffer {
  private readonly capacity: number;
  private readonly entries: Experience[] = [];

  public constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  public add(experience: Experience): void {
    if (this.entries.length >= this.capacity) {
      this.entries.shift();
    }
    this.entries.push(structuredClone(experience));
  }

  public size(): number {
    return this.entries.length;
  }

  public sample(batchSize: number): Experience[] {
    if (this.entries.length === 0) {
      return [];
    }

    const weights = this.entries.map((entry) => Math.max(Math.abs(entry.td_error), 0.01));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const selected: Experience[] = [];
    const seen = new Set<string>();

    while (selected.length < Math.min(batchSize, this.entries.length)) {
      let ticket = Math.random() * total;
      for (let index = 0; index < this.entries.length; index += 1) {
        ticket -= weights[index] ?? 0;
        if (ticket <= 0) {
          const candidate = this.entries[index];
          if (candidate && !seen.has(candidate.experience_id)) {
            selected.push(structuredClone(candidate));
            seen.add(candidate.experience_id);
          }
          break;
        }
      }
    }

    return selected;
  }
}
