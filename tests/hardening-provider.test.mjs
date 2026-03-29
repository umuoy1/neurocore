import assert from "node:assert/strict";
import test from "node:test";
import { CycleEngine } from "@neurocore/runtime-core";

function makeProfile() {
  return {
    agent_id: "test-agent",
    schema_version: "0.1.0",
    name: "Test Agent",
    version: "1.0.0",
    role: "test",
    mode: "embedded",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: { working_memory_enabled: true, episodic_memory_enabled: false, write_policy: "immediate" },
    runtime_config: { max_cycles: 10 }
  };
}

function makeSession() {
  return {
    session_id: "ses_test",
    schema_version: "0.1.0",
    tenant_id: "t1",
    agent_id: "test-agent",
    state: "running",
    session_mode: "sync",
    goal_tree_ref: "gt1",
    budget_state: { cycle_used: 0, tool_call_used: 0, token_budget_used: 0 },
    policy_state: {}
  };
}

function makeInput() {
  return {
    input_id: "inp_1",
    content: "test input",
    created_at: new Date().toISOString()
  };
}

function makeBaseContext() {
  return {
    tenant_id: "t1",
    session: { ...makeSession(), current_cycle_id: "cyc_1" },
    profile: makeProfile(),
    goals: [],
    runtime_state: { current_input_content: "test", current_input_metadata: null },
    services: {
      now: () => new Date().toISOString(),
      generateId: (prefix) => `${prefix}_gen`
    },
    memory_config: makeProfile().memory_config
  };
}

test("F1: throwing MemoryProvider does not crash cycle, other providers return normally", async () => {
  const engine = new CycleEngine();
  const goodProvider = {
    name: "good-mem",
    async retrieve() { return [{ proposal_id: "p1", schema_version: "0.1.0", session_id: "ses_test", cycle_id: "cyc_1", module_name: "good-mem", proposal_type: "memory_recall", salience_score: 0.8, confidence: 0.9, risk: 0, payload: {} }]; },
    async getDigest() { return []; }
  };
  const badProvider = {
    name: "bad-mem",
    async retrieve() { throw new Error("boom"); },
    async getDigest() { throw new Error("boom digest"); }
  };

  const result = await engine.run({
    tenantId: "t1",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: [],
    reasoner: { async plan() { return []; }, async respond() { return [{ action_id: "act_1", action_type: "respond", title: "respond", side_effect_level: "none" }]; } },
    memoryProviders: [goodProvider, badProvider],
    metaController: { async evaluate(_ctx, actions) { return { decision_type: "execute_action", selected_action_id: actions[0]?.action_id, confidence: 0.8 }; } }
  });

  assert.ok(result);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].module_name, "good-mem");
});

test("F2: throwing Predictor does not crash cycle", async () => {
  const engine = new CycleEngine();
  const result = await engine.run({
    tenantId: "t1",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: [],
    reasoner: { async plan() { return []; }, async respond() { return [{ action_id: "act_1", action_type: "respond", title: "respond", side_effect_level: "none" }]; } },
    predictors: [{ name: "bad-predictor", async predict() { throw new Error("predictor boom"); } }],
    metaController: { async evaluate(_ctx, actions) { return { decision_type: "execute_action", selected_action_id: actions[0]?.action_id, confidence: 0.8 }; } }
  });

  assert.ok(result);
  assert.equal(result.predictions.length, 0);
});

test("F3: throwing SkillProvider does not crash cycle", async () => {
  const engine = new CycleEngine();
  const result = await engine.run({
    tenantId: "t1",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: [],
    reasoner: { async plan() { return []; }, async respond() { return [{ action_id: "act_1", action_type: "respond", title: "respond", side_effect_level: "none" }]; } },
    skillProviders: [{ name: "bad-skill", async match() { throw new Error("skill boom"); } }],
    metaController: { async evaluate(_ctx, actions) { return { decision_type: "execute_action", selected_action_id: actions[0]?.action_id, confidence: 0.8 }; } }
  });

  assert.ok(result);
});

test("F4: throwing PolicyProvider does not crash cycle", async () => {
  const engine = new CycleEngine();
  const result = await engine.run({
    tenantId: "t1",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: [],
    reasoner: { async plan() { return []; }, async respond() { return [{ action_id: "act_1", action_type: "respond", title: "respond", side_effect_level: "none" }]; } },
    policies: [{ name: "bad-policy", async evaluateAction() { throw new Error("policy boom"); } }],
    metaController: { async evaluate(_ctx, actions) { return { decision_type: "execute_action", selected_action_id: actions[0]?.action_id, confidence: 0.8 }; } }
  });

  assert.ok(result);
});

test("F5: reasoner.plan() throwing returns empty proposals but cycle completes", async () => {
  const engine = new CycleEngine();
  const result = await engine.run({
    tenantId: "t1",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: [],
    reasoner: {
      async plan() { throw new Error("plan boom"); },
      async respond() { return [{ action_id: "act_1", action_type: "respond", title: "respond", side_effect_level: "none" }]; }
    },
    metaController: { async evaluate(_ctx, actions) { return { decision_type: "execute_action", selected_action_id: actions[0]?.action_id, confidence: 0.8 }; } }
  });

  assert.ok(result);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.actions.length, 1);
});

test("F6: reasoner.respond() throwing returns empty actions but cycle completes", async () => {
  const engine = new CycleEngine();
  const result = await engine.run({
    tenantId: "t1",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: [],
    reasoner: {
      async plan() { return []; },
      async respond() { throw new Error("respond boom"); }
    },
    metaController: { async evaluate(_ctx, actions) { return { decision_type: "abort", rejection_reasons: ["no actions"] }; } }
  });

  assert.ok(result);
  assert.equal(result.actions.length, 0);
});
