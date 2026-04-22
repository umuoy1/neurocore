import type { Experience, OnlineLearner, PolicyFeedback, SkillPolicy } from "@neurocore/protocol";
import { PrioritizedReplayBuffer } from "./prioritized-replay-buffer.js";

export interface SkillOnlineLearnerOptions {
  policy: SkillPolicy;
  replayBufferSize?: number;
  batchSize?: number;
  updateIntervalEpisodes?: number;
}

export class SkillOnlineLearner implements OnlineLearner {
  private readonly policy: SkillPolicy;
  private replayBuffer: PrioritizedReplayBuffer;
  private batchSize: number;
  private updateIntervalEpisodes: number;
  private replayBufferSize: number;
  private pending = 0;

  public constructor(options: SkillOnlineLearnerOptions) {
    this.policy = options.policy;
    this.replayBufferSize = options.replayBufferSize ?? 256;
    this.replayBuffer = new PrioritizedReplayBuffer(this.replayBufferSize);
    this.batchSize = options.batchSize ?? 32;
    this.updateIntervalEpisodes = options.updateIntervalEpisodes ?? 10;
  }

  public configure(input: {
    replayBufferSize?: number;
    batchSize?: number;
    updateIntervalEpisodes?: number;
  }): void {
    const nextReplayBufferSize = input.replayBufferSize ?? this.replayBufferSize;
    if (nextReplayBufferSize !== this.replayBufferSize) {
      this.replayBufferSize = nextReplayBufferSize;
      this.replayBuffer = new PrioritizedReplayBuffer(this.replayBufferSize);
      this.pending = 0;
    }
    this.batchSize = input.batchSize ?? this.batchSize;
    this.updateIntervalEpisodes = input.updateIntervalEpisodes ?? this.updateIntervalEpisodes;
  }

  public observe(experience: Experience): void {
    this.replayBuffer.add(experience);
    this.pending += 1;
    if (this.pending < this.updateIntervalEpisodes || typeof this.policy.batchUpdate !== "function") {
      return;
    }

    this.pending = 0;
    const sampled = this.replayBuffer.sample(this.batchSize);
    const feedbackBatch: PolicyFeedback[] = sampled.map((entry) => ({
      feedback_id: entry.experience_id,
      tenant_id: entry.tenant_id,
      session_id: entry.session_id,
      cycle_id: entry.cycle_id,
      skill_id: entry.skill_id,
      reward_signal_id: entry.reward_signal_id,
      composite_reward: entry.reward,
      success: entry.reward >= 0,
      source: "replay",
      updated_at: entry.created_at
    }));

    queueMicrotask(() => {
      void this.policy.batchUpdate?.(feedbackBatch);
    });
  }
}
