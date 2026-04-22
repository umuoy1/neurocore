import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AgentRuntime,
  BanditSkillPolicy,
  DefaultRewardComputer,
  DefaultSkillEvaluator,
  DefaultSkillTransferEngine,
  InMemoryRewardStore,
  InMemorySkillPolicyStateStore,
  InMemorySkillStore,
  ProceduralMemoryProvider,
  SkillOnlineLearner,
  SqliteRuntimeStateStore
} from "@neurocore/runtime-core";

let counter = 0;
function gid(prefix) {
  counter += 1;
  return `${prefix}_${counter}`;
}

function ts() {
  return new Date().toISOString();
}

function makeEpisode(overrides = {}) {
  return {
    episode_id: gid("epi"),
    schema_version: "1.0.0",
    session_id: "ses_1",
    trigger_summary: "fetch data",
    goal_refs: ["goal_1"],
    context_digest: "fetch data",
    selected_strategy: "Call fetch_data",
    action_refs: ["act_1"],
    observation_refs: ["obs_1"],
    outcome: "success",
    outcome_summary: "done",
    valence: "positive",
    metadata: {
      action_type: "call_tool",
      tool_name: "fetch_data",
      cycle_count: 1,
      side_effect_level: "low"
    },
    created_at: ts(),
    ...overrides
  };
}

function makeProfile(overrides = {}) {
  return {
    agent_id: "skill-rl-agent",
    schema_version: "1.0.0",
    name: "Skill RL Agent",
    version: "1.0.0",
    role: "assistant",
    domain: "analytics",
    mode: "runtime",
    tool_refs: ["fetch_data"],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    rl_config: {
      enabled: true,
      policy: {
        alpha: 0.5,
        default_q_value: 0.5
      },
      exploration: {
        strategy: "epsilon_greedy",
        initial_epsilon: 0.3,
        epsilon_decay: 0.995,
        epsilon_min: 0.01
      },
      evaluation: {
        enabled: true,
        deprecate_threshold: 0.4,
        prune_ttl_ms: 0,
        prune_mode: "soft"
      },
      transfer: {
        enabled: true,
        similarity_threshold: 0.2,
        confidence_penalty: 0.15,
        validation_uses: 2
      },
      online_learning: {
        enabled: true,
        replay_buffer_size: 16,
        batch_size: 2,
        update_interval_episodes: 2
      }
    },
    runtime_config: {
      max_cycles: 4
    },
    ...overrides
  };
}

function makeCtx(overrides = {}) {
  return {
    tenant_id: "tenant_1",
    session: {
      session_id: "ses_1",
      schema_version: "1.0.0",
      tenant_id: "tenant_1",
      agent_id: "agent_1",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal_tree_1",
      budget_state: {},
      policy_state: {},
      current_cycle_id: "cyc_1"
    },
    profile: makeProfile(),
    goals: [],
    runtime_state: {
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    },
    services: {
      now: () => ts(),
      generateId: (prefix) => gid(prefix)
    },
    ...overrides
  };
}

test("DefaultRewardComputer computes four-dimensional reward signal", async () => {
  const computer = new DefaultRewardComputer();
  const episode = makeEpisode({
    metadata: {
      action_type: "call_tool",
      tool_name: "fetch_data",
      cycle_count: 1,
      side_effect_level: "low",
      user_feedback_score: 5
    }
  });

  const reward = await computer.compute(episode, {
    tenant_id: "tenant_1",
    session_id: "ses_1",
    skill_id: "skl_1",
    prediction_errors: []
  });

  assert.equal(reward.skill_id, "skl_1");
  assert.equal(reward.dimensions.length, 4);
  assert.ok(reward.composite_reward <= 1 && reward.composite_reward >= -1);
  assert.equal(reward.dimensions.find((item) => item.name === "user_satisfaction")?.source, "human_feedback");
});

test("DefaultRewardComputer uses cycle, token, and latency metrics for efficiency", async () => {
  const computer = new DefaultRewardComputer();
  const fastReward = await computer.compute(makeEpisode(), {
    tenant_id: "tenant_1",
    session_id: "ses_1",
    skill_id: "skl_1",
    prediction_errors: [],
    cycle_metrics: {
      cycle_index: 1,
      total_latency_ms: 500,
      total_tokens: 180
    }
  });
  const slowReward = await computer.compute(makeEpisode({
    outcome: "partial"
  }), {
    tenant_id: "tenant_1",
    session_id: "ses_1",
    skill_id: "skl_1",
    prediction_errors: [],
    cycle_metrics: {
      cycle_index: 4,
      total_latency_ms: 12000,
      total_tokens: 5200
    }
  });

  const fastEfficiency = fastReward.dimensions.find((item) => item.name === "efficiency")?.value;
  const slowEfficiency = slowReward.dimensions.find((item) => item.name === "efficiency")?.value;
  assert.ok(typeof fastEfficiency === "number");
  assert.ok(typeof slowEfficiency === "number");
  assert.ok(fastEfficiency > slowEfficiency);
});

test("BanditSkillPolicy selects highest-Q skill and updates value", async () => {
  const store = new InMemorySkillPolicyStateStore();
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_best",
    q_value: 0.9,
    sample_count: 4,
    success_count: 4,
    failure_count: 0,
    average_reward: 0.8,
    selection_count: 4,
    exploit_count: 4,
    explore_count: 0,
    updated_at: ts()
  });
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_other",
    q_value: 0.2,
    sample_count: 4,
    success_count: 1,
    failure_count: 3,
    average_reward: -0.2,
    selection_count: 4,
    exploit_count: 2,
    explore_count: 2,
    updated_at: ts()
  });

  const policy = new BanditSkillPolicy(store);
  const selection = await policy.selectSkill({
    tenant_id: "tenant_1",
    session_id: "ses_1",
    cycle_id: "cyc_1",
    candidates: [
      {
        tenant_id: "tenant_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        skill_id: "skl_best",
        skill_name: "best",
        skill_version: "1.0.0",
        trigger_score: 1,
        q_value: 0.9,
        sample_count: 4,
        success_rate: 1,
        average_reward: 0.8
      },
      {
        tenant_id: "tenant_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        skill_id: "skl_other",
        skill_name: "other",
        skill_version: "1.0.0",
        trigger_score: 1,
        q_value: 0.2,
        sample_count: 4,
        success_rate: 0.25,
        average_reward: -0.2
      }
    ],
    profile: makeProfile({
      rl_config: {
        ...makeProfile().rl_config,
        exploration: {
          strategy: "epsilon_greedy",
          initial_epsilon: 0,
          epsilon_decay: 1,
          epsilon_min: 0
        }
      }
    }),
    runtime_state: {}
  });

  assert.equal(selection.skill_id, "skl_best");
  assert.equal(selection.selection_reason, "exploit");

  policy.configure({ alpha: 0.5 });
  const update = await policy.update({
    feedback_id: gid("plf"),
    tenant_id: "tenant_1",
    session_id: "ses_1",
    cycle_id: "cyc_1",
    skill_id: "skl_best",
    reward_signal_id: "rwd_1",
    composite_reward: 1,
    success: true,
    source: "episode",
    updated_at: ts()
  });

  assert.ok(update.state.q_value > 0.9);
});

test("BanditSkillPolicy can trigger epsilon-greedy exploration", async () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const policy = new BanditSkillPolicy(new InMemorySkillPolicyStateStore());
    const selection = await policy.selectSkill({
      tenant_id: "tenant_1",
      session_id: "ses_1",
      cycle_id: "cyc_1",
      candidates: [
        {
          tenant_id: "tenant_1",
          session_id: "ses_1",
          cycle_id: "cyc_1",
          skill_id: "skl_best",
          skill_name: "best",
          skill_version: "1.0.0",
          trigger_score: 1,
          q_value: 0.9,
          sample_count: 10,
          success_rate: 0.9,
          average_reward: 0.8,
          risk_level: "low"
        },
        {
          tenant_id: "tenant_1",
          session_id: "ses_1",
          cycle_id: "cyc_1",
          skill_id: "skl_alt",
          skill_name: "alt",
          skill_version: "1.0.0",
          trigger_score: 1,
          q_value: 0.4,
          sample_count: 1,
          success_rate: 0.5,
          average_reward: 0.2,
          risk_level: "low"
        }
      ],
      profile: makeProfile({
        rl_config: {
          ...makeProfile().rl_config,
          exploration: {
            strategy: "epsilon_greedy",
            initial_epsilon: 1,
            epsilon_decay: 1,
            epsilon_min: 1
          }
        }
      }),
      runtime_state: {}
    });

    assert.equal(selection.selection_reason, "explore");
    assert.equal(selection.skill_id, "skl_alt");
  } finally {
    Math.random = originalRandom;
  }
});

test("BanditSkillPolicy prefers contextual state over global state", async () => {
  const store = new InMemorySkillPolicyStateStore();
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_a",
    q_value: 0.2,
    sample_count: 8,
    success_count: 2,
    failure_count: 6,
    average_reward: -0.1,
    selection_count: 8,
    exploit_count: 6,
    explore_count: 2,
    updated_at: ts()
  });
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_b",
    q_value: 0.8,
    sample_count: 8,
    success_count: 7,
    failure_count: 1,
    average_reward: 0.7,
    selection_count: 8,
    exploit_count: 8,
    explore_count: 0,
    updated_at: ts()
  });
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_a",
    context_key: "verification:analytics:call_tool:fetch_data:low",
    goal_type: "verification",
    domain: "analytics",
    action_type: "call_tool",
    tool_name: "fetch_data",
    risk_level: "low",
    q_value: 0.95,
    sample_count: 4,
    success_count: 4,
    failure_count: 0,
    average_reward: 0.9,
    selection_count: 4,
    exploit_count: 4,
    explore_count: 0,
    updated_at: ts()
  });

  const policy = new BanditSkillPolicy(store);
  const selection = await policy.selectSkill({
    tenant_id: "tenant_1",
    session_id: "ses_1",
    cycle_id: "cyc_1",
    candidates: [
      {
        tenant_id: "tenant_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        skill_id: "skl_a",
        skill_name: "contextual",
        skill_version: "1.0.0",
        trigger_score: 1,
        q_value: 0.2,
        sample_count: 8,
        success_rate: 0.25,
        average_reward: -0.1,
        risk_level: "low"
      },
      {
        tenant_id: "tenant_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        skill_id: "skl_b",
        skill_name: "global",
        skill_version: "1.0.0",
        trigger_score: 1,
        q_value: 0.8,
        sample_count: 8,
        success_rate: 0.875,
        average_reward: 0.7,
        risk_level: "low"
      }
    ],
    profile: makeProfile({
      domain: "analytics",
      rl_config: {
        ...makeProfile().rl_config,
        exploration: {
          strategy: "epsilon_greedy",
          initial_epsilon: 0,
          epsilon_decay: 1,
          epsilon_min: 0
        }
      }
    }),
    runtime_state: {
      current_goal_type: "verification",
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    }
  });

  assert.equal(selection.skill_id, "skl_a");
  assert.equal(selection.context_key, "verification:analytics:call_tool:fetch_data:low");
  assert.equal(selection.selection_reason, "exploit");
});

test("BanditSkillPolicy falls back to family context when exact state is absent", async () => {
  const store = new InMemorySkillPolicyStateStore();
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_a",
    context_key: "verification:analytics:call_tool:*:*",
    goal_type: "verification",
    domain: "analytics",
    action_type: "call_tool",
    q_value: 0.9,
    sample_count: 5,
    success_count: 5,
    failure_count: 0,
    average_reward: 0.85,
    selection_count: 5,
    exploit_count: 5,
    explore_count: 0,
    updated_at: ts()
  });
  store.save({
    tenant_id: "tenant_1",
    skill_id: "skl_b",
    q_value: 0.7,
    sample_count: 6,
    success_count: 5,
    failure_count: 1,
    average_reward: 0.68,
    selection_count: 6,
    exploit_count: 6,
    explore_count: 0,
    updated_at: ts()
  });

  const policy = new BanditSkillPolicy(store);
  const selection = await policy.selectSkill({
    tenant_id: "tenant_1",
    session_id: "ses_1",
    cycle_id: "cyc_1",
    candidates: [
      {
        tenant_id: "tenant_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        skill_id: "skl_a",
        skill_name: "family",
        skill_version: "1.0.0",
        trigger_score: 1,
        q_value: 0.2,
        sample_count: 1,
        success_rate: 0.2,
        average_reward: 0.1,
        risk_level: "low"
      },
      {
        tenant_id: "tenant_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        skill_id: "skl_b",
        skill_name: "global",
        skill_version: "1.0.0",
        trigger_score: 1,
        q_value: 0.7,
        sample_count: 6,
        success_rate: 0.83,
        average_reward: 0.68,
        risk_level: "low"
      }
    ],
    profile: makeProfile({
      domain: "analytics",
      rl_config: {
        ...makeProfile().rl_config,
        exploration: {
          strategy: "epsilon_greedy",
          initial_epsilon: 0,
          epsilon_decay: 1,
          epsilon_min: 0
        }
      }
    }),
    runtime_state: {
      current_goal_type: "verification",
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    }
  });

  assert.equal(selection.skill_id, "skl_a");
  assert.equal(selection.context_resolution_level, "family");
});

test("DefaultSkillEvaluator deprecates weak skill and provider prunes it", async () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_bad",
    schema_version: "1.0.0",
    name: "bad",
    version: "1.0.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [{ field: "tool_name", operator: "eq", value: "fetch_data" }],
    execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
    metadata: { tenant_id: "tenant_1", compiled_at: new Date(0).toISOString() }
  });
  const policy = new BanditSkillPolicy(new InMemorySkillPolicyStateStore());
  const provider = new ProceduralMemoryProvider(
    store,
    3,
    policy,
    new DefaultSkillEvaluator(),
    new DefaultSkillTransferEngine()
  );

  const rewardsBySkillId = () => [{
    signal_id: "r1",
    episode_id: "e1",
    skill_id: "skl_bad",
    session_id: "ses_1",
    tenant_id: "tenant_1",
    dimensions: [],
    composite_reward: -0.9,
    timestamp: ts()
  }];

  provider.evaluateSkills("tenant_1", rewardsBySkillId, makeProfile({
    rl_config: {
      ...makeProfile().rl_config,
      evaluation: {
        enabled: true,
        deprecate_threshold: 0.8,
        prune_ttl_ms: 0,
        prune_mode: "hard"
      }
    }
  }), ts());

  const evaluations = provider.drainLastEvaluations();
  const pruned = provider.drainLastPrunedSkills();
  assert.equal(evaluations[0].status, "deprecated");
  assert.equal(pruned.length, 1);
  assert.equal(store.list("tenant_1").length, 0);
});

test("SkillEvaluator prunes stale skills after TTL even when score is not deprecated", () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_stale",
    schema_version: "1.0.0",
    name: "stale",
    version: "1.0.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [{ field: "tool_name", operator: "eq", value: "fetch_data" }],
    execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
    metadata: { tenant_id: "tenant_1", compiled_at: new Date(0).toISOString() }
  });

  const policy = new BanditSkillPolicy(new InMemorySkillPolicyStateStore());
  const provider = new ProceduralMemoryProvider(
    store,
    3,
    policy,
    new DefaultSkillEvaluator(),
    new DefaultSkillTransferEngine()
  );

  provider.evaluateSkills("tenant_1", () => [{
    signal_id: "r1",
    episode_id: "e1",
    skill_id: "skl_stale",
    session_id: "ses_1",
    tenant_id: "tenant_1",
    dimensions: [],
    composite_reward: 0.95,
    timestamp: ts()
  }], makeProfile({
    rl_config: {
      ...makeProfile().rl_config,
      evaluation: {
        enabled: true,
        deprecate_threshold: 0.2,
        prune_ttl_ms: 0,
        prune_mode: "soft"
      }
    }
  }), ts());

  const pruned = provider.drainLastPrunedSkills();
  assert.equal(pruned.length, 1);
  assert.equal(store.get("skl_stale")?.status, "pruned");
});

test("DefaultSkillTransferEngine creates transferred skill for similar domain", () => {
  const engine = new DefaultSkillTransferEngine();
  const result = engine.transfer({
    tenant_id: "tenant_1",
    profile: makeProfile({ domain: "analytics reporting" }),
    target_domain: "analytics dashboard",
    skill: {
      skill_id: "skl_source",
      schema_version: "1.0.0",
      name: "source",
      version: "1.0.0",
      status: "active",
      kind: "toolchain_skill",
      trigger_conditions: [{ field: "tool_name", operator: "eq", value: "fetch_data" }],
      execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
      applicable_domains: ["analytics reporting"],
      metadata: { tenant_id: "tenant_1" }
    }
  });

  assert.ok(result);
  assert.notEqual(result.skill.skill_id, "skl_source");
  assert.equal(result.result.source_skill_id, "skl_source");
  assert.equal(result.result.target_domain, "analytics dashboard");
});

test("ProceduralMemoryProvider reuses existing transferred skill instead of duplicating it", async () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_source",
    schema_version: "1.0.0",
    name: "source",
    version: "1.0.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [
      { field: "tool_name", operator: "eq", value: "fetch_data" },
      { field: "action_type", operator: "eq", value: "call_tool" }
    ],
    execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
    applicable_domains: ["analytics reporting"],
    metadata: { tenant_id: "tenant_1", pattern_key: "fetch_data:call_tool_fetch_data" }
  });

  const provider = new ProceduralMemoryProvider(
    store,
    3,
    new BanditSkillPolicy(new InMemorySkillPolicyStateStore()),
    new DefaultSkillEvaluator(),
    new DefaultSkillTransferEngine()
  );
  const ctx = makeCtx({
    profile: makeProfile({
      domain: "analytics dashboard",
      rl_config: {
        ...makeProfile().rl_config,
        transfer: {
          enabled: true,
          similarity_threshold: 0.2,
          confidence_penalty: 0.15,
          validation_uses: 2
        }
      }
    }),
    runtime_state: {
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    }
  });

  await provider.retrieve(ctx);
  const afterFirst = store.list("tenant_1");
  const transferredCountAfterFirst = afterFirst.filter((skill) => skill.metadata?.transferred_from_skill_id === "skl_source").length;
  assert.equal(transferredCountAfterFirst, 1);

  provider.clearLastTransferredSkill();
  await provider.retrieve(ctx);
  const afterSecond = store.list("tenant_1");
  const transferredCountAfterSecond = afterSecond.filter((skill) => skill.metadata?.transferred_from_skill_id === "skl_source").length;
  assert.equal(transferredCountAfterSecond, 1);
});

test("Transferred skill validation window decrements on success and clears penalty after validation", () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_transfer",
    schema_version: "1.0.0",
    name: "transfer",
    version: "1.1.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [{ field: "tool_name", operator: "eq", value: "fetch_data" }],
    execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
    metadata: {
      tenant_id: "tenant_1",
      transferred_from_skill_id: "skl_source",
      target_domain: "analytics dashboard",
      confidence_penalty: 0.15,
      validation_remaining_uses: 2
    }
  });

  const provider = new ProceduralMemoryProvider(store);
  provider.reconcileTransferredSkillOutcome("tenant_1", "skl_transfer", "success");
  const afterFirst = store.get("skl_transfer");
  assert.equal(afterFirst?.metadata?.validation_remaining_uses, 1);
  assert.equal(afterFirst?.metadata?.confidence_penalty, 0.15);

  provider.reconcileTransferredSkillOutcome("tenant_1", "skl_transfer", "success");
  const afterSecond = store.get("skl_transfer");
  assert.equal(afterSecond?.metadata?.validation_remaining_uses, undefined);
  assert.equal(afterSecond?.metadata?.confidence_penalty, undefined);
  assert.ok(typeof afterSecond?.metadata?.transfer_validated_at === "string");
});

test("Transferred skill is reverted on failed validation", () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_source",
    schema_version: "1.0.0",
    name: "source",
    version: "1.0.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [{ field: "tool_name", operator: "eq", value: "fetch_data" }],
    execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
    metadata: { tenant_id: "tenant_1" }
  });
  store.save({
    skill_id: "skl_transfer",
    schema_version: "1.0.0",
    name: "transfer",
    version: "1.1.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [{ field: "tool_name", operator: "eq", value: "fetch_data" }],
    execution_template: { kind: "toolchain", tool_name: "fetch_data", action_type: "call_tool" },
    metadata: {
      tenant_id: "tenant_1",
      transferred_from_skill_id: "skl_source",
      target_domain: "analytics dashboard",
      confidence_penalty: 0.15,
      validation_remaining_uses: 2
    }
  });

  const provider = new ProceduralMemoryProvider(store);
  const reverted = provider.reconcileTransferredSkillOutcome("tenant_1", "skl_transfer", "failure");
  assert.equal(reverted?.status, "pruned");
  assert.equal(store.get("skl_transfer"), undefined);
  assert.ok(store.get("skl_source"));
});

test("SkillOnlineLearner triggers async replay batch updates", async () => {
  const batches = [];
  const learner = new SkillOnlineLearner({
    policy: {
      async selectSkill() { return null; },
      async update() {
        return {
          state: {
            tenant_id: "tenant_1",
            skill_id: "skl_1",
            q_value: 0.5,
            sample_count: 1,
            success_count: 1,
            failure_count: 0,
            average_reward: 0.5,
            selection_count: 1,
            exploit_count: 1,
            explore_count: 0,
            updated_at: ts()
          },
          td_error: 0.1
        };
      },
      async batchUpdate(batch) {
        batches.push(batch);
        return [];
      },
      getState() { return undefined; },
      listStates() { return []; }
    },
    replayBufferSize: 8,
    batchSize: 2,
    updateIntervalEpisodes: 2
  });

  learner.observe({
    experience_id: "exp1",
    tenant_id: "tenant_1",
    session_id: "ses_1",
    cycle_id: "cyc_1",
    skill_id: "skl_1",
    reward_signal_id: "r1",
    reward: 0.4,
    td_error: 0.2,
    created_at: ts()
  });
  learner.observe({
    experience_id: "exp2",
    tenant_id: "tenant_1",
    session_id: "ses_1",
    cycle_id: "cyc_2",
    skill_id: "skl_1",
    reward_signal_id: "r2",
    reward: 0.9,
    td_error: 0.8,
    created_at: ts()
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
});

test("AgentRuntime computes reward and policy updates after skill execution", async () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_fetch_1",
    schema_version: "1.0.0",
    name: "fetch_data_skill",
    version: "1.0.0",
    status: "active",
    kind: "toolchain_skill",
    trigger_conditions: [
      { field: "tool_name", operator: "eq", value: "fetch_data" },
      { field: "action_type", operator: "eq", value: "call_tool" }
    ],
    execution_template: {
      kind: "toolchain",
      steps: ["Call fetch_data"],
      tool_name: "fetch_data",
      action_type: "call_tool",
      default_args: { query: "from_skill" }
    },
    risk_level: "low",
    applicable_domains: ["analytics"],
    metadata: {
      tenant_id: "tenant_skill_rl",
      pattern_key: "fetch_data:call_tool_fetch_data",
      source_episode_ids: ["ep1", "ep2", "ep3"]
    }
  });

  const reasoner = {
    name: "skill-rl-reasoner",
    async plan() { return []; },
    async respond() { return []; },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };

  const runtime = new AgentRuntime({ reasoner, skillStore: store });
  runtime.tools.register({
    name: "fetch_data",
    sideEffectLevel: "none",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    async invoke(input) {
      return {
        summary: `fetched:${input.query}`
      };
    }
  });

  const profile = makeProfile({
    agent_id: "skill-rl-runtime-agent",
    name: "Skill RL Runtime Agent",
    domain: "analytics"
  });

  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_skill_rl",
    initial_input: { content: "fetch" }
  });

  const result = await runtime.runOnce(profile, session.session_id, {
    input_id: gid("inp"),
    content: "fetch",
    created_at: ts(),
    metadata: {
      sourceToolName: "fetch_data",
      sourceActionType: "call_tool"
    }
  });

  assert.equal(result.observation?.summary, "fetched:from_skill");
  const rewards = runtime.listRewardSignals(session.session_id);
  const states = runtime.listSkillPolicyStates(session.session_id);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].skill_id, "skl_fetch_1");
  assert.ok(rewards[0].metrics?.total_tokens);
  assert.ok(rewards[0].metrics?.cycle_index);
  assert.equal(states.length, 4);
  assert.ok(states.every((state) => state.skill_id === "skl_fetch_1"));
  const exactState = states.find((state) => state.context_key === "task:analytics:call_tool:fetch_data:low");
  const operationalState = states.find((state) => state.context_key === "task:analytics:call_tool:fetch_data:*");
  const familyState = states.find((state) => state.context_key === "task:analytics:call_tool:*:*");
  const globalState = states.find((state) => state.context_key === undefined);
  assert.ok(exactState);
  assert.ok(operationalState);
  assert.ok(familyState);
  assert.ok(globalState);
  assert.ok(exactState.sample_count >= 1);
  assert.ok(operationalState.sample_count >= 1);
  assert.ok(familyState.sample_count >= 1);
  assert.ok(globalState.sample_count >= 1);

  const events = runtime.listEvents(session.session_id);
  assert.ok(events.some((event) => event.event_type === "reward.computed"));
  assert.ok(events.some((event) => event.event_type === "policy.updated"));
  assert.ok(events.some((event) => event.event_type === "skill.evaluated"));
  const policyUpdated = events.find((event) => event.event_type === "policy.updated");
  const explorationTriggered = events.find((event) => event.event_type === "exploration.triggered");
  assert.ok(policyUpdated?.payload.avg_td_error !== undefined);
  assert.ok(Array.isArray(policyUpdated?.payload.states));
  if (explorationTriggered) {
    assert.ok(typeof explorationTriggered.payload.exploration_rate === "number");
  }
});

test("SQLite-backed reward and policy state persist across runtime restart", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-skill-rl-sqlite-"));
  try {
    const filename = join(stateDir, "runtime.db");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    const store = new InMemorySkillStore();
    store.save({
      skill_id: "skl_fetch_1",
      schema_version: "1.0.0",
      name: "fetch_data_skill",
      version: "1.0.0",
      status: "active",
      kind: "toolchain_skill",
      trigger_conditions: [
        { field: "tool_name", operator: "eq", value: "fetch_data" },
        { field: "action_type", operator: "eq", value: "call_tool" }
      ],
      execution_template: {
        kind: "toolchain",
        tool_name: "fetch_data",
        action_type: "call_tool",
        default_args: { query: "persisted" }
      },
      risk_level: "low",
      metadata: {
        tenant_id: "tenant_skill_rl_sql",
        pattern_key: "fetch_data:call_tool_fetch_data",
        source_episode_ids: ["ep1", "ep2", "ep3"]
      }
    });

    const reasoner = {
      name: "skill-rl-restart-reasoner",
      async plan() { return []; },
      async respond() { return []; },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    };

    const seedRuntime = new AgentRuntime({ reasoner, stateStore, skillStore: store });
    seedRuntime.tools.register({
      name: "fetch_data",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      async invoke(input) {
        return {
          summary: `fetched:${input.query}`
        };
      }
    });

    const profile = makeProfile({
      agent_id: "skill-rl-sql-runtime-agent",
      name: "Skill RL SQL Runtime Agent"
    });
    const session = seedRuntime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_skill_rl_sql",
      initial_input: { content: "fetch" }
    });
    await seedRuntime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "fetch",
      created_at: ts(),
      metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    });

    const restoredRuntime = new AgentRuntime({
      reasoner,
      stateStore: new SqliteRuntimeStateStore({ filename })
    });
    const rewards = restoredRuntime.listRewardSignals(session.session_id);
    const states = restoredRuntime.listSkillPolicyStates(session.session_id);

    assert.equal(rewards.length, 1);
    assert.ok(rewards[0].metrics?.total_tokens);
    assert.equal(states.length, 4);
    assert.ok(states.every((state) => state.skill_id === "skl_fetch_1"));
    const contextualState = states.find((state) => state.context_key === "task:analytics:call_tool:fetch_data:low");
    const operationalState = states.find((state) => state.context_key === "task:analytics:call_tool:fetch_data:*");
    const familyState = states.find((state) => state.context_key === "task:analytics:call_tool:*:*");
    const globalState = states.find((state) => state.context_key === undefined);
    assert.ok(contextualState);
    assert.ok(operationalState);
    assert.ok(familyState);
    assert.ok(globalState);
    assert.equal(contextualState.domain, "analytics");
    assert.equal(contextualState.action_type, "call_tool");
    assert.equal(contextualState.tool_name, "fetch_data");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("Reward baseline metrics are derived from prior skill executions", async () => {
  const computer = new DefaultRewardComputer();
  const baselineReward = await computer.compute(makeEpisode(), {
    tenant_id: "tenant_1",
    session_id: "ses_1",
    skill_id: "skl_1",
    prediction_errors: [],
    cycle_metrics: {
      cycle_index: 3,
      total_latency_ms: 9000,
      total_tokens: 3600
    },
    baseline_metrics: {
      avg_cycles: 2,
      avg_latency_ms: 4000,
      avg_tokens: 1500
    }
  });
  const efficiency = baselineReward.dimensions.find((item) => item.name === "efficiency")?.value;
  assert.ok(typeof efficiency === "number");
  assert.ok(efficiency < 0.2);
  assert.deepEqual(baselineReward.baseline_metrics, {
    avg_cycles: 2,
    avg_latency_ms: 4000,
    avg_tokens: 1500
  });
});
