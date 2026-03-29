import assert from "node:assert/strict";
import test from "node:test";
import { DefaultMetaController } from "@neurocore/runtime-core";

function makeCtx() {
  return {
    tenant_id: "t1",
    session: {
      session_id: "ses_test",
      schema_version: "0.1.0",
      tenant_id: "t1",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "gt1",
      budget_state: { cycle_used: 0, tool_call_used: 0, token_budget_used: 0 },
      policy_state: {}
    },
    profile: {
      agent_id: "test-agent",
      schema_version: "0.1.0",
      name: "Test",
      version: "1.0.0",
      role: "test",
      mode: "embedded",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: { working_memory_enabled: true, episodic_memory_enabled: false, write_policy: "immediate" },
      runtime_config: { max_cycles: 10 }
    },
    goals: [],
    runtime_state: {},
    services: { now: () => new Date().toISOString(), generateId: (p) => `${p}_1` }
  };
}

test("M1: high-risk action sorted after low-risk action", async () => {
  const ctrl = new DefaultMetaController();
  const ctx = makeCtx();
  const actions = [
    { action_id: "a_high", action_type: "respond", title: "Risky", side_effect_level: "none" },
    { action_id: "a_low", action_type: "respond", title: "Safe", side_effect_level: "none" }
  ];
  const predictions = [
    {
      prediction_id: "p1",
      session_id: "ses_test",
      cycle_id: "cyc_1",
      action_id: "a_high",
      predictor_name: "test",
      expected_outcome: "ok",
      uncertainty: 0.8,
      created_at: new Date().toISOString()
    },
    {
      prediction_id: "p2",
      session_id: "ses_test",
      cycle_id: "cyc_1",
      action_id: "a_low",
      predictor_name: "test",
      expected_outcome: "ok",
      uncertainty: 0.1,
      created_at: new Date().toISOString()
    }
  ];

  const result = await ctrl.evaluate(ctx, actions, predictions, []);
  assert.equal(result.selected_action_id, "a_low");
  assert.ok(result.confidence > 0.5, "confidence should be high for low-risk action");
});

test("M2: confidence computed from prediction uncertainty", async () => {
  const ctrl = new DefaultMetaController();
  const ctx = makeCtx();
  const actions = [
    { action_id: "a1", action_type: "respond", title: "Test", side_effect_level: "none" }
  ];
  const predictions = [
    {
      prediction_id: "p1",
      session_id: "ses_test",
      cycle_id: "cyc_1",
      action_id: "a1",
      predictor_name: "test",
      expected_outcome: "ok",
      uncertainty: 0.3,
      created_at: new Date().toISOString()
    }
  ];

  const result = await ctrl.evaluate(ctx, actions, predictions, []);
  const expectedConfidence = Math.max(0.1, 1 - 0.3);
  assert.equal(result.confidence, expectedConfidence);
});

test("M3: custom approvalThreshold is respected", async () => {
  const ctrl = new DefaultMetaController({ approvalThreshold: 0.3 });
  const ctx = makeCtx();
  const actions = [
    { action_id: "a1", action_type: "respond", title: "Test", side_effect_level: "none" }
  ];
  const predictions = [
    {
      prediction_id: "p1",
      session_id: "ses_test",
      cycle_id: "cyc_1",
      action_id: "a1",
      predictor_name: "test",
      expected_outcome: "ok",
      uncertainty: 0.5,
      created_at: new Date().toISOString()
    }
  ];

  const result = await ctrl.evaluate(ctx, actions, predictions, []);
  assert.equal(result.requires_human_approval, true);
  assert.equal(result.decision_type, "request_approval");
});

test("M4: no prediction defaults confidence to 0.6", async () => {
  const ctrl = new DefaultMetaController();
  const ctx = makeCtx();
  const actions = [
    { action_id: "a1", action_type: "respond", title: "Test", side_effect_level: "none" }
  ];

  const result = await ctrl.evaluate(ctx, actions, [], []);
  assert.equal(result.confidence, 0.6);
});
