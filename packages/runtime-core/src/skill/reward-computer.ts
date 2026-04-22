import type {
  Episode,
  RewardComputer,
  RewardComputeContext,
  RewardDimension,
  RewardDimensionName,
  RewardSignal
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

const DEFAULT_WEIGHTS: Record<RewardDimensionName, number> = {
  task_completion: 0.4,
  efficiency: 0.25,
  safety: 0.2,
  user_satisfaction: 0.15
};

export class DefaultRewardComputer implements RewardComputer {
  public async compute(episode: Episode, context: RewardComputeContext): Promise<RewardSignal> {
    const weights = {
      ...DEFAULT_WEIGHTS,
      ...(context.reward_config?.default_weights ?? {})
    };

    const enabled = new Set(
      context.reward_config?.dimensions
        ?.filter((dimension) => dimension.enabled !== false)
        .map((dimension) => dimension.name) ?? Object.keys(DEFAULT_WEIGHTS)
    );

    const dimensions: RewardDimension[] = [];

    if (enabled.has("task_completion")) {
      dimensions.push({
        name: "task_completion",
        value: toTaskCompletionValue(episode.outcome),
        weight: weights.task_completion,
        source: "automatic"
      });
    }

    if (enabled.has("efficiency")) {
      dimensions.push({
        name: "efficiency",
        value: computeEfficiencyValue(episode, context),
        weight: weights.efficiency,
        source: "automatic"
      });
    }

    if (enabled.has("safety")) {
      dimensions.push({
        name: "safety",
        value: computeSafetyValue(episode, context),
        weight: weights.safety,
        source: context.prediction_errors.length > 0 ? "prediction_error" : "automatic"
      });
    }

    if (enabled.has("user_satisfaction")) {
      dimensions.push({
        name: "user_satisfaction",
        value: computeUserSatisfactionValue(episode),
        weight: weights.user_satisfaction,
        source: hasHumanFeedback(episode) ? "human_feedback" : "automatic"
      });
    }

    const weightTotal = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) || 1;
    const compositeReward = clamp(
      dimensions.reduce((sum, dimension) => sum + dimension.value * dimension.weight, 0) / weightTotal,
      -1,
      1
    );

    return {
      signal_id: generateId("rwd"),
      episode_id: episode.episode_id,
      skill_id: context.skill_id,
      session_id: context.session_id,
      tenant_id: context.tenant_id,
      dimensions,
      composite_reward: compositeReward,
      metrics: context.cycle_metrics,
      baseline_metrics: context.baseline_metrics,
      timestamp: nowIso()
    };
  }
}

function toTaskCompletionValue(outcome: Episode["outcome"]): number {
  if (outcome === "success") {
    return 1;
  }
  if (outcome === "partial") {
    return 0.3;
  }
  return -1;
}

function computeEfficiencyValue(episode: Episode, context: RewardComputeContext): number {
  const metadata = episode.metadata as Record<string, unknown> | undefined;
  const cycleCount =
    readNumber(context.cycle_metrics?.cycle_index) ??
    readNumber(metadata?.cycle_count) ??
    1;
  const totalTokens =
    readNumber(context.cycle_metrics?.total_tokens) ??
    readNumber(metadata?.token_count) ??
    readNumber(context.trace?.trace.metrics?.total_tokens) ??
    0;
  const totalLatencyMs =
    readNumber(context.cycle_metrics?.total_latency_ms) ??
    readNumber(context.trace?.trace.metrics?.total_latency_ms) ??
    0;
  const baselineCycles = readNumber(context.baseline_metrics?.avg_cycles) ?? 2;
  const baselineTokens = readNumber(context.baseline_metrics?.avg_tokens) ?? 1800;
  const baselineLatencyMs = readNumber(context.baseline_metrics?.avg_latency_ms) ?? 5000;

  const cycleScore = normalizeAgainstBaseline(cycleCount, baselineCycles, -0.35);
  const tokenScore = normalizeAgainstBaseline(totalTokens, baselineTokens, -0.25);
  const latencyScore = normalizeAgainstBaseline(totalLatencyMs, baselineLatencyMs, -0.2);
  const weightedScore = weightedAverage([
    { value: cycleScore, weight: 0.45 },
    { value: tokenScore, weight: totalTokens > 0 ? 0.3 : 0 },
    { value: latencyScore, weight: totalLatencyMs > 0 ? 0.25 : 0 }
  ]);
  const outcomePenalty =
    episode.outcome === "failure"
      ? 0.45
      : episode.outcome === "partial"
        ? 0.18
        : 0;
  return clamp(weightedScore - outcomePenalty, -1, 1);
}

function computeSafetyValue(episode: Episode, context: RewardComputeContext): number {
  const metadata = episode.metadata as Record<string, unknown> | undefined;
  const sideEffectLevel = typeof metadata?.side_effect_level === "string" ? metadata.side_effect_level : "none";
  const sideEffectPenalty =
    sideEffectLevel === "high"
      ? 0.8
      : sideEffectLevel === "medium"
        ? 0.45
        : sideEffectLevel === "low"
          ? 0.15
          : 0;
  const predictionPenalty = Math.min(context.prediction_errors.length, 4) * 0.18;
  return clamp(1 - sideEffectPenalty - predictionPenalty, -1, 1);
}

function computeUserSatisfactionValue(episode: Episode): number {
  const metadata = episode.metadata as Record<string, unknown> | undefined;
  const feedbackScore = readNumber(metadata?.user_feedback_score);
  if (feedbackScore !== undefined) {
    return clamp((feedbackScore - 3) / 2, -1, 1);
  }

  if (episode.valence === "positive") {
    return 0.7;
  }
  if (episode.valence === "negative") {
    return -0.7;
  }
  return 0;
}

function hasHumanFeedback(episode: Episode): boolean {
  const metadata = episode.metadata as Record<string, unknown> | undefined;
  return readNumber(metadata?.user_feedback_score) !== undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAgainstBaseline(value: number, baseline: number, floor: number): number {
  if (value <= 0) {
    return 0;
  }
  const safeBaseline = Math.max(baseline, 1);
  const ratio = value / safeBaseline;
  if (ratio <= 0.75) {
    return 1;
  }
  if (ratio <= 1) {
    return 1 - (ratio - 0.75) / 0.25 * 0.2;
  }
  if (ratio >= 2) {
    return floor;
  }
  return 0.8 - ((ratio - 1) / 1) * (0.8 - floor);
}

function weightedAverage(items: Array<{ value: number; weight: number }>): number {
  const filtered = items.filter((item) => item.weight > 0);
  const totalWeight = filtered.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return filtered.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
