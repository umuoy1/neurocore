import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EpisodicMemoryProvider,
  EpisodicMemoryStore,
  SqliteEpisodicMemoryStore,
  SqliteSemanticMemoryStore,
  SqliteWorkingMemoryStore,
  SemanticMemoryProvider,
  WorkingMemoryProvider
} from "@neurocore/memory-core";
import {
  AgentRuntime,
  SqliteCheckpointStore,
  SqliteRuntimeStateStore,
  createSqliteMemoryPersistence,
  CycleEngine,
  DefaultMetaController,
  FileRuntimeStateStore,
  migrateFileRuntimeStateToSqlFirst,
  migrateSqliteRuntimeStateToSqlFirst
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

function makeCheckpoint(overrides = {}) {
  return {
    checkpoint_id: gid("chk"),
    session: makeSession(),
    goals: [],
    traces: [],
    created_at: ts(),
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

test("WorkingMemoryProvider mirrors writes, replace, and delete into SQLite store", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-working-dual-write-"));
  try {
    const sqliteStore = new SqliteWorkingMemoryStore({
      filename: join(stateDir, "memory.db"),
      maxEntries: 2
    });
    const provider = new WorkingMemoryProvider(2, sqliteStore);

    provider.appendObservation(
      "ses_memory",
      {
        observation_id: "obs_1",
        session_id: "ses_memory",
        cycle_id: "cyc_1",
        source_action_id: "act_1",
        source_type: "runtime",
        status: "success",
        summary: "first",
        created_at: ts()
      }
    );
    provider.appendObservation(
      "ses_memory",
      {
        observation_id: "obs_2",
        session_id: "ses_memory",
        cycle_id: "cyc_2",
        source_action_id: "act_2",
        source_type: "runtime",
        status: "success",
        summary: "second",
        created_at: ts()
      }
    );
    provider.appendObservation(
      "ses_memory",
      {
        observation_id: "obs_3",
        session_id: "ses_memory",
        cycle_id: "cyc_3",
        source_action_id: "act_3",
        source_type: "runtime",
        status: "success",
        summary: "third",
        created_at: ts()
      }
    );

    assert.deepEqual(
      sqliteStore.list("ses_memory").map((entry) => entry.memory_id),
      ["obs_2", "obs_3"]
    );

    provider.replace("ses_memory", [
      { memory_id: "obs_reset", summary: "reset", relevance: 1 }
    ]);
    assert.deepEqual(
      sqliteStore.list("ses_memory").map((entry) => entry.memory_id),
      ["obs_reset"]
    );

    provider.deleteSession("ses_memory");
    assert.deepEqual(sqliteStore.list("ses_memory"), []);
    sqliteStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("WorkingMemoryProvider reads from SQLite persistence when a fresh provider reuses the same store", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-working-sql-read-"));
  try {
    const sqliteStore = new SqliteWorkingMemoryStore({
      filename: join(stateDir, "memory.db"),
      maxEntries: 4
    });
    const writer = new WorkingMemoryProvider(4, sqliteStore);
    writer.append("ses_memory", {
      memory_id: "mem_sql",
      summary: "sql-backed",
      relevance: 1
    });

    const reader = new WorkingMemoryProvider(4, sqliteStore);
    assert.deepEqual(
      reader.list("ses_memory").map((entry) => entry.memory_id),
      ["mem_sql"]
    );
    sqliteStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("WorkingMemoryProvider prunes expired entries from memory and SQLite stores", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-working-ttl-"));
  try {
    const sqliteStore = new SqliteWorkingMemoryStore({
      filename: join(stateDir, "memory.db"),
      maxEntries: 8
    });
    const provider = new WorkingMemoryProvider(8, sqliteStore);

    provider.append("ses_memory", {
      memory_id: "mem_expired",
      summary: "expired entry",
      relevance: 0.5,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T00:00:01.000Z"
    });
    provider.append("ses_memory", {
      memory_id: "mem_live",
      summary: "live entry",
      relevance: 1
    });

    assert.deepEqual(
      provider.list("ses_memory").map((entry) => entry.memory_id),
      ["mem_live"]
    );
    assert.deepEqual(
      sqliteStore.list("ses_memory").map((entry) => entry.memory_id),
      ["mem_live"]
    );
    sqliteStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
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
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
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

test("AgentRuntime mirrors working and episodic writes into configured SQLite memory persistence", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-runtime-memory-persistence-"));
  try {
    const memoryPersistence = createSqliteMemoryPersistence({
      filename: join(stateDir, "memory.db"),
      workingMaxEntries: 4
    });
    const reasoner = {
      name: "runtime-memory-persistence-reasoner",
      async plan() { return []; },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Need more input",
          description: "Need more input",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    };
    const runtime = new AgentRuntime({ reasoner, memoryPersistence });
    const profile = makeProfile();
    const session = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "memory persistence seed" }
    });

    await runtime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "memory persistence test",
      created_at: ts()
    });

    assert.equal(memoryPersistence.working.list(session.session_id).length, 1);
    assert.equal(memoryPersistence.episodic.list(session.session_id).length, 1);

    runtime.cleanupSession(session.session_id, { force: true });

    assert.deepEqual(memoryPersistence.working.list(session.session_id), []);
    assert.deepEqual(memoryPersistence.episodic.list(session.session_id), []);
    memoryPersistence.working.close();
    memoryPersistence.episodic.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("defineAgent runtime infrastructure passes SQLite memory persistence into runtime", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-builder-memory-persistence-"));
  try {
    const memoryPersistence = createSqliteMemoryPersistence({
      filename: join(stateDir, "memory.db"),
      workingMaxEntries: 4
    });
    const agent = defineAgent({
      id: "memory-persistence-builder-agent",
      role: "Memory persistence test agent"
    })
      .useReasoner({
        name: "memory-persistence-builder-reasoner",
        async plan() { return []; },
        async respond() {
          return [{
            action_id: "act_builder",
            action_type: "ask_user",
            title: "Ask",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      })
      .useRuntimeInfrastructure({
        memoryPersistence
      });

    const session = agent.createSession({
      agent_id: "memory-persistence-builder-agent",
      tenant_id: "tenant_memory",
      initial_input: {
        content: "builder persistence seed"
      }
    });

    await session.runOnce();

    assert.equal(memoryPersistence.working.list(session.id).length, 1);
    assert.equal(memoryPersistence.episodic.list(session.id).length, 1);

    session.cleanup({ force: true });
    memoryPersistence.working.close();
    memoryPersistence.episodic.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("defineAgent runtime infrastructure passes SQLite checkpoint store into runtime", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-builder-checkpoint-store-"));
  try {
    const checkpointStore = new SqliteCheckpointStore({
      filename: join(stateDir, "runtime.db")
    });
    const agent = defineAgent({
      id: "checkpoint-store-builder-agent",
      role: "Checkpoint store test agent"
    })
      .useReasoner({
        name: "checkpoint-store-builder-reasoner",
        async plan() { return []; },
        async respond() {
          return [{
            action_id: "act_builder_cp",
            action_type: "ask_user",
            title: "Ask",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      })
      .useRuntimeInfrastructure({
        checkpointStore
      });

    const session = agent.createSession({
      agent_id: "checkpoint-store-builder-agent",
      tenant_id: "tenant_memory",
      initial_input: {
        content: "builder checkpoint seed"
      }
    });

    await session.runOnce();
    const checkpoint = session.checkpoint();

    const checkpoints = checkpointStore.list(session.id);
    assert.ok(checkpoints.length >= 1);
    assert.equal(
      checkpointStore.get(checkpoint.checkpoint_id)?.checkpoint_id,
      checkpoint.checkpoint_id
    );

    session.cleanup({ force: true });
    checkpointStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("defineAgent defaults to SQL-first persistence when no runtime persistence is configured", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-default-sql-first-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(stateDir);

    const agent = defineAgent({
      id: "default-sql-first-agent",
      role: "Default SQL-first persistence test agent"
    }).useReasoner({
      name: "default-sql-first-reasoner",
      async plan() { return []; },
      async respond() {
        return [{
          action_id: "act_default_sql",
          action_type: "ask_user",
          title: "Ask",
          description: "Need more input",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });

    const session = agent.createSession({
      agent_id: "default-sql-first-agent",
      tenant_id: "tenant_memory",
      initial_input: {
        content: "default sql persistence seed"
      }
    });

    await session.runOnce();
    const checkpoint = session.checkpoint();

    const dbPath = join(stateDir, ".neurocore", "runtime", "default-sql-first-agent.sqlite");
    assert.equal(existsSync(dbPath), true);

    const reloadedAgent = defineAgent({
      id: "default-sql-first-agent",
      role: "Default SQL-first persistence test agent"
    }).useReasoner({
      name: "default-sql-first-reload-reasoner",
      async plan() { return []; },
      async respond() { return []; },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });

    const connected = reloadedAgent.connectSession(session.id);
    assert.equal(connected.getSession()?.session_id, session.id);
    assert.equal(connected.getEpisodes().length, 1);
    assert.ok(connected.getCheckpoints().length >= 1);
    assert.equal(
      connected.getCheckpoints().some((candidate) => candidate.checkpoint_id === checkpoint.checkpoint_id),
      true
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("defineAgent auto-derives SQL-first memory and checkpoint persistence from SqliteRuntimeStateStore", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-derived-sql-first-"));
  try {
    const filename = join(stateDir, "runtime.sqlite");
    const agent = defineAgent({
      id: "derived-sql-first-agent",
      role: "Derived SQL-first persistence test agent"
    })
      .useReasoner({
        name: "derived-sql-first-reasoner",
        async plan() { return []; },
        async respond() {
          return [{
            action_id: "act_derived_sql",
            action_type: "ask_user",
            title: "Ask",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      })
      .useRuntimeStateStore(() => new SqliteRuntimeStateStore({ filename }));

    const session = agent.createSession({
      agent_id: "derived-sql-first-agent",
      tenant_id: "tenant_memory",
      initial_input: {
        content: "derived sql persistence seed"
      }
    });

    await session.runOnce();
    const checkpoint = session.checkpoint();

    const reloadedAgent = defineAgent({
      id: "derived-sql-first-agent",
      role: "Derived SQL-first persistence test agent"
    })
      .useReasoner({
        name: "derived-sql-first-reload-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      })
      .useRuntimeStateStore(() => new SqliteRuntimeStateStore({ filename }));

    const connected = reloadedAgent.connectSession(session.id);
    assert.equal(connected.getSession()?.session_id, session.id);
    assert.equal(connected.getEpisodes().length, 1);
    assert.equal(
      connected.getCheckpoints().some((candidate) => candidate.checkpoint_id === checkpoint.checkpoint_id),
      true
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("AgentRuntime auto-derives SQL-first memory and checkpoint persistence from SqliteRuntimeStateStore", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-runtime-derived-sql-first-"));
  try {
    const filename = join(stateDir, "runtime.sqlite");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    const reasoner = {
      name: "runtime-derived-sql-first-reasoner",
      async plan() { return []; },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Need more input",
          description: "Need more input",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    };
    const runtime = new AgentRuntime({ reasoner, stateStore });
    const profile = makeProfile();
    const session = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "runtime derived sql seed" }
    });

    await runtime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "runtime derived sql round",
      created_at: ts()
    });
    const checkpoint = runtime.createCheckpoint(session.session_id);

    const snapshot = stateStore.getSession(session.session_id);
    assert.equal(snapshot.working_memory, undefined);
    assert.equal(snapshot.episodes, undefined);
    assert.equal(snapshot.semantic_memory, undefined);
    assert.equal(snapshot.procedural_memory, undefined);
    assert.equal(snapshot.checkpoints, undefined);

    const restoredRuntime = new AgentRuntime({
      reasoner: {
        name: "runtime-derived-sql-first-read-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore: new SqliteRuntimeStateStore({ filename })
    });

    assert.equal(restoredRuntime.getSession(session.session_id)?.session_id, session.session_id);
    assert.equal(restoredRuntime.getEpisodes(session.session_id).length, 1);
    assert.equal(
      restoredRuntime.listCheckpoints(session.session_id).some(
        (candidate) => candidate.checkpoint_id === checkpoint.checkpoint_id
      ),
      true
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("AgentRuntime rejects legacy runtime snapshot payloads until explicit migration is run", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-legacy-runtime-reject-"));
  try {
    const filename = join(stateDir, "runtime.sqlite");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    stateStore.saveSession({
      session: {
        session_id: "ses_legacy_blocked",
        schema_version: "1.0.0",
        tenant_id: "tenant_memory",
        agent_id: "memory-test-agent",
        state: "waiting",
        session_mode: "sync",
        goal_tree_ref: "goal_tree_memory",
        budget_state: {},
        policy_state: {}
      },
      goals: [],
      working_memory: [
        { memory_id: "mem_legacy_blocked", summary: "legacy blocked working", relevance: 1 }
      ],
      episodes: [
        makeEpisode({
          episode_id: "ep_legacy_blocked",
          session_id: "ses_legacy_blocked",
          outcome_summary: "legacy blocked episodic",
          created_at: "2026-04-01T00:00:00.000Z"
        })
      ],
      trace_records: [],
      approvals: [],
      pending_approvals: [],
      checkpoints: [
        makeCheckpoint({
          checkpoint_id: "chk_legacy_blocked",
          session: {
            ...makeSession(),
            session_id: "ses_legacy_blocked"
          }
        })
      ]
    });

    const runtime = new AgentRuntime({
      reasoner: {
        name: "legacy-runtime-reject-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore: new SqliteRuntimeStateStore({ filename }),
      memoryPersistence: createSqliteMemoryPersistence({ filename }),
      checkpointStore: new SqliteCheckpointStore({ filename })
    });

    assert.throws(
      () => runtime.getSession("ses_legacy_blocked"),
      /migrateSqliteRuntimeStateToSqlFirst/
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("explicit SQL runtime migration backfills legacy memory and checkpoints, then runtime restores normally", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-explicit-runtime-migration-"));
  try {
    const filename = join(stateDir, "runtime.sqlite");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    stateStore.saveSession({
      session: {
        session_id: "ses_runtime_migrated",
        schema_version: "1.0.0",
        tenant_id: "tenant_memory",
        agent_id: "memory-test-agent",
        state: "waiting",
        session_mode: "sync",
        goal_tree_ref: "goal_tree_memory",
        budget_state: {},
        policy_state: {}
      },
      goals: [],
      working_memory: [
        { memory_id: "mem_runtime_migrated", summary: "migrated working", relevance: 1 }
      ],
      episodes: [
        makeEpisode({
          episode_id: "ep_runtime_migrated",
          session_id: "ses_runtime_migrated",
          outcome_summary: "migrated episodic",
          created_at: "2026-04-02T00:00:00.000Z"
        })
      ],
      semantic_memory: {
        contributions: [
          {
            tenant_id: "tenant_memory",
            session_id: "ses_runtime_migrated",
            pattern_key: "fetch_data:call_tool_fetch_data",
            summary: "migrated semantic",
            source_episode_ids: ["ep_runtime_migrated", "ep_runtime_migrated_2"],
            last_updated_at: "2026-04-02T00:00:00.000Z"
          }
        ]
      },
      procedural_memory: {
        skills: [
          {
            skill_id: "skl_runtime_migrated",
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
              tool_name: "fetch_data",
              action_type: "call_tool"
            },
            metadata: {
              tenant_id: "tenant_memory",
              pattern_key: "fetch_data:call_tool_fetch_data",
              source_episode_ids: ["ep_runtime_migrated"]
            }
          }
        ]
      },
      trace_records: [],
      approvals: [],
      pending_approvals: [],
      checkpoints: [
        makeCheckpoint({
          checkpoint_id: "chk_runtime_migrated",
          session: {
            ...makeSession(),
            session_id: "ses_runtime_migrated"
          }
        })
      ]
    });

    const migration = migrateSqliteRuntimeStateToSqlFirst({ filename });
    assert.equal(migration.memorySessionsBackfilled, 1);
    assert.equal(migration.checkpointSessionsBackfilled, 1);

    const slimmedSnapshot = new SqliteRuntimeStateStore({ filename }).getSession("ses_runtime_migrated");
    assert.equal(slimmedSnapshot.working_memory, undefined);
    assert.equal(slimmedSnapshot.episodes, undefined);
    assert.equal(slimmedSnapshot.semantic_memory, undefined);
    assert.equal(slimmedSnapshot.procedural_memory, undefined);
    assert.equal(slimmedSnapshot.checkpoints, undefined);

    const runtime = new AgentRuntime({
      reasoner: {
        name: "runtime-migration-read-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore: new SqliteRuntimeStateStore({ filename }),
      memoryPersistence: createSqliteMemoryPersistence({ filename }),
      checkpointStore: new SqliteCheckpointStore({ filename })
    });

    assert.equal(runtime.getSession("ses_runtime_migrated")?.session_id, "ses_runtime_migrated");
    assert.deepEqual(
      runtime.getWorkingMemory("ses_runtime_migrated").map((entry) => entry.memory_id),
      ["mem_runtime_migrated"]
    );
    assert.deepEqual(
      runtime.getEpisodes("ses_runtime_migrated").map((episode) => episode.episode_id),
      ["ep_runtime_migrated"]
    );
    assert.equal(runtime.listCheckpoints("ses_runtime_migrated").length, 1);

    const [semanticProposal] = await runtime.getSemanticMemoryProvider().retrieve({
      ...makeCtx(),
      session: {
        ...makeSession(),
        session_id: "ses_runtime_query"
      },
      runtime_state: {
        current_input_content: "fetch_data request",
        current_input_metadata: {
          sourceToolName: "fetch_data"
        }
      }
    });
    assert.equal(
      semanticProposal.payload.records[0].memory_id,
      "sem_fetch_data:call_tool_fetch_data"
    );

    const skillMatches = await runtime.getSkillProvider().match({
      ...makeCtx(),
      session: {
        ...makeSession(),
        session_id: "ses_runtime_migrated"
      },
      runtime_state: {
        current_input_metadata: {
          sourceToolName: "fetch_data",
          sourceActionType: "call_tool"
        }
      }
    });
    assert.equal(skillMatches.length, 1);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("persisted runtime snapshot omits working, episodic, and semantic payloads when SQLite memory persistence is configured", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-slim-runtime-snapshot-"));
  try {
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const memoryPersistence = createSqliteMemoryPersistence({
      filename: join(stateDir, "memory.db"),
      workingMaxEntries: 4
    });
    const reasoner = {
      name: "slim-snapshot-reasoner",
      async plan() { return []; },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Need more input",
          description: "Need more input",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    };
    const runtime = new AgentRuntime({ reasoner, stateStore, memoryPersistence });
    const profile = makeProfile();
    const session = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "slim snapshot seed" }
    });

    await runtime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "slim snapshot round",
      created_at: ts()
    });

    const snapshot = stateStore.getSession(session.session_id);
    assert.equal(snapshot.working_memory, undefined);
    assert.equal(snapshot.episodes, undefined);
    assert.equal(snapshot.semantic_memory, undefined);
    assert.equal(snapshot.procedural_memory, undefined);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("persisted runtime snapshot omits checkpoints when SQLite checkpoint store is configured", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-slim-runtime-checkpoints-"));
  try {
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const checkpointStore = new SqliteCheckpointStore({
      filename: join(stateDir, "runtime.db")
    });
    const runtime = new AgentRuntime({
      reasoner: {
        name: "slim-checkpoint-snapshot-reasoner",
        async plan() { return []; },
        async respond(ctx) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need more input",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore,
      checkpointStore
    });
    const profile = makeProfile();
    const session = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "slim checkpoint snapshot seed" }
    });

    await runtime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "slim checkpoint snapshot round",
      created_at: ts()
    });
    runtime.createCheckpoint(session.session_id);

    const snapshot = stateStore.getSession(session.session_id);
    assert.equal(snapshot.checkpoints, undefined);
    assert.equal(checkpointStore.list(session.session_id).length, 1);

    checkpointStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("runtime reloads working and episodic state from SQLite memory persistence when snapshot is slim", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-slim-runtime-reload-"));
  try {
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const memoryFilename = join(stateDir, "memory.db");
    const seedRuntime = new AgentRuntime({
      reasoner: {
        name: "slim-reload-seed-reasoner",
        async plan() { return []; },
        async respond(ctx) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need more input",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore,
      memoryPersistence: createSqliteMemoryPersistence({
        filename: memoryFilename,
        workingMaxEntries: 4
      })
    });
    const profile = makeProfile();
    const session = seedRuntime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "slim reload seed" }
    });

    await seedRuntime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "slim reload round",
      created_at: ts()
    });

    const restoredRuntime = new AgentRuntime({
      reasoner: {
        name: "slim-reload-read-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore,
      memoryPersistence: createSqliteMemoryPersistence({
        filename: memoryFilename,
        workingMaxEntries: 4
      })
    });

    assert.equal(restoredRuntime.getSession(session.session_id)?.session_id, session.session_id);
    assert.equal(restoredRuntime.getWorkingMemory(session.session_id).length, 1);
    assert.equal(restoredRuntime.getEpisodes(session.session_id).length, 1);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("runtime reloads checkpoints from independent SQLite checkpoint store", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-runtime-checkpoint-reload-"));
  try {
    const runtimeFilename = join(stateDir, "runtime.db");
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const checkpointStore = new SqliteCheckpointStore({
      filename: runtimeFilename
    });
    const seedRuntime = new AgentRuntime({
      reasoner: {
        name: "checkpoint-reload-seed-reasoner",
        async plan() { return []; },
        async respond(ctx) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need more input",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore,
      checkpointStore
    });
    const profile = makeProfile();
    const session = seedRuntime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "checkpoint reload seed" }
    });

    await seedRuntime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "checkpoint reload round",
      created_at: ts()
    });
    const checkpoint = seedRuntime.createCheckpoint(session.session_id);

    const restoredCheckpointStore = new SqliteCheckpointStore({
      filename: runtimeFilename
    });
    const restoredRuntime = new AgentRuntime({
      reasoner: {
        name: "checkpoint-reload-read-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      stateStore,
      checkpointStore: restoredCheckpointStore
    });

    assert.equal(restoredRuntime.getSession(session.session_id)?.session_id, session.session_id);
    assert.equal(restoredRuntime.listCheckpoints(session.session_id).length, 1);
    assert.equal(restoredRuntime.getCheckpoint(checkpoint.checkpoint_id)?.checkpoint_id, checkpoint.checkpoint_id);

    checkpointStore.close();
    restoredCheckpointStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("checkpoint omits memory payloads when SQLite memory persistence is configured", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-slim-checkpoint-"));
  try {
    const memoryPersistence = createSqliteMemoryPersistence({
      filename: join(stateDir, "memory.db"),
      workingMaxEntries: 4
    });
    const runtime = new AgentRuntime({
      reasoner: {
        name: "slim-checkpoint-reasoner",
        async plan() { return []; },
        async respond(ctx) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need more input",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      memoryPersistence
    });
    const profile = makeProfile();
    const session = runtime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "checkpoint slim seed" }
    });

    await runtime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "checkpoint slim round",
      created_at: ts()
    });

    const checkpoint = runtime.createCheckpoint(session.session_id);
    assert.equal(checkpoint.working_memory, undefined);
    assert.equal(checkpoint.episodes, undefined);
    assert.equal(checkpoint.semantic_memory, undefined);
    assert.equal(checkpoint.procedural_memory, undefined);

    memoryPersistence.working.close();
    memoryPersistence.episodic.close();
    memoryPersistence.semantic.close();
    memoryPersistence.skillStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("restoreSession reloads state from SQLite memory persistence when checkpoint is slim", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-slim-checkpoint-restore-"));
  try {
    const memoryFilename = join(stateDir, "memory.db");
    const seedPersistence = createSqliteMemoryPersistence({
      filename: memoryFilename,
      workingMaxEntries: 4
    });
    const seedRuntime = new AgentRuntime({
      reasoner: {
        name: "slim-checkpoint-restore-seed-reasoner",
        async plan() { return []; },
        async respond(ctx) {
          return [{
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need more input",
            description: "Need more input",
            side_effect_level: "none"
          }];
        },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      memoryPersistence: seedPersistence
    });
    const profile = makeProfile();
    const session = seedRuntime.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_memory",
      initial_input: { content: "checkpoint restore seed" }
    });

    await seedRuntime.runOnce(profile, session.session_id, {
      input_id: gid("inp"),
      content: "checkpoint restore round",
      created_at: ts()
    });

    const checkpoint = seedRuntime.createCheckpoint(session.session_id);
    assert.equal(checkpoint.episodes, undefined);

    const restoredPersistence = createSqliteMemoryPersistence({
      filename: memoryFilename,
      workingMaxEntries: 4
    });
    const restoredRuntime = new AgentRuntime({
      reasoner: {
        name: "slim-checkpoint-restore-read-reasoner",
        async plan() { return []; },
        async respond() { return []; },
        async *streamText(_ctx, action) {
          yield action.description ?? action.title;
        }
      },
      memoryPersistence: restoredPersistence
    });

    restoredRuntime.restoreSession(checkpoint);
    assert.equal(restoredRuntime.getSession(session.session_id)?.session_id, session.session_id);
    assert.equal(restoredRuntime.getWorkingMemory(session.session_id).length, 1);
    assert.equal(restoredRuntime.getEpisodes(session.session_id).length, 1);

    seedPersistence.working.close();
    seedPersistence.episodic.close();
    seedPersistence.semantic.close();
    seedPersistence.skillStore.close();
    restoredPersistence.working.close();
    restoredPersistence.episodic.close();
    restoredPersistence.semantic.close();
    restoredPersistence.skillStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("createSqliteMemoryPersistence does not auto-backfill legacy runtime snapshots", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-memory-backfill-"));
  try {
    const filename = join(stateDir, "runtime.db");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    stateStore.saveSession({
      session: {
        session_id: "ses_backfill",
        schema_version: "1.0.0",
        tenant_id: "tenant_memory",
        agent_id: "memory-test-agent",
        state: "waiting",
        session_mode: "sync",
        goal_tree_ref: "goal_tree_memory",
        budget_state: {},
        policy_state: {}
      },
      goals: [],
      working_memory: [
        { memory_id: "mem_backfill_1", summary: "backfilled working", relevance: 1 }
      ],
      episodes: [
        makeEpisode({
          episode_id: "ep_backfill_1",
          session_id: "ses_backfill",
          outcome_summary: "backfilled episodic",
          created_at: "2026-04-01T00:00:00.000Z"
        }),
        makeEpisode({
          episode_id: "ep_backfill_2",
          session_id: "ses_other",
          outcome_summary: "backfilled semantic",
          created_at: "2026-04-02T00:00:00.000Z"
        })
      ],
      semantic_memory: {
        contributions: [
          {
            tenant_id: "tenant_memory",
            session_id: "ses_backfill",
            pattern_key: "fetch_data:call_tool_fetch_data",
            summary: "semantic backfill",
            source_episode_ids: ["ep_backfill_1", "ep_backfill_2"],
            last_updated_at: "2026-04-02T00:00:00.000Z"
          }
        ]
      },
      procedural_memory: {
        skills: [
          {
            skill_id: "skl_backfill_1",
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
              tool_name: "fetch_data",
              action_type: "call_tool"
            },
            metadata: {
              tenant_id: "tenant_memory",
              pattern_key: "fetch_data:call_tool_fetch_data",
              source_episode_ids: ["ep_backfill_1", "ep_backfill_2"]
            }
          }
        ]
      },
      trace_records: [],
      approvals: [],
      pending_approvals: [],
      checkpoints: []
    });

    const persistence = createSqliteMemoryPersistence({
      filename
    });
    assert.deepEqual(persistence.working.list("ses_backfill"), []);
    assert.deepEqual(persistence.episodic.list("ses_backfill"), []);
    assert.equal(persistence.semantic.list("tenant_memory").length, 0);
    assert.equal(persistence.skillStore.list("tenant_memory").length, 0);

    persistence.working.replace("ses_backfill", [
      { memory_id: "mem_sql_override", summary: "normalized override", relevance: 1 }
    ]);

    const secondPersistence = createSqliteMemoryPersistence({
      filename
    });
    assert.deepEqual(
      secondPersistence.working.list("ses_backfill").map((entry) => entry.memory_id),
      ["mem_sql_override"]
    );
    persistence.working.close();
    persistence.episodic.close();
    persistence.semantic.close();
    persistence.skillStore.close();
    secondPersistence.working.close();
    secondPersistence.episodic.close();
    secondPersistence.semantic.close();
    secondPersistence.skillStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("SqliteCheckpointStore does not auto-backfill legacy runtime snapshot checkpoints", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-checkpoint-backfill-"));
  try {
    const filename = join(stateDir, "runtime.db");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    stateStore.saveSession({
      session: {
        session_id: "ses_checkpoint_backfill",
        schema_version: "1.0.0",
        tenant_id: "tenant_memory",
        agent_id: "memory-test-agent",
        state: "waiting",
        session_mode: "sync",
        goal_tree_ref: "goal_tree_memory",
        budget_state: {},
        policy_state: {}
      },
      goals: [],
      trace_records: [],
      approvals: [],
      pending_approvals: [],
      checkpoints: [
        makeCheckpoint({
          checkpoint_id: "chk_backfill_1",
          session: {
            ...makeSession(),
            session_id: "ses_checkpoint_backfill"
          }
        })
      ]
    });

    const checkpointStore = new SqliteCheckpointStore({ filename });
    assert.equal(checkpointStore.list("ses_checkpoint_backfill").length, 0);
    checkpointStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("EpisodicMemoryProvider respects episodic_memory_enabled flag", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = makeCtx({ episodic_memory_enabled: false });

  await provider.writeEpisode(ctx, makeEpisode());

  assert.deepEqual(provider.list("ses_memory"), []);
  assert.deepEqual(await provider.getDigest(ctx), []);
  assert.deepEqual(await provider.retrieve(ctx), []);
});

test("EpisodicMemoryProvider mirrors writes, replace, and delete into SQLite store", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-episodic-dual-write-"));
  try {
    const sqliteStore = new SqliteEpisodicMemoryStore({
      filename: join(stateDir, "memory.db")
    });
    const provider = new EpisodicMemoryProvider(new EpisodicMemoryStore(), sqliteStore);

    await provider.writeEpisode(
      makeCtx(),
      makeEpisode({
        episode_id: "ep_dual_1",
        session_id: "ses_memory",
        created_at: "2026-04-01T00:00:00.000Z"
      })
    );

    assert.deepEqual(
      sqliteStore.list("ses_memory").map((episode) => episode.episode_id),
      ["ep_dual_1"]
    );

    provider.replace("ses_memory", "tenant_memory", [
      makeEpisode({
        episode_id: "ep_dual_reset",
        session_id: "ses_memory",
        created_at: "2026-04-02T00:00:00.000Z"
      })
    ]);

    assert.deepEqual(
      sqliteStore.list("ses_memory").map((episode) => episode.episode_id),
      ["ep_dual_reset"]
    );

    provider.deleteSession("ses_memory");
    assert.deepEqual(sqliteStore.list("ses_memory"), []);
    sqliteStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("EpisodicMemoryProvider reads from SQLite persistence when a fresh provider reuses the same store", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-episodic-sql-read-"));
  try {
    const sqliteStore = new SqliteEpisodicMemoryStore({
      filename: join(stateDir, "memory.db")
    });
    const writer = new EpisodicMemoryProvider(new EpisodicMemoryStore(), sqliteStore);
    await writer.writeEpisode(
      makeCtx(),
      makeEpisode({
        episode_id: "ep_sql_read",
        session_id: "ses_memory",
        created_at: "2026-04-01T00:00:00.000Z"
      })
    );

    const reader = new EpisodicMemoryProvider(new EpisodicMemoryStore(), sqliteStore);
    assert.deepEqual(
      reader.list("ses_memory").map((episode) => episode.episode_id),
      ["ep_sql_read"]
    );
    sqliteStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("SemanticMemoryProvider respects semantic_memory_enabled flag", async () => {
  const provider = new SemanticMemoryProvider();
  const ctx = makeCtx({ semantic_memory_enabled: false });

  await provider.writeEpisode(ctx, makeEpisode());

  assert.deepEqual(await provider.getDigest(ctx), []);
  assert.deepEqual(await provider.retrieve(ctx), []);
});

test("SemanticMemoryProvider reads from SQLite persistence when a fresh provider reuses the same store", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-semantic-sql-read-"));
  try {
    const sqliteStore = new SqliteSemanticMemoryStore({
      filename: join(stateDir, "memory.db")
    });
    const writer = new SemanticMemoryProvider(sqliteStore);
    await writer.writeEpisode(
      makeCtx(),
      makeEpisode({
        episode_id: "sem_sql_1",
        session_id: "sem_sql_session_1",
        outcome_summary: "fetch_data stable",
        created_at: "2026-04-01T00:00:00.000Z"
      })
    );
    await writer.writeEpisode(
      makeCtx(),
      makeEpisode({
        episode_id: "sem_sql_2",
        session_id: "sem_sql_session_2",
        outcome_summary: "fetch_data still stable",
        created_at: "2026-04-02T00:00:00.000Z"
      })
    );

    const reader = new SemanticMemoryProvider(sqliteStore);
    const [proposal] = await reader.retrieve({
      ...makeCtx(),
      session: {
        ...makeSession(),
        session_id: "sem_sql_query"
      },
      runtime_state: {
        current_input_content: "fetch_data request",
        current_input_metadata: {
          sourceToolName: "fetch_data"
        }
      }
    });

    assert.equal(proposal.payload.records[0].memory_id, "sem_fetch_data:call_tool_fetch_data");
    sqliteStore.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("SemanticMemoryProvider stores repeated failed episodes as negative patterns when enabled", async () => {
  const provider = new SemanticMemoryProvider();
  const writerCtx = makeCtx({ semantic_negative_learning_enabled: true });

  await provider.writeEpisode(writerCtx, makeEpisode({
    session_id: "ses_negative_seed",
    episode_id: "epi_negative_1",
    outcome: "failure",
    valence: "negative",
    selected_strategy: "Call tool: send_email",
    outcome_summary: "sending email without confirmation caused a failure",
    metadata: {
      action_type: "call_tool",
      tool_name: "email_send"
    }
  }));
  await provider.writeEpisode(writerCtx, makeEpisode({
    session_id: "ses_negative_seed",
    episode_id: "epi_negative_2",
    outcome: "failure",
    valence: "negative",
    selected_strategy: "Call tool: send_email",
    outcome_summary: "sending email without confirmation caused a failure",
    metadata: {
      action_type: "call_tool",
      tool_name: "email_send"
    }
  }));

  const queryCtx = {
    ...makeCtx({ semantic_negative_learning_enabled: true }),
    session: {
      ...makeSession(),
      session_id: "ses_negative_query"
    },
    runtime_state: {
      current_input_content: "please send an email",
      current_input_metadata: {
        tool_name: "email_send"
      }
    }
  };
  const [proposal] = await provider.retrieve(queryCtx);

  assert.equal(proposal.payload.records[0].valence, "negative");
  assert.match(proposal.payload.records[0].summary, /^Avoid:/);
});

test("SemanticMemoryProvider ignores failed episodes when negative learning is disabled", async () => {
  const provider = new SemanticMemoryProvider();
  const ctx = makeCtx({ semantic_negative_learning_enabled: false });

  await provider.writeEpisode(ctx, makeEpisode({
    session_id: "ses_negative_seed",
    episode_id: "epi_negative_1",
    outcome: "failure",
    valence: "negative",
    selected_strategy: "Call tool: send_email",
    outcome_summary: "sending email without confirmation caused a failure",
    metadata: {
      action_type: "call_tool",
      tool_name: "email_send"
    }
  }));
  await provider.writeEpisode(ctx, makeEpisode({
    session_id: "ses_negative_seed",
    episode_id: "epi_negative_2",
    outcome: "failure",
    valence: "negative",
    selected_strategy: "Call tool: send_email",
    outcome_summary: "sending email without confirmation caused a failure",
    metadata: {
      action_type: "call_tool",
      tool_name: "email_send"
    }
  }));

  const queryCtx = {
    ...makeCtx({ semantic_negative_learning_enabled: false }),
    session: {
      ...makeSession(),
      session_id: "ses_negative_query"
    }
  };

  assert.deepEqual(await provider.retrieve(queryCtx), []);
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
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
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

test("EpisodicMemoryProvider downranks generic request words during episodic retrieval", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "How many projects am I currently leading?"
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_project_fact",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "I am currently leading the Apollo migration project and the Billing cleanup project."
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_generic_count_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "If I use the alias name, how many paths are there from sb to td?"
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_project_fact");
});

test("EpisodicMemoryProvider favors amount-bearing memories for spending questions", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "How much money did I spend on bike expenses?"
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_bike_cost",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "I replaced my bike chain and it cost $25."
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_bike_mileage_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "I have tracked 347 bike miles since the start of the year."
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_bike_cost");
});

test("EpisodicMemoryProvider favors duration facts for time-based questions", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "How much time do I dedicate to practicing guitar every day?"
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_guitar_duration",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "I have been practicing guitar for 30 minutes daily before work."
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_guitar_gear_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "I asked about guitar amps, effects pedals, and recording gear for a jam session."
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_guitar_duration");
});

test("EpisodicMemoryProvider favors packed item facts for percentage questions", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "What percentage of packed shoes did I wear on my last trip?"
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_shoe_percentage",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "On my last trip I packed 5 pairs of shoes but only wore two pairs."
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_trip_packing_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "I made a general packing list for a five day city trip with toiletries and snacks."
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_shoe_percentage");
});

test("EpisodicMemoryProvider keeps discount percentage questions separate from packed item percentages", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "What percentage discount did I get on the book from my favorite author?"
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_book_discount",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "The new release from my favorite author was originally priced at $30, and I got the book for $24 after a discount."
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_shoe_percentage_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "On my last trip I packed 5 pairs of shoes but only wore two pairs."
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_book_discount");
});

test("EpisodicMemoryProvider bridges furniture layout questions to bedroom furniture preferences", async () => {
  const provider = new EpisodicMemoryProvider();
  const ctx = {
    ...makeCtx({ retrieval_top_k: 1 }),
    runtime_state: {
      current_input_content: "I was thinking about rearranging the furniture in my bedroom this weekend. Any tips?",
      current_input_metadata: {
        question_type: "single-session-preference"
      }
    }
  };

  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_bedroom_dresser_preference",
      created_at: "2026-04-01T00:00:00.000Z",
      outcome_summary: "I am looking for mid-century modern design inspiration for a new bedroom dresser and want the room style to match it."
    })
  );
  await provider.writeEpisode(
    ctx,
    makeEpisode({
      episode_id: "ep_bedroom_wifi_newer",
      created_at: "2026-04-03T00:00:00.000Z",
      outcome_summary: "I had issues with the Wi-Fi signal in my bedroom and fixed the router placement."
    })
  );

  const [proposal] = await provider.retrieve(ctx);
  assert.equal(proposal.payload.episodes[0].episode_id, "ep_bedroom_dresser_preference");
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

test("explicit file runtime migration backfills semantic memory, then runtime restores normally", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-semantic-file-migration-"));
  try {
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const sessionA = {
      ...makeSession(),
      session_id: "ses_semantic_file_seed",
      tenant_id: "tenant_memory",
      state: "waiting"
    };
    const sessionB = {
      ...makeSession(),
      session_id: "ses_semantic_file_query",
      tenant_id: "tenant_memory",
      state: "waiting"
    };

    stateStore.saveSession({
      session: sessionA,
      goals: [],
      trace_records: [],
      approvals: [],
      pending_approvals: [],
      semantic_memory: {
        contributions: [
          {
            tenant_id: "tenant_memory",
            session_id: sessionA.session_id,
            pattern_key: "fetch_data:call_tool_fetch_data",
            summary: "fetch_data still stable",
            source_episode_ids: ["sem_rt_1", "sem_rt_2"],
            last_updated_at: "2026-04-02T00:00:00.000Z"
          }
        ]
      }
    });
    stateStore.saveSession({
      session: sessionB,
      goals: [],
      trace_records: [],
      approvals: [],
      pending_approvals: []
    });

    const migration = migrateFileRuntimeStateToSqlFirst({
      directory: stateDir,
      filename: join(stateDir, "memory.db"),
      workingMaxEntries: 4
    });
    assert.equal(migration.memorySessionsBackfilled, 1);
    assert.equal(migration.checkpointSessionsBackfilled, 0);

    const reasoner = {
      name: "semantic-snapshot-reasoner",
      async plan() { return []; },
      async respond() { return []; },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    };

    const restoredRuntime = new AgentRuntime({
      reasoner,
      stateStore: new FileRuntimeStateStore({ directory: stateDir }),
      memoryPersistence: createSqliteMemoryPersistence({
        filename: join(stateDir, "memory.db"),
        workingMaxEntries: 4
      })
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
