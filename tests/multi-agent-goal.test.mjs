import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryDistributedGoalManager,
  HierarchicalStrategy
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

test("InMemoryDistributedGoalManager", async (t) => {
  await t.test("decompose creates sub-goals with assignments", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1" }),
      makeAgent({ instance_id: "w2", agent_id: "a2" })
    ];
    const subGoals = [
      { title: "Data Collection", priority: 2 },
      { title: "Data Analysis", priority: 1 }
    ];
    const assignments = await mgr.decompose("parent-1", subGoals, strategy, agents);
    assert.equal(assignments.length, 2);
    assert.equal(assignments[0].goal_id, "parent-1-sub-0");
    assert.equal(assignments[1].goal_id, "parent-1-sub-1");
    assert.equal(assignments[0].status, "pending");
  });

  await t.test("listAssignments returns child assignments", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [makeAgent({ instance_id: "w1", agent_id: "a1" })];
    await mgr.decompose("parent-1", [{ title: "Task", priority: 1 }], strategy, agents);
    const list = await mgr.listAssignments("parent-1");
    assert.equal(list.length, 1);
  });

  await t.test("getAssignment returns specific assignment", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [makeAgent({ instance_id: "w1", agent_id: "a1" })];
    await mgr.decompose("parent-1", [{ title: "Task", priority: 1 }], strategy, agents);
    const assignment = await mgr.getAssignment("parent-1-sub-0");
    assert.ok(assignment);
    assert.equal(assignment.agent_id, "a1");
  });

  await t.test("updateStatus changes assignment status", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [makeAgent({ instance_id: "w1", agent_id: "a1" })];
    await mgr.decompose("parent-1", [{ title: "Task", priority: 1 }], strategy, agents);
    await mgr.updateStatus("parent-1-sub-0", "completed", 1);
    const assignment = await mgr.getAssignment("parent-1-sub-0");
    assert.equal(assignment?.status, "completed");
    assert.equal(assignment?.progress, 1);
  });

  await t.test("all_success propagation: all completed → parent completed", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    mgr.setPropagationStrategy("all_success");
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1" }),
      makeAgent({ instance_id: "w2", agent_id: "a2" })
    ];
    const assignments = await mgr.decompose("parent-1", [
      { title: "T1", priority: 1 },
      { title: "T2", priority: 1 }
    ], strategy, agents);

    const parentGA = { goal_id: "parent-1", agent_id: "supervisor", instance_id: "sup", session_id: "", status: "running", updated_at: new Date().toISOString() };
    mgr["assignments"].set("parent-1", parentGA);

    await mgr.updateStatus(assignments[0].goal_id, "completed", 1);
    assert.equal(parentGA.status, "running");
    await mgr.updateStatus(assignments[1].goal_id, "completed", 1);
    assert.equal(parentGA.status, "completed");
  });

  await t.test("majority propagation: >50% completed → parent completed", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    mgr.setPropagationStrategy("majority");
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1" }),
      makeAgent({ instance_id: "w2", agent_id: "a2" }),
      makeAgent({ instance_id: "w3", agent_id: "a3" })
    ];
    const assignments = await mgr.decompose("parent-1", [
      { title: "T1", priority: 1 },
      { title: "T2", priority: 1 },
      { title: "T3", priority: 1 }
    ], strategy, agents);

    const parentGA = { goal_id: "parent-1", agent_id: "supervisor", instance_id: "sup", session_id: "", status: "running", updated_at: new Date().toISOString() };
    mgr["assignments"].set("parent-1", parentGA);

    await mgr.updateStatus(assignments[0].goal_id, "completed", 1);
    assert.equal(parentGA.status, "running");
    await mgr.updateStatus(assignments[1].goal_id, "completed", 1);
    assert.equal(parentGA.status, "completed");
  });

  await t.test("any_success propagation: 1 completed → parent completed", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    mgr.setPropagationStrategy("any_success");
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1" }),
      makeAgent({ instance_id: "w2", agent_id: "a2" })
    ];
    const assignments = await mgr.decompose("parent-1", [
      { title: "T1", priority: 1 },
      { title: "T2", priority: 1 }
    ], strategy, agents);

    const parentGA = { goal_id: "parent-1", agent_id: "supervisor", instance_id: "sup", session_id: "", status: "running", updated_at: new Date().toISOString() };
    mgr["assignments"].set("parent-1", parentGA);

    await mgr.updateStatus(assignments[0].goal_id, "completed", 1);
    assert.equal(parentGA.status, "completed");
  });

  await t.test("reassign updates agent", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [makeAgent({ instance_id: "w1", agent_id: "a1" })];
    await mgr.decompose("parent-1", [{ title: "Task", priority: 1 }], strategy, agents);
    await mgr.reassign("parent-1-sub-0", "a2", "w2");
    const assignment = await mgr.getAssignment("parent-1-sub-0");
    assert.equal(assignment?.agent_id, "a2");
    assert.equal(assignment?.instance_id, "w2");
  });

  await t.test("aggregateProgress computes correctly", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [
      makeAgent({ instance_id: "w1", agent_id: "a1" }),
      makeAgent({ instance_id: "w2", agent_id: "a2" })
    ];
    const assignments = await mgr.decompose("parent-1", [
      { title: "T1", priority: 1 },
      { title: "T2", priority: 1 }
    ], strategy, agents);
    await mgr.updateStatus(assignments[0].goal_id, "completed", 1);
    const progress = await mgr.aggregateProgress("parent-1");
    assert.equal(progress.total, 2);
    assert.equal(progress.completed, 1);
    assert.equal(progress.progress, 0.5);
  });

  await t.test("aggregateProgress for unknown parent returns zero", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const progress = await mgr.aggregateProgress("unknown");
    assert.equal(progress.total, 0);
    assert.equal(progress.completed, 0);
  });

  await t.test("conflicting status update is rejected and recorded", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [makeAgent({ instance_id: "w1", agent_id: "a1" })];
    await mgr.decompose("parent-1", [{ title: "Task", priority: 1 }], strategy, agents);
    await mgr.updateStatus("parent-1-sub-0", "completed", 1, {
      agent_id: "other-agent",
      instance_id: "other-instance"
    });
    const assignment = await mgr.getAssignment("parent-1-sub-0");
    assert.equal(assignment?.status, "pending");
    const conflicts = await mgr.getConflicts("parent-1-sub-0");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].action, "status_update");
  });

  await t.test("matching owner may update assignment", async () => {
    const mgr = new InMemoryDistributedGoalManager();
    const strategy = new HierarchicalStrategy({ worker_selection: "round_robin" });
    const agents = [makeAgent({ instance_id: "w1", agent_id: "a1" })];
    await mgr.decompose("parent-1", [{ title: "Task", priority: 1 }], strategy, agents);
    await mgr.updateStatus("parent-1-sub-0", "completed", 1, {
      agent_id: "a1",
      instance_id: "w1"
    });
    const assignment = await mgr.getAssignment("parent-1-sub-0");
    assert.equal(assignment?.status, "completed");
  });
});
