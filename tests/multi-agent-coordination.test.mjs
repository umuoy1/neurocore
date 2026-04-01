import assert from "node:assert/strict";
import test from "node:test";
import {
  HierarchicalStrategy,
  PeerToPeerStrategy,
  MarketBasedStrategy
} from "@neurocore/multi-agent";

function makeAgent(overrides = {}) {
  const now = new Date().toISOString();
  return {
    agent_id: "agent-1",
    instance_id: "inst-1",
    name: "Worker",
    version: "1.0.0",
    status: "idle",
    capabilities: [{ name: "general", proficiency: 0.8 }],
    domains: ["general"],
    current_load: 0,
    max_capacity: 5,
    heartbeat_interval_ms: 30000,
    last_heartbeat_at: now,
    registered_at: now,
    ...overrides
  };
}

function makeContext(agents, goalOverrides = {}) {
  return {
    initiator_agent_id: "supervisor",
    participating_agents: agents,
    goal: {
      goal_id: "goal-1",
      title: "Complete Report",
      priority: 1,
      ...goalOverrides
    }
  };
}

test("HierarchicalStrategy", async (t) => {
  await t.test("decomposes and assigns with round_robin", async () => {
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1" }),
      makeAgent({ instance_id: "w2", agent_id: "a2" }),
      makeAgent({ instance_id: "w3", agent_id: "a3" })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.equal(result.strategy_name, "hierarchical");
    assert.equal(result.assignments.length, 3);
    assert.equal(result.assignments[0].instance_id, "w1");
    assert.equal(result.assignments[1].instance_id, "w2");
    assert.equal(result.assignments[2].instance_id, "w3");
  });

  await t.test("assigns with least_loaded", async () => {
    const strategy = new HierarchicalStrategy({ worker_selection: "least_loaded" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1", current_load: 3 }),
      makeAgent({ instance_id: "w2", agent_id: "a2", current_load: 0 }),
      makeAgent({ instance_id: "w3", agent_id: "a3", current_load: 1 })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.ok(result.assignments.length > 0);
    assert.equal(result.assignments[0].instance_id, "w2");
  });

  await t.test("assigns with best_fit", async () => {
    const strategy = new HierarchicalStrategy({ worker_selection: "best_fit" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1", capabilities: [{ name: "ml", proficiency: 0.7 }] }),
      makeAgent({ instance_id: "w2", agent_id: "a2", capabilities: [{ name: "ml", proficiency: 0.95 }] })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.equal(result.assignments[0].instance_id, "w2");
  });

  await t.test("no agents returns empty assignments", async () => {
    const strategy = new HierarchicalStrategy();
    const result = await strategy.coordinate(makeContext([]));
    assert.equal(result.assignments.length, 0);
  });

  await t.test("resolveConflict keeps highest priority", async () => {
    const strategy = new HierarchicalStrategy();
    const conflicts = [
      { agent_id: "a1", instance_id: "w1", sub_goal: { title: "Low", priority: 1 } },
      { agent_id: "a2", instance_id: "w2", sub_goal: { title: "High", priority: 3 } }
    ];
    const resolved = await strategy.resolveConflict(makeContext([]), conflicts);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].sub_goal.title, "High");
  });
});

test("PeerToPeerStrategy", async (t) => {
  await t.test("reaches simple_majority consensus", async () => {
    const strategy = new PeerToPeerStrategy({ consensus_mode: "simple_majority" });
    const agents = [
      makeAgent({ instance_id: "p1", agent_id: "a1" }),
      makeAgent({ instance_id: "p2", agent_id: "a2" }),
      makeAgent({ instance_id: "p3", agent_id: "a3" })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.equal(result.strategy_name, "peer_to_peer");
    assert.equal(result.assignments.length, 3);
    assert.ok(result.coordination_metadata?.consensus_reached);
  });

  await t.test("unanimous consensus", async () => {
    const strategy = new PeerToPeerStrategy({ consensus_mode: "unanimous" });
    const agents = [
      makeAgent({ instance_id: "p1", agent_id: "a1" }),
      makeAgent({ instance_id: "p2", agent_id: "a2" })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.ok(result.coordination_metadata?.consensus_reached);
  });

  await t.test("weighted voting", async () => {
    const strategy = new PeerToPeerStrategy({
      consensus_mode: "weighted_majority",
      agent_weights: { "p1": 3, "p2": 1 }
    });
    const agents = [
      makeAgent({ instance_id: "p1", agent_id: "a1" }),
      makeAgent({ instance_id: "p2", agent_id: "a2" })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.ok(result.coordination_metadata?.consensus_reached);
  });

  await t.test("no participants returns empty", async () => {
    const strategy = new PeerToPeerStrategy();
    const result = await strategy.coordinate(makeContext([]));
    assert.equal(result.assignments.length, 0);
  });
});

test("MarketBasedStrategy", async (t) => {
  await t.test("auction assigns tasks", async () => {
    const strategy = new MarketBasedStrategy();
    const agents = [
      makeAgent({ instance_id: "m1", agent_id: "a1", capabilities: [{ name: "ml", proficiency: 0.9 }] }),
      makeAgent({ instance_id: "m2", agent_id: "a2", capabilities: [{ name: "ml", proficiency: 0.7 }] })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.equal(result.strategy_name, "market_based");
    assert.ok(result.assignments.length > 0);
  });

  await t.test("reserve_price filters expensive bids", async () => {
    const strategy = new MarketBasedStrategy({ reserve_price: 0.001 });
    const agents = [
      makeAgent({ instance_id: "m1", agent_id: "a1", current_load: 3, capabilities: [{ name: "ml", proficiency: 0.5 }] })
    ];
    const result = await strategy.coordinate(makeContext(agents));
    assert.equal(result.assignments.length, 0);
  });

  await t.test("no bidders returns empty", async () => {
    const strategy = new MarketBasedStrategy();
    const result = await strategy.coordinate(makeContext([]));
    assert.equal(result.assignments.length, 0);
  });
});
