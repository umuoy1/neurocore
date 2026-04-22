import type { AgentProfile, RewardSignal, SkillDefinition, SkillEvaluation, SkillPolicyState, SkillStatus } from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

export class DefaultSkillEvaluator {
  public evaluate(input: {
    tenant_id: string;
    skill: SkillDefinition;
    rewards: RewardSignal[];
    policyState?: SkillPolicyState;
    now?: string;
    config?: AgentProfile["rl_config"];
  }): SkillEvaluation {
    const now = input.now ?? nowIso();
    const state = input.policyState;
    const sampleCount = state?.sample_count ?? input.rewards.length;
    const successRate =
      sampleCount > 0
        ? (state?.success_count ?? input.rewards.filter((reward) => reward.composite_reward >= 0).length) / sampleCount
        : 0;
    const averageReward =
      input.rewards.length > 0
        ? input.rewards.reduce((sum, reward) => sum + reward.composite_reward, 0) / input.rewards.length
        : state?.average_reward ?? 0;
    const usageFrequency = Math.min((state?.selection_count ?? sampleCount) / 10, 1);
    const lastUsedAt = state?.last_selected_at ?? readTimestamp(input.skill.metadata?.compiled_at);
    const recencyScore = computeRecencyScore(lastUsedAt, now);
    const rewardTrend = computeRewardTrend(input.rewards);
    const compositeScore = clamp(
      successRate * 0.35 +
      normalizeReward(averageReward) * 0.3 +
      usageFrequency * 0.15 +
      recencyScore * 0.1 +
      normalizeTrend(rewardTrend) * 0.1,
      0,
      1
    );
    const deprecateThreshold = input.config?.evaluation?.deprecate_threshold ?? 0.35;
    const status: SkillStatus =
      compositeScore < deprecateThreshold
        ? "deprecated"
        : input.skill.status === "pruned"
          ? "pruned"
          : "active";

    return {
      evaluation_id: generateId("ske"),
      tenant_id: input.tenant_id,
      skill_id: input.skill.skill_id,
      success_rate: successRate,
      average_reward: averageReward,
      usage_frequency: usageFrequency,
      recency_score: recencyScore,
      reward_trend: rewardTrend,
      composite_score: compositeScore,
      status,
      evaluated_at: now
    };
  }
}

function computeRecencyScore(lastUsedAt: string | undefined, now: string) {
  if (!lastUsedAt) {
    return 0;
  }
  const ageMs = Date.parse(now) - Date.parse(lastUsedAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return 1;
  }
  const ttlMs = 1000 * 60 * 60 * 24 * 30;
  return clamp(1 - ageMs / ttlMs, 0, 1);
}

function computeRewardTrend(rewards: RewardSignal[]) {
  if (rewards.length < 2) {
    return 0;
  }
  const midpoint = Math.floor(rewards.length / 2);
  const left = rewards.slice(0, midpoint);
  const right = rewards.slice(midpoint);
  const leftAvg = left.reduce((sum, reward) => sum + reward.composite_reward, 0) / Math.max(left.length, 1);
  const rightAvg = right.reduce((sum, reward) => sum + reward.composite_reward, 0) / Math.max(right.length, 1);
  return clamp(rightAvg - leftAvg, -1, 1);
}

function normalizeReward(value: number) {
  return clamp((value + 1) / 2, 0, 1);
}

function normalizeTrend(value: number) {
  return clamp((value + 1) / 2, 0, 1);
}

function readTimestamp(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
