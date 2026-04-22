import type { RewardSignal, RewardStore } from "@neurocore/protocol";

export class InMemoryRewardStore implements RewardStore {
  private readonly entries = new Map<string, RewardSignal>();

  public save(signal: RewardSignal): void {
    this.entries.set(signal.signal_id, structuredClone(signal));
  }

  public getByEpisodeId(episodeId: string): RewardSignal | undefined {
    for (const signal of this.entries.values()) {
      if (signal.episode_id === episodeId) {
        return structuredClone(signal);
      }
    }
    return undefined;
  }

  public listBySkillId(tenantId: string, skillId: string): RewardSignal[] {
    const result: RewardSignal[] = [];
    for (const signal of this.entries.values()) {
      if (signal.tenant_id === tenantId && signal.skill_id === skillId) {
        result.push(structuredClone(signal));
      }
    }
    return result.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  public listByTenantId(tenantId: string): RewardSignal[] {
    const result: RewardSignal[] = [];
    for (const signal of this.entries.values()) {
      if (signal.tenant_id === tenantId) {
        result.push(structuredClone(signal));
      }
    }
    return result.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  public getAverageMetrics(input: {
    tenant_id: string;
    skill_id?: string;
    window_size?: number;
  }): {
    avg_cycles?: number;
    avg_latency_ms?: number;
    avg_tokens?: number;
  } {
    const signals = (input.skill_id
      ? this.listBySkillId(input.tenant_id, input.skill_id)
      : this.listByTenantId(input.tenant_id)
    )
      .filter((signal) => signal.metrics)
      .slice(-(input.window_size ?? 20));
    return averageRewardMetrics(signals);
  }

  public deleteSession(sessionId: string): void {
    for (const [signalId, signal] of this.entries.entries()) {
      if (signal.session_id === sessionId) {
        this.entries.delete(signalId);
      }
    }
  }
}

function averageRewardMetrics(signals: RewardSignal[]) {
  return {
    avg_cycles: average(signals.map((signal) => signal.metrics?.cycle_index)),
    avg_latency_ms: average(signals.map((signal) => signal.metrics?.total_latency_ms)),
    avg_tokens: average(signals.map((signal) => signal.metrics?.total_tokens))
  };
}

function average(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}
