import assert from "node:assert/strict";
import test from "node:test";
import {
  RuleBasedSimulator,
  SimulationBasedPredictor,
  InMemoryWorldStateGraph
} from "@neurocore/world-model";

function ts() {
  return new Date().toISOString();
}

function makeContext() {
  return {
    tenant_id: "t1",
    session: {
      session_id: "s1",
      schema_version: "0.1.0",
      tenant_id: "t1",
      agent_id: "a1",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "g1",
      budget_state: {},
      policy_state: {},
      current_cycle_id: "cyc_1"
    },
    profile: {
      agent_id: "a1",
      schema_version: "0.1.0",
      name: "test",
      version: "0.1.0",
      role: "test",
      mode: "runtime",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: { working_memory_enabled: true, episodic_memory_enabled: true, write_policy: "immediate" },
      runtime_config: { max_cycles: 10 }
    },
    goals: [],
    runtime_state: {},
    services: { now: () => ts(), generateId: (p) => `${p}_test` }
  };
}

function makeAction(overrides = {}) {
  return {
    action_id: "act_1",
    action_type: "call_tool",
    title: "Test action",
    side_effect_level: "low",
    ...overrides
  };
}

test("RuleBasedSimulator simulate returns valid structure", async () => {
  const simulator = new RuleBasedSimulator();
  const graph = new InMemoryWorldStateGraph();
  const ctx = makeContext();
  const action = makeAction();

  const result = await simulator.simulate(graph, action, ctx);

  assert.ok(result.simulation_id);
  assert.equal(result.action_id, "act_1");
  assert.ok(result.success_probability > 0);
  assert.ok(typeof result.risk_score === "number");
  assert.ok(Array.isArray(result.side_effects));
  assert.ok(typeof result.estimated_duration_ms === "number");
  assert.ok(typeof result.confidence === "number");
});

test("RuleBasedSimulator precondition not met sets probability to 0", async () => {
  const simulator = new RuleBasedSimulator();
  const graph = new InMemoryWorldStateGraph();
  const ctx = makeContext();
  const action = makeAction({
    preconditions: ["entity:cup_01:reachable=true"]
  });

  const result = await simulator.simulate(graph, action, ctx);
  assert.equal(result.success_probability, 0);
  assert.ok(result.reasoning.includes("Preconditions not met"));
});

test("RuleBasedSimulator precondition met when entity exists", async () => {
  const simulator = new RuleBasedSimulator();
  const graph = new InMemoryWorldStateGraph();
  graph.addEntity({
    entity_id: "cup_01",
    entity_type: "object",
    properties: { reachable: "true" },
    confidence: 0.9,
    last_observed: ts()
  });
  const ctx = makeContext();
  const action = makeAction({
    preconditions: ["entity:cup_01:reachable=true"]
  });

  const result = await simulator.simulate(graph, action, ctx);
  assert.ok(result.success_probability > 0);
});

test("RuleBasedSimulator risk varies by side_effect_level", async () => {
  const simulator = new RuleBasedSimulator();
  const graph = new InMemoryWorldStateGraph();
  const ctx = makeContext();

  const noneResult = await simulator.simulate(graph, makeAction({ side_effect_level: "none" }), ctx);
  const highResult = await simulator.simulate(graph, makeAction({ side_effect_level: "high" }), ctx);

  assert.ok(highResult.risk_score > noneResult.risk_score);
});

test("SimulationBasedPredictor converts SimulationResult to Prediction", async () => {
  const simulator = new RuleBasedSimulator();
  const graph = new InMemoryWorldStateGraph();
  const predictor = new SimulationBasedPredictor(simulator, graph);

  assert.equal(predictor.name, "simulation-based");

  const ctx = makeContext();
  const action = makeAction();

  const prediction = await predictor.predict(ctx, action);
  assert.ok(prediction);
  assert.equal(prediction.action_id, "act_1");
  assert.equal(prediction.predictor_name, "simulation-based");
  assert.ok(typeof prediction.success_probability === "number");
  assert.ok(typeof prediction.uncertainty === "number");
  assert.ok(prediction.created_at);
});

test("SimulationBasedPredictor returns null on simulator error", async () => {
  const failingSimulator = {
    async simulate() {
      throw new Error("Simulation failed");
    }
  };
  const graph = new InMemoryWorldStateGraph();
  const predictor = new SimulationBasedPredictor(failingSimulator, graph);

  const ctx = makeContext();
  const action = makeAction();

  const prediction = await predictor.predict(ctx, action);
  assert.equal(prediction, null);
});
