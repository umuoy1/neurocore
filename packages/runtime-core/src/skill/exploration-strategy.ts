import type {
  ExplorationStrategyType,
  SkillCandidate,
  SkillPolicyState,
  SkillSelectionReason
} from "@neurocore/protocol";

export interface ExplorationDecision {
  candidate: SkillCandidate;
  reason: SkillSelectionReason;
  strategy?: ExplorationStrategyType;
}

export interface ExplorationInput {
  candidates: SkillCandidate[];
  states: Map<string, SkillPolicyState>;
  strategy: ExplorationStrategyType;
  initialEpsilon: number;
  epsilonDecay: number;
  epsilonMin: number;
  ucbCoefficient: number;
}

export function decideExploration(input: ExplorationInput): ExplorationDecision | null {
  const activeCandidates = input.candidates.filter((candidate) => candidate.risk_level !== "high");
  if (activeCandidates.length <= 1) {
    return null;
  }

  if (input.strategy === "epsilon_greedy") {
    return selectWithEpsilonGreedy(input, activeCandidates);
  }
  if (input.strategy === "ucb") {
    return selectWithUcb(input, activeCandidates);
  }
  return selectWithThompsonSampling(input, activeCandidates);
}

function selectWithEpsilonGreedy(input: ExplorationInput, candidates: SkillCandidate[]): ExplorationDecision | null {
  const totalSuccesses = Array.from(input.states.values()).reduce((sum, state) => sum + state.success_count, 0);
  const epsilon = Math.max(
    input.epsilonMin,
    input.initialEpsilon * Math.pow(input.epsilonDecay, totalSuccesses)
  );

  if (Math.random() >= epsilon) {
    return null;
  }

  const ranked = [...candidates].sort(compareCandidate);
  const alternatives = ranked.slice(1);
  const pick = alternatives[Math.floor(Math.random() * alternatives.length)] ?? ranked[0];
  return pick
    ? {
        candidate: pick,
        reason: "explore",
        strategy: "epsilon_greedy"
      }
    : null;
}

function selectWithUcb(input: ExplorationInput, candidates: SkillCandidate[]): ExplorationDecision | null {
  const totalSamples =
    candidates.reduce((sum, candidate) => {
      const state = input.states.get(candidate.skill_id);
      return sum + (state?.sample_count ?? 0);
    }, 0) + 1;

  const best = [...candidates]
    .map((candidate) => {
      const state = input.states.get(candidate.skill_id);
      const sampleCount = state?.sample_count ?? 0;
      const bonus = input.ucbCoefficient * Math.sqrt(Math.log(totalSamples + 1) / (sampleCount + 1));
      return {
        candidate,
        score: candidate.q_value + bonus
      };
    })
    .sort((left, right) => right.score - left.score)[0];

  if (!best) {
    return null;
  }

  const baseline = [...candidates].sort(compareCandidate)[0];
  if (baseline && baseline.skill_id === best.candidate.skill_id) {
    return null;
  }

  return {
    candidate: best.candidate,
    reason: "explore",
    strategy: "ucb"
  };
}

function selectWithThompsonSampling(input: ExplorationInput, candidates: SkillCandidate[]): ExplorationDecision | null {
  const sampled = candidates
    .map((candidate) => {
      const state = input.states.get(candidate.skill_id);
      const alpha = (state?.success_count ?? 0) + 1;
      const beta = (state?.failure_count ?? 0) + 1;
      return {
        candidate,
        score: sampleBeta(alpha, beta)
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = sampled[0];
  const baseline = [...candidates].sort(compareCandidate)[0];
  if (!best || !baseline || baseline.skill_id === best.candidate.skill_id) {
    return null;
  }

  return {
    candidate: best.candidate,
    reason: "explore",
    strategy: "thompson_sampling"
  };
}

function compareCandidate(left: SkillCandidate, right: SkillCandidate) {
  return (
    right.q_value - left.q_value ||
    right.average_reward - left.average_reward ||
    right.sample_count - left.sample_count ||
    left.skill_id.localeCompare(right.skill_id)
  );
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x = 0;
    let v = 0;
    do {
      x = sampleNormal();
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function sampleNormal(): number {
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
