import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AgentRuntime,
  FileRuntimeStateStore,
  InMemorySkillStore,
  ProceduralMemoryProvider,
  derivePatternKey,
  shouldPromoteToSkill,
  compileSkillFromEpisodes
} from "@neurocore/runtime-core";
import { defineAgent } from "@neurocore/sdk-core";

function ts() {
  return new Date().toISOString();
}

let idCounter = 0;
function gid(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function makeEpisode(overrides = {}) {
  const id = gid("epi");
  return {
    episode_id: id,
    schema_version: "1.0.0",
    session_id: "ses_1",
    trigger_summary: "test input",
    goal_refs: ["goal_1"],
    context_digest: "test context",
    selected_strategy: "Call tool: fetch_data",
    action_refs: ["act_1"],
    observation_refs: ["obs_1"],
    outcome: "success",
    outcome_summary: "Fetched data successfully",
    created_at: ts(),
    metadata: {
      action_type: "call_tool",
      tool_name: "fetch_data"
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
      policy_state: {}
    },
    profile: {
      agent_id: "agent_1",
      schema_version: "1.0.0",
      name: "test-agent",
      version: "1.0.0",
      role: "assistant",
      mode: "runtime",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: {
        working_memory_enabled: true,
        episodic_memory_enabled: true,
        semantic_memory_enabled: true,
        procedural_memory_enabled: true,
        write_policy: "immediate"
      },
      runtime_config: { max_cycles: 10 }
    },
    goals: [],
    runtime_state: {},
    services: {
      now: () => ts(),
      generateId: (prefix) => gid(prefix)
    },
    ...overrides
  };
}

test("InMemorySkillStore CRUD and findByTrigger", () => {
  const store = new InMemorySkillStore();

  const skill = {
    skill_id: "skl_1",
    schema_version: "1.0.0",
    name: "fetch_data:call_tool_fetch_data",
    version: "1.0.0",
    kind: "toolchain_skill",
    trigger_conditions: [
      { field: "tool_name", operator: "eq", value: "fetch_data" }
    ],
    execution_template: { kind: "toolchain", steps: ["Call tool: fetch_data"] },
    metadata: { tenant_id: "tenant_1" }
  };

  store.save(skill);
  assert.ok(store.get("skl_1"));
  assert.equal(store.get("skl_1").name, "fetch_data:call_tool_fetch_data");
  assert.equal(store.list("tenant_1").length, 1);
  assert.equal(store.list("tenant_2").length, 0);

  const matched = store.findByTrigger("tenant_1", { tool_name: "fetch_data" });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].skill_id, "skl_1");

  const noMatch = store.findByTrigger("tenant_1", { tool_name: "other_tool" });
  assert.equal(noMatch.length, 0);

  store.delete("skl_1");
  assert.equal(store.get("skl_1"), undefined);
  assert.equal(store.list("tenant_1").length, 0);
});

test("InMemorySkillStore findByTrigger supports contains operator", () => {
  const store = new InMemorySkillStore();
  const skill = {
    skill_id: "skl_c1",
    schema_version: "1.0.0",
    name: "search_skill",
    version: "1.0.0",
    kind: "reasoning_skill",
    trigger_conditions: [
      { field: "input_content", operator: "contains", value: "search" }
    ],
    execution_template: { kind: "reasoning", steps: ["search and summarize"] },
    metadata: { tenant_id: "t1" }
  };
  store.save(skill);

  assert.equal(store.findByTrigger("t1", { input_content: "please search for info" }).length, 1);
  assert.equal(store.findByTrigger("t1", { input_content: "hello world" }).length, 0);
});

test("InMemorySkillStore findByTrigger supports gt/lt operators", () => {
  const store = new InMemorySkillStore();
  const skill = {
    skill_id: "skl_n1",
    schema_version: "1.0.0",
    name: "high_priority",
    version: "1.0.0",
    kind: "reasoning_skill",
    trigger_conditions: [
      { field: "priority", operator: "gt", value: 5 }
    ],
    execution_template: { kind: "reasoning", steps: ["handle high priority"] },
    metadata: { tenant_id: "t1" }
  };
  store.save(skill);

  assert.equal(store.findByTrigger("t1", { priority: 8 }).length, 1);
  assert.equal(store.findByTrigger("t1", { priority: 3 }).length, 0);
  assert.equal(store.findByTrigger("t1", { priority: 5 }).length, 0);
});

test("InMemorySkillStore deleteByTenant removes all tenant skills", () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_t1",
    schema_version: "1.0.0",
    name: "s1",
    version: "1.0.0",
    kind: "reasoning_skill",
    trigger_conditions: [],
    execution_template: { kind: "reasoning" },
    metadata: { tenant_id: "t1" }
  });
  store.save({
    skill_id: "skl_t2",
    schema_version: "1.0.0",
    name: "s2",
    version: "1.0.0",
    kind: "reasoning_skill",
    trigger_conditions: [],
    execution_template: { kind: "reasoning" },
    metadata: { tenant_id: "t1" }
  });
  store.save({
    skill_id: "skl_t3",
    schema_version: "1.0.0",
    name: "s3",
    version: "1.0.0",
    kind: "reasoning_skill",
    trigger_conditions: [],
    execution_template: { kind: "reasoning" },
    metadata: { tenant_id: "t2" }
  });

  assert.equal(store.list("t1").length, 2);
  store.deleteByTenant("t1");
  assert.equal(store.list("t1").length, 0);
  assert.equal(store.list("t2").length, 1);
});

test("shouldPromoteToSkill returns true when threshold met", () => {
  const episodes = [
    makeEpisode({ episode_id: "ep1" }),
    makeEpisode({ episode_id: "ep2" }),
    makeEpisode({ episode_id: "ep3" })
  ];
  const patternKey = derivePatternKey(episodes[0]);
  assert.equal(shouldPromoteToSkill(episodes, patternKey, 3), true);
  assert.equal(shouldPromoteToSkill(episodes, patternKey, 4), false);
});

test("shouldPromoteToSkill ignores non-success episodes", () => {
  const episodes = [
    makeEpisode({ episode_id: "ep1" }),
    makeEpisode({ episode_id: "ep2" }),
    makeEpisode({ episode_id: "ep3", outcome: "failure" })
  ];
  const patternKey = derivePatternKey(episodes[0]);
  assert.equal(shouldPromoteToSkill(episodes, patternKey, 3), false);
});

test("compileSkillFromEpisodes produces correct skill", () => {
  const episodes = [
    makeEpisode({ episode_id: "ep1", metadata: { action_type: "call_tool", tool_name: "fetch_data", tool_args: { query: "stable" } } }),
    makeEpisode({ episode_id: "ep2", metadata: { action_type: "call_tool", tool_name: "fetch_data", tool_args: { query: "stable" } } }),
    makeEpisode({ episode_id: "ep3", metadata: { action_type: "call_tool", tool_name: "fetch_data", tool_args: { query: "stable" } } })
  ];
  const patternKey = derivePatternKey(episodes[0]);

  const skill = compileSkillFromEpisodes(episodes, patternKey, "tenant_1", gid, ts);

  assert.equal(skill.kind, "toolchain_skill");
  assert.equal(skill.version, "1.0.0");
  assert.ok(skill.trigger_conditions.length > 0);
  assert.equal(skill.trigger_conditions[0].field, "tool_name");
  assert.equal(skill.trigger_conditions[0].operator, "eq");
  assert.equal(skill.trigger_conditions[0].value, "fetch_data");
  assert.equal(skill.execution_template.kind, "toolchain");
  assert.equal(skill.execution_template.tool_name, "fetch_data");
  assert.equal(skill.execution_template.action_type, "call_tool");
  assert.deepEqual(skill.execution_template.default_args, { query: "stable" });
  assert.ok(skill.execution_template.steps.length > 0);
  assert.ok(skill.metadata.tenant_id === "tenant_1");
  assert.ok(skill.metadata.source_episode_ids.length === 3);
  assert.ok(skill.metadata.pattern_key === patternKey);
});

test("compileSkillFromEpisodes produces reasoning_skill when no tool", () => {
  const episodes = [
    makeEpisode({ episode_id: "ep1", metadata: { action_type: "respond" } }),
    makeEpisode({ episode_id: "ep2", metadata: { action_type: "respond" } }),
    makeEpisode({ episode_id: "ep3", metadata: { action_type: "respond" } })
  ];
  const patternKey = derivePatternKey(episodes[0]);

  const skill = compileSkillFromEpisodes(episodes, patternKey, "tenant_1", gid, ts);
  assert.equal(skill.kind, "reasoning_skill");
  assert.equal(skill.execution_template.kind, "reasoning");
});

test("ProceduralMemoryProvider writeEpisode accumulates and promotes after threshold", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  assert.equal(store.list("tenant_1").length, 0);
  assert.equal(provider.getLastPromotedSkill(), null);

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));
  assert.equal(store.list("tenant_1").length, 0);

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));
  assert.equal(store.list("tenant_1").length, 1);
  assert.ok(provider.getLastPromotedSkill());
  assert.equal(provider.getLastPromotedSkill().kind, "toolchain_skill");
});

test("ProceduralMemoryProvider does not promote when procedural_memory_enabled is false", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();
  ctx.profile.memory_config.procedural_memory_enabled = false;

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));
  assert.equal(store.list("tenant_1").length, 0);
});

test("ProceduralMemoryProvider match returns skill_match proposals after promotion", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));

  const matchCtx = makeCtx({
    runtime_state: {
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    }
  });
  const proposals = await provider.match(matchCtx);
  assert.ok(proposals.length > 0);
  assert.equal(proposals[0].proposal_type, "skill_match");
  assert.ok(proposals[0].payload.skill_id);
  assert.equal(proposals[0].payload.kind, "toolchain_skill");
});

test("ProceduralMemoryProvider does not duplicate skills on repeated writes", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  for (let i = 1; i <= 5; i++) {
    await provider.writeEpisode(ctx, makeEpisode({ episode_id: `ep${i}` }));
  }
  assert.equal(store.list("tenant_1").length, 1);
});

test("ProceduralMemoryProvider execute returns null for toolchain_skill", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));

  const skill = store.list("tenant_1")[0];
  const action = {
    action_id: "act_test",
    action_type: "call_tool",
    title: "Test action",
    tool_name: "fetch_data"
  };

  const result = await provider.execute(ctx, skill.skill_id, action);
  assert.equal(result, null);
});

test("ProceduralMemoryProvider execute returns null for reasoning_skill", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  const episodes = [
    makeEpisode({ episode_id: "ep1", metadata: { action_type: "respond" } }),
    makeEpisode({ episode_id: "ep2", metadata: { action_type: "respond" } }),
    makeEpisode({ episode_id: "ep3", metadata: { action_type: "respond" } })
  ];
  for (const ep of episodes) {
    await provider.writeEpisode(ctx, ep);
  }

  const skill = store.list("tenant_1")[0];
  const action = {
    action_id: "act_test2",
    action_type: "respond",
    title: "Respond action"
  };
  const result = await provider.execute(ctx, skill.skill_id, action);
  assert.equal(result, null);
});

test("ProceduralMemoryProvider getDigest returns procedural digests", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));

  const digests = await provider.getDigest(ctx);
  assert.ok(digests.length > 0);
  assert.equal(digests[0].memory_type, "procedural");
});

test("ProceduralMemoryProvider deleteSession removes accumulated session episodes", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));

  provider.deleteSession("ses_1");

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));
  assert.equal(store.list("tenant_1").length, 0);

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep4" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep5" }));
  assert.equal(store.list("tenant_1").length, 1);
});

test("ProceduralMemoryProvider deleteSession also removes promoted skills when threshold is no longer met", async () => {
  const store = new InMemorySkillStore();
  const provider = new ProceduralMemoryProvider(store, 3);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep1" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep2" }));
  await provider.writeEpisode(ctx, makeEpisode({ episode_id: "ep3" }));
  assert.equal(store.list("tenant_1").length, 1);

  provider.deleteSession("ses_1");
  assert.equal(store.list("tenant_1").length, 0);
});

test("AgentRuntime restoreSession rebuilds procedural memory accumulation from checkpoint episodes", async () => {
  const store = new InMemorySkillStore();

  const reasoner = {
    name: "restore-procedural-reasoner",
    async plan() { return []; },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Answer directly",
        description: "Answer directly",
        side_effect_level: "none"
      }];
    }
  };

  const seedRuntime = new AgentRuntime({ reasoner, skillStore: store });
  const runtime = new AgentRuntime({ reasoner, skillStore: store });
  const profile = {
    agent_id: "restore-procedural-agent",
    schema_version: "1.0.0",
    name: "Restore Procedural Agent",
    version: "1.0.0",
    role: "assistant",
    mode: "runtime",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    runtime_config: { max_cycles: 3 }
  };

  const session = seedRuntime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_restore",
    initial_input: { content: "restore checkpoint" }
  });

  const checkpoint = {
    checkpoint_id: gid("chk"),
    session: {
      ...session,
      state: "suspended",
      checkpoint_ref: undefined
    },
    goals: seedRuntime.listGoals(session.session_id),
    working_memory: [],
    episodes: [
      makeEpisode({
        episode_id: "restore_ep_1",
        session_id: session.session_id,
        selected_strategy: "Answer directly",
        metadata: { action_type: "respond" }
      }),
      makeEpisode({
        episode_id: "restore_ep_2",
        session_id: session.session_id,
        selected_strategy: "Answer directly",
        metadata: { action_type: "respond" }
      })
    ],
    traces: [],
    created_at: ts()
  };

  runtime.restoreSession(checkpoint);

  await runtime.runOnce(profile, session.session_id, {
    input_id: gid("inp"),
    content: "continue after restore",
    created_at: ts()
  });

  assert.equal(store.list("tenant_restore").length, 1);
});

test("AgentRuntime restoreSession restores procedural skills from checkpoint snapshot", async () => {
  const store = new InMemorySkillStore();

  const reasoner = {
    name: "restore-procedural-snapshot-reasoner",
    async plan() { return []; },
    async respond() { return []; }
  };

  const seedRuntime = new AgentRuntime({ reasoner, skillStore: store });
  const runtime = new AgentRuntime({ reasoner, skillStore: store });
  const profile = {
    agent_id: "restore-procedural-snapshot-agent",
    schema_version: "1.0.0",
    name: "Restore Procedural Snapshot Agent",
    version: "1.0.0",
    role: "assistant",
    mode: "runtime",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    runtime_config: { max_cycles: 3 }
  };

  const session = seedRuntime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_restore_snapshot",
    initial_input: { content: "restore checkpoint with procedural snapshot" }
  });

  const checkpoint = {
    checkpoint_id: gid("chk"),
    session: {
      ...session,
      state: "suspended",
      checkpoint_ref: undefined
    },
    goals: seedRuntime.listGoals(session.session_id),
    working_memory: [],
    episodes: [],
    procedural_memory: {
      skills: [{
        skill_id: "skl_restore_1",
        schema_version: "1.0.0",
        name: "fetch_data:call_tool_fetch_data",
        version: "1.0.0",
        kind: "toolchain_skill",
        trigger_conditions: [
          { field: "tool_name", operator: "eq", value: "fetch_data" },
          { field: "action_type", operator: "eq", value: "call_tool" }
        ],
        execution_template: { kind: "toolchain", steps: ["Call tool: fetch_data"] },
        metadata: {
          tenant_id: "tenant_restore_snapshot",
          pattern_key: "fetch_data:call_tool_fetch_data",
          source_episode_ids: ["historic_ep_1", "historic_ep_2", "historic_ep_3"]
        }
      }]
    },
    traces: [],
    created_at: ts()
  };

  runtime.restoreSession(checkpoint);

  const proposals = await runtime.getSkillProvider().match(makeCtx({
    tenant_id: "tenant_restore_snapshot",
    session: {
      ...session,
      tenant_id: "tenant_restore_snapshot"
    },
    runtime_state: {
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    }
  }));

  assert.equal(store.list("tenant_restore_snapshot").length, 1);
  assert.equal(proposals.length, 1);
});

test("persisted runtime session restores procedural skills from snapshot on restart", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-procedural-snapshot-"));
  try {
    const seedStore = new InMemorySkillStore();
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const reasoner = {
      name: "persisted-procedural-snapshot-reasoner",
      async plan() { return []; },
      async respond() { return []; }
    };
    const profile = {
      agent_id: "persisted-procedural-snapshot-agent",
      schema_version: "1.0.0",
      name: "Persisted Procedural Snapshot Agent",
      version: "1.0.0",
      role: "assistant",
      mode: "runtime",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: {
        working_memory_enabled: true,
        episodic_memory_enabled: true,
        semantic_memory_enabled: true,
        procedural_memory_enabled: true,
        write_policy: "immediate"
      },
      runtime_config: { max_cycles: 3 }
    };

    const seedRuntime = new AgentRuntime({ reasoner, skillStore: seedStore, stateStore });
    const seedSession = seedRuntime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_persisted_snapshot",
      initial_input: { content: "seed persisted skill snapshot" }
    });

    const provider = seedRuntime.getSkillProvider();
    const ctx = makeCtx({
      tenant_id: "tenant_persisted_snapshot",
      session: {
        ...seedSession,
        tenant_id: "tenant_persisted_snapshot"
      }
    });
    await provider.writeEpisode(ctx, makeEpisode({
      episode_id: "persist_ep_1",
      session_id: seedSession.session_id
    }));
    await provider.writeEpisode(ctx, makeEpisode({
      episode_id: "persist_ep_2",
      session_id: seedSession.session_id
    }));
    await provider.writeEpisode(ctx, makeEpisode({
      episode_id: "persist_ep_3",
      session_id: seedSession.session_id
    }));
    seedRuntime.createCheckpoint(seedSession.session_id);

    const restoredStore = new InMemorySkillStore();
    const restoredRuntime = new AgentRuntime({
      reasoner,
      skillStore: restoredStore,
      stateStore: new FileRuntimeStateStore({ directory: stateDir })
    });

    const restoredSession = restoredRuntime.getSession(seedSession.session_id);
    assert.ok(restoredSession);
    assert.equal(restoredStore.list("tenant_persisted_snapshot").length, 1);

    const proposals = await restoredRuntime.getSkillProvider().match(makeCtx({
      tenant_id: "tenant_persisted_snapshot",
      session: {
        ...restoredSession,
        tenant_id: "tenant_persisted_snapshot"
      },
      runtime_state: {
        current_input_metadata: {
          sourceToolName: "fetch_data",
          sourceActionType: "call_tool"
        }
      }
    }));

    assert.equal(proposals.length, 1);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("E2E: matched toolchain skill synthesizes and executes tool action without reasoner action", async () => {
  const store = new InMemorySkillStore();
  store.save({
    skill_id: "skl_fetch_1",
    schema_version: "1.0.0",
    name: "fetch_data:call_tool_fetch_data",
    version: "1.0.0",
    kind: "toolchain_skill",
    trigger_conditions: [
      { field: "tool_name", operator: "eq", value: "fetch_data" },
      { field: "action_type", operator: "eq", value: "call_tool" }
    ],
    execution_template: {
      kind: "toolchain",
      steps: ["Call tool: fetch_data"],
      tool_name: "fetch_data",
      action_type: "call_tool",
      default_args: { query: "from_skill" }
    },
    risk_level: "low",
    metadata: {
      tenant_id: "tenant_skill_action",
      pattern_key: "fetch_data:call_tool_fetch_data",
      source_episode_ids: ["ep_hist_1", "ep_hist_2", "ep_hist_3"]
    }
  });

  const reasoner = {
    name: "skill-only-reasoner",
    async plan() { return []; },
    async respond() { return []; }
  };

  const runtime = new AgentRuntime({ reasoner, skillStore: store });
  runtime.tools.register({
    name: "fetch_data",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    },
    async invoke(input) {
      return { summary: `fetched:${input.query}` };
    }
  });

  const profile = {
    agent_id: "skill-only-agent",
    schema_version: "1.0.0",
    name: "Skill Only Agent",
    version: "1.0.0",
    role: "assistant",
    mode: "runtime",
    tool_refs: ["ping"],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    runtime_config: { max_cycles: 3 }
  };

  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_skill_action",
    initial_input: { content: "run ping skill" }
  });

  const result = await runtime.runOnce(profile, session.session_id, {
    input_id: gid("inp"),
    content: "run fetch skill",
    created_at: ts(),
    metadata: {
      sourceToolName: "fetch_data",
      sourceActionType: "call_tool"
    }
  });

  assert.equal(result.selectedAction?.action_type, "call_tool");
  assert.equal(result.selectedAction?.tool_name, "fetch_data");
  assert.deepEqual(result.selectedAction?.tool_args, { query: "from_skill" });
  assert.ok(result.selectedAction?.source_proposal_id);
  assert.equal(result.actionExecution?.executor, "tool_gateway");
  assert.equal(result.observation?.status, "success");
  assert.equal(result.observation?.summary, "fetched:from_skill");
  assert.deepEqual(result.observation?.structured_payload?.tool_args, { query: "from_skill" });
  assert.equal(result.observation?.structured_payload?.skill_id, "skl_fetch_1");

  const skillEvents = runtime
    .listEvents(session.session_id)
    .filter((event) => event.event_type === "skill.executed");
  assert.equal(skillEvents.length, 1);
});

test("E2E: skill promotion via AgentRuntime after 3 successful tool calls", async () => {
  const store = new InMemorySkillStore();

  const reasoner = {
    name: "test-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "test-reasoner",
        proposal_type: "plan",
        salience_score: 0.9,
        payload: { summary: "Call fetch_data" }
      }];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (currentInput.startsWith("Tool observation:")) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Call fetch_data",
          description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
          side_effect_level: "none"
        }];
      }

      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Call fetch_data",
        tool_name: "fetch_data",
        tool_args: { query: "test" },
        side_effect_level: "none"
      }];
    }
  };

  const profile = {
    agent_id: "skill-e2e-agent",
    schema_version: "1.0.0",
    name: "Skill E2E Agent",
    version: "1.0.0",
    role: "assistant",
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
    runtime_config: { max_cycles: 10 }
  };

  const runtime = new AgentRuntime({ reasoner, skillStore: store });
  runtime.tools.register({
    name: "fetch_data",
    sideEffectLevel: "none",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    async invoke() {
      return { summary: "Data fetched successfully" };
    }
  });

  let lastSessionId;
  for (let round = 0; round < 3; round++) {
    const session = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "t_e2e",
      initial_input: { content: `fetch data round ${round + 1}` }
    });
    lastSessionId = session.session_id;

    await runtime.runUntilSettled(
      profile,
      session.session_id,
      { input_id: gid("inp"), content: `fetch data round ${round + 1}`, created_at: ts() }
    );
  }

  assert.equal(store.list("t_e2e").length, 1, "Skill should be promoted after 3 successful episodes");

  const events = runtime.listEvents(lastSessionId);
  const promotedEvents = events.filter((e) => e.event_type === "skill.promoted");
  assert.ok(promotedEvents.length > 0, "skill.promoted event should be emitted");

  const skill = store.list("t_e2e")[0];
  assert.ok(skill.kind === "toolchain_skill" || skill.kind === "reasoning_skill");
  assert.ok(skill.metadata.source_episode_ids.length >= 3);
  assert.ok(skill.metadata.compiled_at);
  assert.ok(skill.metadata.pattern_key);
});

test("E2E: skill trace records and defineAgent integration", async () => {
  const store = new InMemorySkillStore();

  const agent = defineAgent({
    id: "skill-trace-agent",
    role: "assistant"
  })
    .useReasoner({
      name: "test-reasoner",
      async plan() { return []; },
      async respond(ctx) {
        const currentInput =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";

        if (currentInput.startsWith("Tool observation:")) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return observation",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }];
        }

        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call fetch_data",
          tool_name: "fetch_data",
          tool_args: { query: "trace-test" },
          side_effect_level: "none"
        }];
      }
    })
    .registerTool({
      name: "fetch_data",
      sideEffectLevel: "none",
      inputSchema: { type: "object" },
      async invoke() {
        return { summary: "Trace data fetched" };
      }
    })
    .configureMemory({
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    })
    .configureRuntime({ max_cycles: 5 });

  const session = agent.createSession({
    agent_id: "skill-trace-agent",
    tenant_id: "t_trace",
    initial_input: { content: "trace test 1" }
  });

  const result = await session.run();

  const traces = session.getTraces();
  assert.ok(traces.length >= 1, "Should have at least one trace record");

  const traceRecords = session.getTraceRecords();
  assert.ok(traceRecords.length >= 1, "Should have trace records");
});
