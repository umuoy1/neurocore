import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultActiveInferenceEvaluator,
  InMemoryWorldStateGraph,
  RuleBasedSimulator,
  SimulationBasedPredictor
} from "@neurocore/world-model";

function ts() {
  return new Date().toISOString();
}

function context() {
  return {
    tenant_id: "tenant-ai",
    session: {
      session_id: "ses-ai",
      schema_version: "1.0.0",
      tenant_id: "tenant-ai",
      agent_id: "agent-ai",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal-ai",
      budget_state: {},
      policy_state: {},
      current_cycle_id: "cyc-ai"
    },
    profile: {
      agent_id: "agent-ai",
      schema_version: "1.0.0",
      name: "AI",
      version: "1.0.0",
      role: "test",
      mode: "runtime",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: { working_memory_enabled: true, episodic_memory_enabled: true, write_policy: "immediate" },
      runtime_config: { max_cycles: 3 }
    },
    goals: [],
    runtime_state: {},
    services: {
      now: () => ts(),
      generateId: (prefix) => `${prefix}_ai`
    }
  };
}

function action(overrides = {}) {
  return {
    action_id: "act-ai",
    action_type: "call_tool",
    title: "Test action",
    side_effect_level: "low",
    ...overrides
  };
}

test("DefaultActiveInferenceEvaluator computes expected free energy components", async () => {
  const evaluator = new DefaultActiveInferenceEvaluator();
  const simulator = new RuleBasedSimulator();
  const graph = new InMemoryWorldStateGraph();
  const simulation = await simulator.simulate(graph, action(), context());

  const result = evaluator.computeEFE({
    simulation,
    action: action(),
    current_state: graph
  });

  assert.ok(typeof result.risk === "number");
  assert.ok(typeof result.ambiguity === "number");
  assert.ok(typeof result.novelty === "number");
  assert.equal(result.expected_free_energy, Number((result.risk + result.ambiguity - result.novelty).toFixed(3)));
});

test("DefaultActiveInferenceEvaluator prefers lower risk and ambiguity", async () => {
  const evaluator = new DefaultActiveInferenceEvaluator();
  const low = evaluator.computeEFE({
    simulation: {
      simulation_id: "sim-low",
      action_id: "act-low",
      predicted_diff: {
        added_entities: [],
        updated_entities: [],
        removed_entity_ids: [],
        added_relations: [],
        removed_relation_ids: []
      },
      success_probability: 0.95,
      risk_score: 0.1,
      side_effects: [],
      estimated_duration_ms: 100,
      confidence: 0.9
    },
    action: action({ action_id: "act-low" })
  });
  const high = evaluator.computeEFE({
    simulation: {
      simulation_id: "sim-high",
      action_id: "act-high",
      predicted_diff: {
        added_entities: [],
        updated_entities: [],
        removed_entity_ids: [],
        added_relations: [],
        removed_relation_ids: []
      },
      success_probability: 0.5,
      risk_score: 0.8,
      side_effects: ["tool_execution"],
      estimated_duration_ms: 5000,
      confidence: 0.3
    },
    action: action({ action_id: "act-high", side_effect_level: "high" })
  });

  assert.ok(low.expected_free_energy < high.expected_free_energy);
});

test("SimulationBasedPredictor includes EFE summary in reasoning when evaluator is present", async () => {
  const graph = new InMemoryWorldStateGraph();
  const predictor = new SimulationBasedPredictor(
    new RuleBasedSimulator(),
    graph,
    new DefaultActiveInferenceEvaluator()
  );

  const prediction = await predictor.predict(context(), action());
  assert.ok(prediction);
  assert.match(prediction.reasoning, /efe=/);
});
