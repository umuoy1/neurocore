import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EpisodicMemoryProvider,
  SemanticMemoryProvider,
  WorkingMemoryProvider
} from "@neurocore/memory-core";
import { AgentRuntime, CycleEngine, DefaultMetaController, FileRuntimeStateStore } from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

let idCounter = 0;
function gid(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function makeProfile(memoryConfig = {}) {
  return {
    agent_id: "memory-test-agent",
    schema_version: "1.0.0",
    name: "Memory Test Agent",
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
      write_policy: "immediate",
      ...memoryConfig
    },
    runtime_config: { max_cycles: 3 }
  };
}

function makeSession() {
  return {
    session_id: "ses_memory",
    schema_version: "1.0.0",
    tenant_id: "tenant_memory",
    agent_id: "memory-test-agent",
    state: "running",
    session_mode: "sync",
    goal_tree_ref: "goal_tree_memory",
    budget_state: {},
    policy_state: {}
  };
}

function makeCtx(memoryConfig = {}) {
  return {
    tenant_id: "tenant_memory",
    session: makeSession(),
    profile: makeProfile(memoryConfig),
    goals: [],
    runtime_state: {},
    services: {
      now: () => ts(),
      generateId: (prefix) => gid(prefix)
    },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate",
      ...memoryConfig
    }
  };
}

function makeEpisode(overrides = {}) {
  return {
    episode_id: gid("epi"),
    schema_version: "1.0.0",
    session_id: "ses_memory",
    trigger_summary: "memory input",
    goal_refs: [],
    context_digest: "memory context",
    selected_strategy: "Call tool: fetch_data",
    action_refs: ["act_1"],
    observation_refs: ["obs_1"],
    outcome: "success",
    outcome_summary: "memory success",
    created_at: ts(),
    metadata: {
      action_type: "call_tool",
      tool_name: "fetch_data"
    },
    ...overrides
  };
}

test("WorkingMemoryProvider respects working_memory_enabled flag", async () => {
  const provider = new WorkingMemoryProvider();
  provider.append("ses_memory", {
    memory_id: "mem_1",
    summary: "working entry",
    relevance: 1
  });

  const ctx = makeCtx({ working_memory_enabled: false });
  assert.deepEqual(await provider.getDigest(ctx), []);
  assert.deepEqual(await provider.retrieve(ctx), []);
});

test("WorkingMemoryProvider appendObservation respects runtime maxEntries override", () => {
  const provider = new WorkingMemoryProvider();

  for (let index = 1; index <= 8; index += 1) {
    provider.appendObservation(
      "ses_memory",
      {
        observation_id: `obs_${index}`,
        session_id: "ses_memory",
        cycle_id: `cyc_${index}`,
        source_action_id: `act_${index}`,
        source_type: "runtime",
        status: "success",
        summary: `observation ${index}`,
        created_at: ts()
      },
      4
    );
  }

  const entries = provider.list("ses_memory");
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((entry) => entry.memory_id),
    ["obs_5", "obs_6", "obs_7", "obs_8"]
  );
});

test("AgentRuntime respects memory_config.working_memory_max_entries", async () => {
  const reasoner = {
    name: "working-memory-cap-reasoner",
    async plan() { return []; },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "ask_user",
        title: "Need more input",
        description: "Need more input",
        side_effect_level: "none"
      }];
    }
  };
  const runtime = new AgentRuntime({ reasoner });
  const profile = makeProfile({
    working_memory_max_entries: 2
  });
  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_memory",
    initial_input: { content: "working memory cap" }
  });

  for (let index = 1; index <= 4; index += 1) {
    await runtime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: `working memory cap ${index}`,
      created_at: ts()
    });
  }

  const entries = runtime.getWorkingMemory(session.session_id);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.summary),
    ["Need more input", "Need more input"]
  );
});

test("EpisodicMemoryProvider respects episodic_memory_enabled flag", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = makeCtx({ episodic_memory_enabled: false });

  await provider.writeEpisode(ctx, makeEpisode());

  assert.deepEqual(provider.list("ses_memory"), []);
  assert.deepEqual(await provider.getDigest(ctx), []);
  assert.deepEqual(await provider.retrieve(ctx), []);
});

test("SemanticMemoryProvider respects semantic_memory_enabled flag", async () => {
  const provider = new SemanticMemoryProvider();
  const ctx = makeCtx({ semantic_memory_enabled: false });

  await provider.writeEpisode(ctx, makeEpisode());

  assert.deepEqual(await provider.getDigest(ctx), []);
  assert.deepEqual(await provider.retrieve(ctx), []);
});

test("CycleEngine filters non-memory proposals from memory providers", async () => {
  const engine = new CycleEngine();
  const profile = makeProfile();
  const session = makeSession();

  const result = await engine.run({
    tenantId: session.tenant_id,
    session,
    profile,
    input: {
      input_id: gid("inp"),
      content: "memory filter test",
      created_at: ts()
    },
    goals: [],
    reasoner: {
      name: "memory-filter-reasoner",
      async plan() {
        return [];
      },
      async respond() {
        return [{
          action_id: gid("act"),
          action_type: "respond",
          title: "Respond",
          description: "Respond",
          side_effect_level: "none"
        }];
      }
    },
    metaController: new DefaultMetaController(),
    memoryProviders: [{
      name: "bad-memory-provider",
      async retrieve(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id,
          module_name: "bad-memory-provider",
          proposal_type: "skill_match",
          salience_score: 0.9,
          payload: { skill_id: "skl_1" }
        }];
      },
      async getDigest() {
        return [];
      },
      async writeEpisode() {}
    }]
  });

  assert.equal(
    result.proposals.some((proposal) => proposal.module_name === "bad-memory-provider"),
    false
  );
});

test("EpisodicMemoryProvider returns most recent episodes by created_at, not append order", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = makeCtx({ retrieval_top_k: 2 });

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_old",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "old"
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_newest",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "newest"
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_mid",
      created_at: "2026-04-02T00:00:00.000Z",
      outcome_summary: "mid"
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  const episodeIds = proposal.payload.episodes.map((episode) => episode.episode_id);
  assert.deepEqual(episodeIds, ["ep_newest", "ep_mid"]);
});

test("EpisodicMemoryProvider prefers input-relevant episodes over newer but unrelated ones", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "tool observation for fetch_data failure",
      current_input_metadata: {
        sourceToolName: "fetch_data",
        sourceActionType: "call_tool"
      }
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_relevant",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "fetch_data handled well",
      metadata: {
        action_type: "call_tool",
        tool_name: "fetch_data"
      }
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_unrelated_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "other tool handled",
      metadata: {
        action_type: "call_tool",
        tool_name: "other_tool"
      }
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_relevant");
});

test("SemanticMemoryProvider keeps latest summary by created_at across repeated pattern episodes", async () => {
  const provider = new SemanticMemoryProvider();

  await provider.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_newer",
      session_id: "ses_sem_1",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "newer summary"
    })
  );
  await provider.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_older",
      session_id: "ses_sem_2",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "older summary"
    })
  );

  const [proposal] = await provider.retrieve({
    ...makeCtx(),
    session: {
      ...makeSession(),
      session_id: "ses_sem_query"
    }
  });

  assert.equal(proposal.payload.records[0].summary, "newer summary");
});

test("SemanticMemoryProvider prefers input-relevant pattern over higher-recency unrelated pattern", async () => {
  const provider = new SemanticMemoryProvider();

  await provider.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_fetch_1",
      session_id: "sem_fetch_session_1",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "fetch_data stable"
    })
  );
  await provider.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_fetch_2",
      session_id: "sem_fetch_session_2",
      created_at: "2026-04-02T00:00:00.000Z",
      outcome_summary: "fetch_data still stable"
    })
  );

  await provider.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_other_1",
      session_id: "sem_other_session_1",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "other tool stable",
      metadata: {
        action_type: "call_tool",
        tool_name: "other_tool"
      },
      selected_strategy: "Call tool: other_tool"
    })
  );
  await provider.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_other_2",
      session_id: "sem_other_session_2",
      created_at: "2026-04-04T00:00:00.000Z",
      outcome_summary: "other tool still stable",
      metadata: {
        action_type: "call_tool",
        tool_name: "other_tool"
      },
      selected_strategy: "Call tool: other_tool"
    })
  );

  const [proposal] = await provider.retrieve({
    ...makeCtx(),
    session: {
      ...makeSession(),
      session_id: "sem_query"
    },
    runtime_state: {
      current_input_content: "fetch_data request",
      current_input_metadata: {
        sourceToolName: "fetch_data"
      }
    }
  });

  assert.equal(proposal.payload.records[0].memory_id, "sem_fetch_data:call_tool_fetch_data");
});

test("SemanticMemoryProvider restores semantic contributions from snapshot without raw episodes", async () => {
  const source = new SemanticMemoryProvider();
  const restored = new SemanticMemoryProvider();

  await source.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_snap_1",
      session_id: "sem_snap_session_1",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "fetch_data stable"
    })
  );
  await source.writeEpisode(
    makeCtx(),
    makeEpisode({
      episode_id: "sem_snap_2",
      session_id: "sem_snap_session_1",
      created_at: "2026-04-02T00:00:00.000Z",
      outcome_summary: "fetch_data still stable"
    })
  );

  restored.restoreSnapshot(
    "sem_snap_session_1",
    "tenant_memory",
    source.buildSnapshot("sem_snap_session_1")
  );

  const [proposal] = await restored.retrieve({
    ...makeCtx(),
    session: {
      ...makeSession(),
      session_id: "sem_snap_query"
    },
    runtime_state: {
      current_input_content: "fetch_data request",
      current_input_metadata: {
        sourceToolName: "fetch_data"
      }
    }
  });

  assert.equal(proposal.payload.records[0].memory_id, "sem_fetch_data:call_tool_fetch_data");
  assert.equal(proposal.payload.records[0].summary, "fetch_data still stable");
});

test("persisted runtime session restores semantic snapshot on restart", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-semantic-snapshot-"));
  try {
    const reasoner = {
      name: "semantic-snapshot-reasoner",
      async plan() { return []; },
      async respond() { return []; }
    };
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const runtime = new AgentRuntime({ reasoner, stateStore });
    const profile = makeProfile();

    const sessionA = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "semantic seed A" }
    });
    const sessionB = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "semantic query B" }
    });

    const semantic = runtime.getSemanticMemoryProvider();
    await semantic.writeEpisode(
      {
        ...makeCtx(),
        session: {
          ...makeSession(),
          session_id: sessionA.session_id
        }
      },
      makeEpisode({
        episode_id: "sem_rt_1",
        session_id: sessionA.session_id,
        created_at: "2026-04-01T00:00:00.000Z",
        outcome_summary: "fetch_data stable"
      })
    );
    await semantic.writeEpisode(
      {
        ...makeCtx(),
        session: {
          ...makeSession(),
          session_id: sessionA.session_id
        }
      },
      makeEpisode({
        episode_id: "sem_rt_2",
        session_id: sessionA.session_id,
        created_at: "2026-04-02T00:00:00.000Z",
        outcome_summary: "fetch_data still stable"
      })
    );
    runtime.createCheckpoint(sessionA.session_id);
    runtime.createCheckpoint(sessionB.session_id);

    const restoredRuntime = new AgentRuntime({
      reasoner,
      stateStore: new FileRuntimeStateStore({ directory: stateDir })
    });

    assert.ok(restoredRuntime.getSession(sessionA.session_id));
    assert.ok(restoredRuntime.getSession(sessionB.session_id));

    const [proposal] = await restoredRuntime.getSemanticMemoryProvider().retrieve({
      ...makeCtx(),
      session: {
        ...makeSession(),
        session_id: sessionB.session_id
      },
      runtime_state: {
        current_input_content: "fetch_data request",
        current_input_metadata: {
          sourceToolName: "fetch_data"
        }
      }
    });

    assert.equal(proposal.payload.records[0].memory_id, "sem_fetch_data:call_tool_fetch_data");
    assert.equal(proposal.payload.records[0].summary, "fetch_data still stable");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("Memory providers are isolated per instance instead of sharing process-global state", async () => {
  const episodicA = new EpisodicMemoryProvider();
  const episodicB = new EpisodicMemoryProvider();
  const semanticA = new SemanticMemoryProvider();
  const semanticB = new SemanticMemoryProvider();

  await episodicA.writeEpisode(makeCtx(), makeEpisode({ episode_id: "iso_epi" }));
  await semanticA.writeEpisode(
    makeCtx(),
    makeEpisode({ episode_id: "iso_sem_1", session_id: "ses_iso_1" })
  );
  await semanticA.writeEpisode(
    makeCtx(),
    makeEpisode({ episode_id: "iso_sem_2", session_id: "ses_iso_2" })
  );

  assert.equal(episodicA.list("ses_memory").length, 1);
  assert.equal(episodicB.list("ses_memory").length, 0);

  const semanticDigest = await semanticB.getDigest({
    ...makeCtx(),
    session: {
      ...makeSession(),
      session_id: "ses_iso_query"
    }
  });
  assert.deepEqual(semanticDigest, []);
});
