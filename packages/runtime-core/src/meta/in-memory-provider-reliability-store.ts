import type {
  MetaSignalProviderReliabilityRecord,
  MetaSignalProviderReliabilityStore
} from "@neurocore/protocol";
import { summarizeProviderReliability } from "./provider-reliability-store.js";

export class InMemoryProviderReliabilityStore implements MetaSignalProviderReliabilityStore {
  private readonly records: MetaSignalProviderReliabilityRecord[] = [];

  public append(record: MetaSignalProviderReliabilityRecord) {
    this.records.push(record);
  }

  public list(sessionId?: string) {
    if (!sessionId) {
      return [...this.records];
    }
    return this.records.filter((record) => record.session_id === sessionId);
  }

  public listByProvider(provider: string, family?: string) {
    return this.records.filter(
      (record) => record.provider === provider && (family ? record.family === family : true)
    );
  }

  public getProfile(input: { provider: string; family: string }) {
    return summarizeProviderReliability(this.records, input.provider, input.family);
  }

  public deleteSession(sessionId: string) {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index]?.session_id === sessionId) {
        this.records.splice(index, 1);
      }
    }
  }
}
