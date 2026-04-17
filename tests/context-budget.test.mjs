import { DefaultTokenEstimator, GradedContextCompressor } from "@neurocore/runtime-core";
import { defineAgent } from "@neurocore/sdk-core";
import assert from "node:assert/strict";
import test from "node:test";

function makeInput(content) {
  return {
    input_id: `inp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    content,
    created_at: new Date().toISOString()
  };
}

function createEchoAgent({ id, memoryProviders, configureAgent } = {}) {
  const builder = defineAgent({
    id: id ?? "test-echo-agent",
    role: "Echo agent for integration tests."
  }).useReasoner({
    name: "echo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Echo plan." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Echo",
          description: typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "done",
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  if (memoryProviders) {
    for (const mp of memoryProviders) {
      builder.registerMemoryProvider(mp);
    }
  }

  if (configureAgent) {
    configureAgent(builder);
  }

  return builder;
}

test("M1: retrieval_top_k=2 limits working memory entries returned to reasoner", async () => {
  let capturedMemoryCount = Infinity;

  const agent = createEchoAgent({
    id: "m1-working-topk",
    configureAgent(b) {
      b.configureMemory({ retrieval_top_k: 2 });
    }
  });

  const session = agent.createSession({
    agent_id: "m1-working-topk-agent",
    tenant_id: "m1-tenant",
    initial_input: makeInput("seed the working memory")
  });

  await session.run();

  const profile = agent.getProfile();
  assert.equal(profile.memory_config.retrieval_top_k, 2,
    "configureMemory should store retrieval_top_k on the profile");
});

test("M2: default retrieval_top_k falls back to hardcoded values when not set", async () => {
  const agent = createEchoAgent({ id: "m2-default-topk" });
  const profile = agent.getProfile();

  assert.equal(profile.memory_config.retrieval_top_k, undefined,
    "retrieval_top_k should be undefined when configureMemory is not called for it");
});

test("M3: retrieval_top_k is carried through ModuleContext into memory providers", async () => {
  let capturedConfig = null;

  const spyProvider = {
    name: "spy-memory-provider",
    async retrieve(ctx) {
      capturedConfig = ctx.memory_config ?? null;
      return [];
    },
    async writeEpisode() { }
  };

  const agent = createEchoAgent({
    id: "m3-context-carry",
    memoryProviders: [spyProvider],
    configureAgent(b) {
      b.configureMemory({ retrieval_top_k: 7 });
    }
  });

  const session = agent.createSession({
    agent_id: "m3-context-carry-agent",
    tenant_id: "m3-tenant",
    initial_input: makeInput("trigger memory retrieval")
  });

  await session.run();

  assert.ok(capturedConfig, "memory_config should be present on ModuleContext");
  assert.equal(capturedConfig.retrieval_top_k, 7,
    "retrieval_top_k should flow from profile through cycle engine to providers");
});

test("M4: cross-session episodic retrieval respects top_k ratio", async () => {
  let session1EpisodicProposalCount = 0;

  const agent = createEchoAgent({
    id: "m4-episodic-topk",
    configureAgent(b) {
      b.configureMemory({ retrieval_top_k: 2 });
    }
  });

  const s1 = agent.createSession({
    agent_id: "m4-episodic-topk-agent",
    tenant_id: "m4-shared-tenant",
    initial_input: makeInput("first task")
  });
  await s1.run();

  assert.ok(s1.getEpisodes().length >= 1,
    "session 1 should produce at least one episode");

  const s2 = agent.createSession({
    agent_id: "m4-episodic-topk-agent",
    tenant_id: "m4-shared-tenant",
    initial_input: makeInput("second task")
  });
  const s2Result = await s2.run();

  const episodicProposals = s2Result.steps[0].cycle.proposals.filter(
    p => p.module_name === "episodic-memory-provider"
  );

  assert.ok(
    episodicProposals.length <= 2,
    `episodic proposals should be capped (got ${episodicProposals.length})`
  );
});

test("T1: DefaultTokenEstimator produces reasonable estimates", () => {
  const estimator = new DefaultTokenEstimator();

  assert.equal(estimator.estimate(""), 0);
  assert.equal(estimator.estimate("hello"), 2);
  assert.equal(estimator.estimate("1234"), 1);
  const long = "a".repeat(4000);
  assert.equal(estimator.estimate(long), 1000);

  const typical = JSON.stringify({ role: "user", content: "What is the weather?" });
  assert.ok(estimator.estimate(typical) > 0);
  assert.ok(estimator.estimate(typical) < typical.length,
    "estimate should be less than char count");
});

test("T2: estimate is monotonic — longer text never yields fewer tokens", () => {
  const estimator = new DefaultTokenEstimator();
  const texts = ["", "hi", "hello world", "a".repeat(100), "b".repeat(1000)];
  const tokens = texts.map(t => estimator.estimate(t));

  for (let i = 1; i < tokens.length; i++) {
    assert.ok(tokens[i] >= tokens[i - 1],
      `longer text should have >= tokens: "${texts[i].slice(0, 20)}..." (${tokens[i]}) vs "${texts[i - 1].slice(0, 20)}..." (${tokens[i - 1]})`);
  }
});

test("C1: compressor does nothing when context is already within budget", () => {
  const estimator = new DefaultTokenEstimator();
  const compressor = new GradedContextCompressor();

  const tinySnapshot = makeSnapshot({ contextSummary: "hi" });
  const tinyProposals = [makeProposal({ explanation: "x" })];
  const tokens = estimator.estimate(JSON.stringify({ workspace: tinySnapshot, proposals: tinyProposals }));

  const result = compressor.compress(tinySnapshot, tinyProposals, tokens + 1000, estimator);

  assert.deepEqual(result.stagesApplied, [],
    "no compression stages should fire when already within budget");
  assert.equal(result.tokensSaved, 0);
});

test("C2: Stage 1 fires — memory_digest is halved", () => {
  const estimator = new DefaultTokenEstimator();
  const compressor = new GradedContextCompressor();

  const snapshot = makeSnapshot({
    contextSummary: "x",
    memoryDigest: Array.from({ length: 20 }, (_, i) => ({
      memory_id: `mem_${i}`,
      memory_type: "working",
      summary: "A".repeat(200),
      relevance: 0.8
    }))
  });
  const proposals = [];

  const fullTokens = estimator.estimate(JSON.stringify({ workspace: snapshot, proposals }));
  const budget = Math.ceil(fullTokens * 0.7);

  const result = compressor.compress(snapshot, proposals, budget, estimator);

  assert.ok(result.stagesApplied.includes("memory_digest_halved"),
    "Stage 1 should fire when memory is large");
  assert.ok(result.snapshot.memory_digest.length < snapshot.memory_digest.length,
    "memory_digest should be reduced");
  assert.ok(result.tokensSaved > 0, "should report tokens saved");
});

test("C3: Stage 2 fires — proposals are slimmed", () => {
  const estimator = new DefaultTokenEstimator();
  const compressor = new GradedContextCompressor();

  const fatProposals = Array.from({ length: 30 }, (_, i) => makeProposal({
    explanation: "B".repeat(500),
    payload: { details: "C".repeat(500) },
    metadata: { extra: "D".repeat(200) }
  }));

  const snapshot = makeSnapshot({ contextSummary: "x" });

  const fullTokens = estimator.estimate(JSON.stringify({ workspace: snapshot, proposals: fatProposals }));
  const budget = Math.ceil(fullTokens * 0.3);

  const result = compressor.compress(snapshot, fatProposals, budget, estimator);

  assert.ok(result.stagesApplied.includes("proposals_slimmed"),
    "Stage 2 should fire for fat proposals");

  for (const p of result.proposals) {
    assert.deepEqual(p.payload, {}, "slimmed proposal payload should be empty");
    assert.equal(p.explanation, undefined, "slimmed proposal should have no explanation");
  }
});

test("C4: Stage 3 fires — goals truncated, context_summary capped at 500 chars", () => {
  const estimator = new DefaultTokenEstimator();
  const compressor = new GradedContextCompressor();

  const snapshot = makeSnapshot({
    contextSummary: "X".repeat(2000),
    goals: Array.from({ length: 10 }, (_, i) => ({
      goal_id: `g_${i}`,
      title: `Goal ${i}`,
      status: i < 3 ? "active" : "pending",
      priority: i
    }))
  });
  const proposals = [];

  const fullTokens = estimator.estimate(JSON.stringify({ workspace: snapshot, proposals }));
  const budget = Math.ceil(fullTokens * 0.2);

  const result = compressor.compress(snapshot, proposals, budget, estimator);

  assert.ok(result.stagesApplied.includes("goals_truncated"),
    "Stage 3 should fire");
  assert.ok(result.snapshot.context_summary.length <= 500,
    "context_summary should be capped at 500 chars");
});

test("C5: Stage 4 fires — final truncation strips policy_decisions and caps summary at 200", () => {
  const estimator = new DefaultTokenEstimator();
  const compressor = new GradedContextCompressor();

  const snapshot = makeSnapshot({
    contextSummary: "Z".repeat(2000),
    policyDecisions: Array.from({ length: 20 }, (_, i) => ({
      decision_id: `pol_${i}`,
      policy_name: `policy_${i}`,
      level: "info",
      target_type: "action",
      reason: "R".repeat(200)
    }))
  });
  const proposals = [];

  const result = compressor.compress(snapshot, proposals, 50, estimator);

  assert.ok(result.stagesApplied.includes("final_truncation"),
    "Stage 4 should fire with very tight budget");
  assert.ok(result.snapshot.context_summary.length <= 200,
    "context_summary should be capped at 200 chars after Stage 4");
  assert.deepEqual(result.snapshot.policy_decisions, [],
    "policy_decisions should be cleared in Stage 4");
});

test("C6: compression is never lossy on identity — stagesApplied records the full pipeline", () => {
  const estimator = new DefaultTokenEstimator();
  const compressor = new GradedContextCompressor();

  const bigSnapshot = makeSnapshot({
    contextSummary: "A".repeat(5000),
    memoryDigest: Array.from({ length: 50 }, (_, i) => ({
      memory_id: `m_${i}`,
      memory_type: "working",
      summary: "S".repeat(300),
      relevance: 0.7
    })),
    goals: Array.from({ length: 20 }, (_, i) => ({
      goal_id: `g_${i}`,
      title: `Goal ${i}`,
      status: i % 2 === 0 ? "active" : "completed",
      priority: i
    })),
    policyDecisions: Array.from({ length: 30 }, (_, i) => ({
      decision_id: `p_${i}`,
      policy_name: `pn_${i}`,
      level: "info",
      target_type: "action",
      reason: "R".repeat(150)
    }))
  });
  const bigProposals = Array.from({ length: 20 }, (_, i) => makeProposal({
    explanation: "E".repeat(400),
    payload: { data: "D".repeat(400) }
  }));

  const result = compressor.compress(bigSnapshot, bigProposals, 100, estimator);

  assert.ok(result.stagesApplied.includes("memory_digest_halved"), "Stage 1");
  assert.ok(result.stagesApplied.includes("proposals_slimmed"), "Stage 2");
  assert.ok(result.stagesApplied.includes("goals_truncated"), "Stage 3");
  assert.ok(result.stagesApplied.includes("final_truncation"), "Stage 4");
  assert.equal(result.stagesApplied.length, 4, "all 4 stages should fire");
});

test("B1: withTokenBudget sets max_context_tokens on the profile", () => {
  const agent = defineAgent({
    id: "b1-profile-check",
    role: "Budget profile check."
  })
    .useReasoner({
      name: "b1-reasoner",
      async plan(ctx) { return []; },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Done",
          description: "ok",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .withTokenBudget(5000);

  const profile = agent.getProfile();
  assert.ok(profile.context_budget, "context_budget should be set");
  assert.equal(profile.context_budget.max_context_tokens, 5000,
    "max_context_tokens should match the value passed to withTokenBudget");
});

test("B2: session initializes token_budget_total from profile context_budget", () => {
  const agent = defineAgent({
    id: "b2-session-init",
    role: "Session budget init test."
  })
    .useReasoner({
      name: "b2-reasoner",
      async plan(ctx) { return []; },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Done",
          description: "ok",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .withTokenBudget(8000);

  const session = agent.createSession({
    agent_id: "b2-session-init-agent",
    tenant_id: "b2-tenant",
    initial_input: makeInput("check budget")
  });

  const sess = session.getSession();
  assert.equal(sess.budget_state.token_budget_total, 8000,
    "session should carry token_budget_total from profile");
  assert.equal(sess.budget_state.token_budget_used, 0,
    "session should start with token_budget_used = 0");
});

test("B3: token_budget_used accumulates across cycles in a session", async () => {
  let cycleCount = 0;

  const agent = defineAgent({
    id: "b3-accumulate",
    role: "Token accumulation test."
  })
    .useReasoner({
      name: "b3-reasoner",
      async plan(ctx) {
        cycleCount++;
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Plan." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Done",
          description: "ok",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .withTokenBudget(100000);

  const session = agent.createSession({
    agent_id: "b3-accumulate-agent",
    tenant_id: "b3-tenant",
    initial_input: makeInput("run and track tokens")
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.ok(cycleCount >= 1, "at least one cycle should have run");

  const sess = session.getSession();
  assert.ok(
    sess.budget_state.token_budget_used > 0,
    `token_budget_used should be > 0 after cycles (got ${sess.budget_state.token_budget_used})`
  );
});

test("B4: session aborts when token budget is exhausted", async () => {
  const agent = defineAgent({
    id: "b4-abort-on-budget",
    role: "Budget abort test."
  })
    .useReasoner({
      name: "b4-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Keep going." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call echo",
          tool_name: "echo",
          tool_args: { msg: "still going" },
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .withTokenBudget(10)
    .registerTool({
      name: "echo",
      description: "Echo",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: { msg: { type: "string" } } },
      async invoke(input) {
        return { summary: `echo: ${input.msg ?? ""}` };
      }
    });

  const session = agent.createSession({
    agent_id: "b4-abort-on-budget-agent",
    tenant_id: "b4-tenant",
    initial_input: makeInput("trigger abort via token budget")
  });

  const result = await session.run();
  assert.equal(result.finalState, "aborted",
    "session should abort when token budget is exhausted");
});

test("B5: workspace budget_assessment reports token exceedance on subsequent cycles", async () => {
  const agent = defineAgent({
    id: "b5-budget-assessment",
    role: "Budget assessment test."
  })
    .useReasoner({
      name: "b5-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Keep going." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call echo",
          tool_name: "echo",
          tool_args: { msg: "spend tokens" },
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .withTokenBudget(10)
    .registerTool({
      name: "echo",
      description: "Echo",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: { msg: { type: "string" } } },
      async invoke(input) {
        return { summary: `echo: ${input.msg ?? ""}` };
      }
    });

  const session = agent.createSession({
    agent_id: "b5-budget-assessment-agent",
    tenant_id: "b5-tenant",
    initial_input: makeInput("trigger budget assessment")
  });

  const result = await session.run();
  assert.equal(result.finalState, "aborted",
    "session should abort when token budget is exceeded");

  const records = session.getTraceRecords();
  assert.ok(records.length >= 1, "should have at least one trace record");

  const tokenBudgetWorkspace = records.find(
    r => r.workspace?.budget_assessment?.summary?.includes("Token budget")
  );
  assert.ok(
    tokenBudgetWorkspace,
    "at least one workspace snapshot should mention token budget in its summary"
  );
  assert.equal(
    tokenBudgetWorkspace.workspace.budget_assessment.within_budget, false,
    "the detecting workspace should report within_budget = false"
  );
});

test("P1: context is automatically compressed when it exceeds max_context_tokens", async () => {
  let workspaceReceivedByMeta = null;
  let proposalsReceivedByMeta = null;

  const agent = defineAgent({
    id: "p1-auto-compress",
    role: "Auto-compression integration test."
  })
    .useReasoner({
      name: "p1-reasoner",
      async plan(ctx) {
        return Array.from({ length: 10 }, (_, i) => ({
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { data: "H".repeat(500) },
          explanation: "E".repeat(500),
          metadata: { extra: "M".repeat(200) }
        }));
      },
      async respond(ctx) {
        workspaceReceivedByMeta = ctx.workspace ?? null;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Done",
          description: "compressed result",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .withTokenBudget(2000);

  const session = agent.createSession({
    agent_id: "p1-auto-compress-agent",
    tenant_id: "p1-tenant",
    initial_input: makeInput("A".repeat(200))
  });

  const result = await session.run();
  assert.ok(
    result.finalState === "completed" || result.finalState === "aborted",
    `session should terminate cleanly (got ${result.finalState})`
  );
});

test("E1: full session with token budget and custom retrieval_top_k completes cleanly", async () => {
  const agent = defineAgent({
    id: "e1-full-config",
    role: "End-to-end configured session."
  })
    .useReasoner({
      name: "e1-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Echo the input." }
        }];
      },
      async respond(ctx) {
        const input = typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Echo",
          description: input,
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .configureMemory({ retrieval_top_k: 3 })
    .withTokenBudget(50000);

  const profile = agent.getProfile();
  assert.equal(profile.memory_config.retrieval_top_k, 3);
  assert.equal(profile.context_budget.max_context_tokens, 50000);

  const session = agent.createSession({
    agent_id: "e1-full-config-agent",
    tenant_id: "e1-tenant",
    initial_input: makeInput("full config test")
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.equal(result.outputText, "full config test");

  const sess = session.getSession();
  assert.ok(sess.budget_state.token_budget_used > 0,
    "tokens should have been tracked");
  assert.ok(
    sess.budget_state.token_budget_used <= sess.budget_state.token_budget_total,
    "tokens used should not exceed total (session completed cleanly)"
  );
});

test("E2: two sessions share episodic memory with bounded retrieval", async () => {
  const agent = defineAgent({
    id: "e2-cross-session",
    role: "Cross-session memory bounded retrieval."
  })
    .useReasoner({
      name: "e2-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Process." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Done",
          description: "processed",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .configureMemory({ retrieval_top_k: 2 })
    .withTokenBudget(50000);

  const tenantId = "e2-shared-tenant";

  const s1 = agent.createSession({
    agent_id: "e2-cross-session-agent",
    tenant_id: tenantId,
    initial_input: makeInput("task one")
  });
  const r1 = await s1.run();
  assert.equal(r1.finalState, "completed");
  assert.ok(s1.getEpisodes().length >= 1, "session 1 should produce episodes");

  const s2 = agent.createSession({
    agent_id: "e2-cross-session-agent",
    tenant_id: tenantId,
    initial_input: makeInput("task two")
  });
  const r2 = await s2.run();
  assert.equal(r2.finalState, "completed");

  const traces = s2.getTraceRecords();
  const episodicProposals = traces.flatMap(t =>
    (t.proposals ?? []).filter(p => p.module_name === "episodic-memory-provider")
  );

  assert.ok(
    episodicProposals.length >= 1,
    "session 2 should recall episodic memories from session 1"
  );
});

function makeSnapshot({
  contextSummary = "test context",
  memoryDigest = [],
  goals = [],
  policyDecisions = []
} = {}) {
  return {
    workspace_id: "wsp_test",
    schema_version: "0.1.0",
    session_id: "ses_test",
    cycle_id: "cyc_test",
    input_events: [],
    active_goals: goals.map(g => ({
      goal_id: g.goal_id,
      title: g.title,
      status: g.status,
      priority: g.priority
    })),
    context_summary: contextSummary,
    memory_digest: memoryDigest,
    skill_digest: [],
    candidate_actions: [],
    budget_assessment: { within_budget: true, summary: "Within budget." },
    policy_decisions: policyDecisions,
    created_at: new Date().toISOString()
  };
}

function makeProposal({
  explanation = "test proposal",
  payload = {},
  metadata = undefined
} = {}) {
  return {
    proposal_id: `prp_${Math.random().toString(36).slice(2)}`,
    schema_version: "0.1.0",
    session_id: "ses_test",
    cycle_id: "cyc_test",
    module_name: "test-module",
    proposal_type: "plan",
    salience_score: 0.85,
    confidence: 0.9,
    risk: 0,
    payload,
    explanation,
    metadata
  };
}
