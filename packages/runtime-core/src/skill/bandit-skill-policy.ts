import type {
  AgentProfile,
  ExplorationStrategyType,
  PolicyFeedback,
  PolicyUpdateResult,
  SkillCandidate,
  SkillPolicy,
  SkillPolicyState,
  SkillSelection
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";
import { decideExploration } from "./exploration-strategy.js";
import { InMemorySkillPolicyStateStore } from "./in-memory-skill-policy-store.js";
import type { SkillPolicyStateStore } from "./skill-policy-store.js";

type ContextResolutionLevel = NonNullable<SkillSelection["context_resolution_level"]>;

interface PolicyContextInput {
  goal_type?: string;
  domain?: string;
  action_type?: string;
  tool_name?: string;
  risk_level?: SkillCandidate["risk_level"];
}

interface ContextTarget {
  level: ContextResolutionLevel;
  weight: number;
  context: {
    context_key?: string;
    goal_type?: string;
    domain?: string;
    action_type?: string;
    tool_name?: string;
    risk_level?: SkillCandidate["risk_level"];
  };
}

interface ContextHierarchy {
  exact?: ContextTarget["context"];
  targets: ContextTarget[];
}

export class BanditSkillPolicy implements SkillPolicy {
  private readonly store: SkillPolicyStateStore;
  private alpha = 0.2;

  public constructor(store?: SkillPolicyStateStore) {
    this.store = store ?? new InMemorySkillPolicyStateStore();
  }

  public configure(input: { alpha?: number }): void {
    this.alpha = input.alpha ?? this.alpha;
  }

  public async selectSkill(input: {
    tenant_id: string;
    session_id: string;
    cycle_id: string;
    candidates: SkillCandidate[];
    profile: AgentProfile;
    runtime_state?: Record<string, unknown>;
  }): Promise<SkillSelection | null> {
    if (input.candidates.length === 0) {
      return null;
    }

    const context = derivePolicyContext(input.profile, input.runtime_state);
    const ranked = input.candidates
      .map((candidate) => {
        const hierarchy = buildContextHierarchy({
          ...context,
          risk_level: candidate.risk_level
        });
        const resolved = resolveCandidateState(
          input.tenant_id,
          candidate,
          hierarchy,
          (tenantId, skillId, contextKey) => this.getState(tenantId, skillId, contextKey)
        );
        return {
          candidate,
          hierarchy,
          qValue: resolved.qValue,
          sampleCount: resolved.sampleCount,
          averageReward: resolved.averageReward,
          successRate: resolved.successRate,
          resolvedState: resolved.state,
          contextKey: hierarchy.exact?.context_key,
          contextResolutionLevel: resolved.contextResolutionLevel
        };
      })
      .sort(compareResolvedCandidate);
    const primary = ranked[0];
    if (!primary) {
      return null;
    }

    const states = new Map<string, SkillPolicyState>();
    for (const candidate of ranked) {
      states.set(
        candidate.candidate.skill_id,
        candidate.resolvedState ??
          createDefaultState(input.tenant_id, candidate.candidate.skill_id, input.profile, {
            ...context,
            context_key: candidate.contextKey,
            risk_level: candidate.candidate.risk_level
          })
      );
    }

    let chosen = primary;
    let selectionReason: SkillSelection["selection_reason"] = ranked.length === 1 ? "forced" : "exploit";
    let strategy: ExplorationStrategyType | undefined;
    const explorationConfig = input.profile.rl_config?.exploration;
    if (input.profile.rl_config?.enabled !== false && explorationConfig?.strategy && ranked.length > 1) {
      const decision = decideExploration({
        candidates: ranked.map((entry) => ({
          ...entry.candidate,
          q_value: entry.qValue,
          sample_count: entry.sampleCount,
          average_reward: entry.averageReward,
          success_rate: entry.successRate
        })),
        states,
        strategy: explorationConfig.strategy,
        initialEpsilon: explorationConfig.initial_epsilon ?? 0.3,
        epsilonDecay: explorationConfig.epsilon_decay ?? 0.995,
        epsilonMin: explorationConfig.epsilon_min ?? 0.01,
        ucbCoefficient: explorationConfig.ucb_coefficient ?? 1.2
      });
      if (decision) {
        chosen = ranked.find((entry) => entry.candidate.skill_id === decision.candidate.skill_id) ?? chosen;
        selectionReason = decision.reason;
        strategy = decision.strategy;
      }
    }

    for (const target of dedupeContextTargets([...chosen.hierarchy.targets, globalTarget()])) {
      const existing = this.getState(input.tenant_id, chosen.candidate.skill_id, target.context.context_key);
      this.store.save(
        incrementSelectionState(
          existing ??
            createDefaultState(input.tenant_id, chosen.candidate.skill_id, input.profile, {
              ...target.context,
              risk_level: chosen.candidate.risk_level
            }),
          selectionReason
        )
      );
    }

    return {
      selection_id: generateId("sel"),
      tenant_id: input.tenant_id,
      session_id: input.session_id,
      cycle_id: input.cycle_id,
      skill_id: chosen.candidate.skill_id,
      context_key: chosen.contextKey,
      context_resolution_level: chosen.contextResolutionLevel,
      goal_type: context.goal_type,
      domain: context.domain,
      action_type: context.action_type,
      tool_name: context.tool_name,
      risk_level: chosen.candidate.risk_level,
      selection_reason: selectionReason,
      confidence: clamp(
        0.45 + chosen.qValue * 0.35 + Math.min(chosen.sampleCount, 20) * 0.01 - (chosen.candidate.confidence_penalty ?? 0),
        0.05,
        0.99
      ),
      policy_score: chosen.qValue,
      rationale:
        selectionReason === "explore"
          ? `Selected ${chosen.candidate.skill_name} via ${strategy} under ${chosen.contextResolutionLevel} contextual policy state.`
          : selectionReason === "forced"
            ? `Selected ${chosen.candidate.skill_name} as the only matched skill.`
            : `Selected ${chosen.candidate.skill_name} with highest ${chosen.contextResolutionLevel} contextual learned value.`,
      strategy,
      created_at: nowIso()
    };
  }

  public async update(feedback: PolicyFeedback): Promise<PolicyUpdateResult> {
    const hierarchy = buildContextHierarchy({
      goal_type: feedback.goal_type,
      domain: feedback.domain,
      action_type: feedback.action_type,
      tool_name: feedback.tool_name,
      risk_level: feedback.risk_level
    });
    const targets = dedupeContextTargets([...hierarchy.targets, globalTarget()]);
    const baseline =
      this.getState(feedback.tenant_id, feedback.skill_id, feedback.context_key)?.q_value ??
      this.getState(feedback.tenant_id, feedback.skill_id)?.q_value ??
      0.5;
    let preferredNext: SkillPolicyState | undefined;

    for (const target of targets) {
      const current =
        this.getState(feedback.tenant_id, feedback.skill_id, target.context.context_key) ??
        createDefaultState(feedback.tenant_id, feedback.skill_id, undefined, target.context);
      const next = updatePolicyState(current, feedback, this.alpha * target.weight);
      this.store.save(next);
      if (target.level === "exact" || (preferredNext === undefined && target.level === "global")) {
        preferredNext = next;
      }
    }

    return {
      state:
        preferredNext ??
        this.getState(feedback.tenant_id, feedback.skill_id, feedback.context_key) ??
        this.getState(feedback.tenant_id, feedback.skill_id) ??
        createDefaultState(feedback.tenant_id, feedback.skill_id),
      td_error: Math.abs(feedback.composite_reward - baseline)
    };
  }

  public async batchUpdate(feedbackBatch: PolicyFeedback[]): Promise<PolicyUpdateResult[]> {
    const results: PolicyUpdateResult[] = [];
    for (const feedback of feedbackBatch) {
      results.push(await this.update(feedback));
    }
    return results;
  }

  public getState(tenantId: string, skillId: string, contextKey?: string): SkillPolicyState | undefined {
    return this.store.get(tenantId, skillId, contextKey);
  }

  public listStates(tenantId: string): SkillPolicyState[] {
    return this.store.list(tenantId);
  }
}

function compareCandidate(left: SkillCandidate, right: SkillCandidate) {
  return (
    right.q_value - left.q_value ||
    right.average_reward - left.average_reward ||
    right.sample_count - left.sample_count ||
    left.skill_id.localeCompare(right.skill_id)
  );
}

function compareResolvedCandidate(
  left: {
    candidate: SkillCandidate;
    qValue: number;
    averageReward: number;
    sampleCount: number;
  },
  right: {
    candidate: SkillCandidate;
    qValue: number;
    averageReward: number;
    sampleCount: number;
  }
) {
  return (
    right.qValue - left.qValue ||
    right.averageReward - left.averageReward ||
    right.sampleCount - left.sampleCount ||
    compareCandidate(left.candidate, right.candidate)
  );
}

function buildContextHierarchy(input: PolicyContextInput): ContextHierarchy {
  const exact = {
    goal_type: input.goal_type,
    domain: input.domain,
    action_type: input.action_type,
    tool_name: input.tool_name,
    risk_level: input.risk_level,
    context_key: buildContextKey(input)
  };
  const operational = {
    goal_type: input.goal_type,
    domain: input.domain,
    action_type: input.action_type,
    tool_name: input.tool_name,
    context_key: buildContextKey({
      goal_type: input.goal_type,
      domain: input.domain,
      action_type: input.action_type,
      tool_name: input.tool_name
    })
  };
  const family = {
    goal_type: input.goal_type,
    domain: input.domain,
    action_type: input.action_type,
    context_key: buildContextKey({
      goal_type: input.goal_type,
      domain: input.domain,
      action_type: input.action_type
    })
  };
  return {
    exact,
    targets: dedupeContextTargets([
      { level: "exact", weight: 1, context: exact },
      { level: "operational", weight: 0.6, context: operational },
      { level: "family", weight: 0.35, context: family }
    ])
  };
}

function globalTarget(): ContextTarget {
  return {
    level: "global",
    weight: 0.15,
    context: {}
  };
}

function dedupeContextTargets(targets: ContextTarget[]): ContextTarget[] {
  const next = new Map<string, ContextTarget>();
  for (const target of targets) {
    const key = target.context.context_key ?? "__global__";
    if (!next.has(key)) {
      next.set(key, target);
    }
  }
  return [...next.values()];
}

function resolveCandidateState(
  tenantId: string,
  candidate: SkillCandidate,
  hierarchy: ContextHierarchy,
  getState: (tenantId: string, skillId: string, contextKey?: string) => SkillPolicyState | undefined
): {
  state?: SkillPolicyState;
  qValue: number;
  averageReward: number;
  sampleCount: number;
  successRate: number;
  contextResolutionLevel: ContextResolutionLevel;
} {
  const weightedStates = hierarchy.targets
    .map((target) => ({
      target,
      state: getState(tenantId, candidate.skill_id, target.context.context_key)
    }))
    .filter((entry): entry is { target: ContextTarget; state: SkillPolicyState } => Boolean(entry.state));
  const globalState = getState(tenantId, candidate.skill_id);
  const sources = [
    ...weightedStates.map((entry) => ({
      weight: entry.target.weight,
      state: entry.state
    })),
    ...(globalState ? [{ weight: 0.15, state: globalState }] : [])
  ];

  if (sources.length === 0) {
    return {
      state: undefined,
      qValue: candidate.q_value,
      averageReward: candidate.average_reward,
      sampleCount: candidate.sample_count,
      successRate: candidate.success_rate,
      contextResolutionLevel: "global"
    };
  }

  const totalWeight = sources.reduce((sum, source) => sum + source.weight, 0);
  const normalized = sources.map((source) => ({
    weight: source.weight / totalWeight,
    state: source.state
  }));
  const syntheticState: SkillPolicyState = {
    tenant_id: tenantId,
    skill_id: candidate.skill_id,
    context_key: hierarchy.exact?.context_key,
    goal_type: hierarchy.exact?.goal_type,
    domain: hierarchy.exact?.domain,
    action_type: hierarchy.exact?.action_type,
    tool_name: hierarchy.exact?.tool_name,
    risk_level: hierarchy.exact?.risk_level,
    q_value: normalized.reduce((sum, source) => sum + source.state.q_value * source.weight, 0),
    sample_count: Math.round(normalized.reduce((sum, source) => sum + source.state.sample_count * source.weight, 0)),
    success_count: Math.round(normalized.reduce((sum, source) => sum + source.state.success_count * source.weight, 0)),
    failure_count: Math.round(normalized.reduce((sum, source) => sum + source.state.failure_count * source.weight, 0)),
    average_reward: normalized.reduce((sum, source) => sum + source.state.average_reward * source.weight, 0),
    selection_count: Math.round(normalized.reduce((sum, source) => sum + source.state.selection_count * source.weight, 0)),
    exploit_count: Math.round(normalized.reduce((sum, source) => sum + source.state.exploit_count * source.weight, 0)),
    explore_count: Math.round(normalized.reduce((sum, source) => sum + source.state.explore_count * source.weight, 0)),
    updated_at: nowIso()
  };

  return {
    state: syntheticState,
    qValue: syntheticState.q_value,
    averageReward: syntheticState.average_reward,
    sampleCount: syntheticState.sample_count,
    successRate:
      syntheticState.sample_count > 0
        ? syntheticState.success_count / Math.max(syntheticState.sample_count, 1)
        : candidate.success_rate,
    contextResolutionLevel: weightedStates[0]?.target.level ?? "global"
  };
}

function createDefaultState(
  tenantId: string,
  skillId: string,
  profile?: AgentProfile,
  context?: {
    context_key?: string;
    goal_type?: string;
    domain?: string;
    action_type?: string;
    tool_name?: string;
    risk_level?: SkillCandidate["risk_level"];
  }
): SkillPolicyState {
  const defaultQ = profile?.rl_config?.policy?.default_q_value ?? 0.5;
  const timestamp = nowIso();
  return {
    tenant_id: tenantId,
    skill_id: skillId,
    context_key: context?.context_key,
    goal_type: context?.goal_type,
    domain: context?.domain,
    action_type: context?.action_type,
    tool_name: context?.tool_name,
    risk_level: context?.risk_level,
    q_value: defaultQ,
    sample_count: 0,
    success_count: 0,
    failure_count: 0,
    average_reward: 0,
    selection_count: 0,
    exploit_count: 0,
    explore_count: 0,
    updated_at: timestamp
  };
}

function incrementSelectionState(
  state: SkillPolicyState,
  selectionReason: SkillSelection["selection_reason"]
): SkillPolicyState {
  return {
    ...state,
    selection_count: state.selection_count + 1,
    exploit_count: state.exploit_count + (selectionReason === "exploit" ? 1 : 0),
    explore_count: state.explore_count + (selectionReason === "explore" ? 1 : 0),
    last_selected_at: nowIso(),
    updated_at: nowIso()
  };
}

function updatePolicyState(
  current: SkillPolicyState,
  feedback: PolicyFeedback,
  alpha: number
): SkillPolicyState {
  const effectiveAlpha = clamp(alpha / (1 + current.sample_count * 0.05), 0.01, 1);
  const nextQ = current.q_value + effectiveAlpha * (feedback.composite_reward - current.q_value);
  const sampleCount = current.sample_count + 1;
  const nextAverageReward =
    ((current.average_reward * current.sample_count) + feedback.composite_reward) / sampleCount;
  return {
    ...current,
    q_value: nextQ,
    sample_count: sampleCount,
    success_count: current.success_count + (feedback.success ? 1 : 0),
    failure_count: current.failure_count + (feedback.success ? 0 : 1),
    average_reward: nextAverageReward,
    last_reward_at: feedback.updated_at,
    updated_at: feedback.updated_at
  };
}

function derivePolicyContext(
  profile: AgentProfile,
  runtimeState?: Record<string, unknown>
): {
  goal_type?: string;
  domain?: string;
  action_type?: string;
  tool_name?: string;
} {
  const inputMetadata =
    runtimeState?.current_input_metadata && typeof runtimeState.current_input_metadata === "object"
      ? (runtimeState.current_input_metadata as Record<string, unknown>)
      : undefined;
  return {
    goal_type:
      typeof inputMetadata?.goal_type === "string"
        ? inputMetadata.goal_type
        : typeof runtimeState?.current_goal_type === "string"
          ? runtimeState.current_goal_type
          : undefined,
    domain: typeof profile.domain === "string" ? profile.domain.toLowerCase() : undefined,
    action_type:
      typeof inputMetadata?.sourceActionType === "string"
        ? inputMetadata.sourceActionType
        : typeof inputMetadata?.action_type === "string"
          ? inputMetadata.action_type
          : undefined,
    tool_name:
      typeof inputMetadata?.sourceToolName === "string"
        ? inputMetadata.sourceToolName
        : typeof inputMetadata?.tool_name === "string"
          ? inputMetadata.tool_name
          : undefined
  };
}

function buildContextKey(input: {
  goal_type?: string;
  domain?: string;
  action_type?: string;
  tool_name?: string;
  risk_level?: SkillCandidate["risk_level"];
}): string | undefined {
  const parts = [
    input.goal_type ?? "*",
    input.domain ?? "*",
    input.action_type ?? "*",
    input.tool_name ?? "*",
    input.risk_level ?? "*"
  ];
  return parts.every((part) => part === "*") ? undefined : parts.join(":");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
