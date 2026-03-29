import assert from "node:assert/strict";
import test from "node:test";
import { WorkingMemoryStore } from "@neurocore/memory-core";
import { GoalManager } from "@neurocore/runtime-core";

test("W1: WorkingMemoryStore maxEntries=3 keeps only last 3 entries after 5 pushes", () => {
  const store = new WorkingMemoryStore(3);
  for (let i = 1; i <= 5; i++) {
    store.append("ses_1", { memory_id: `mem_${i}`, summary: `entry ${i}`, relevance: 0.5 });
  }
  const entries = store.list("ses_1");
  assert.equal(entries.length, 3);
  assert.equal(entries[0].memory_id, "mem_3");
  assert.equal(entries[1].memory_id, "mem_4");
  assert.equal(entries[2].memory_id, "mem_5");
});

test("W2: WorkingMemoryStore without maxEntries allows unlimited growth", () => {
  const store = new WorkingMemoryStore();
  for (let i = 1; i <= 100; i++) {
    store.append("ses_1", { memory_id: `mem_${i}`, summary: `entry ${i}`, relevance: 0.5 });
  }
  const entries = store.list("ses_1");
  assert.equal(entries.length, 100);
});

test("G1: initializeRootGoal sets created_at and updated_at", () => {
  const mgr = new GoalManager();
  const goal = mgr.initializeRootGoal("ses_1", {
    input_id: "inp_1",
    content: "test goal",
    created_at: new Date().toISOString()
  });

  assert.ok(goal.created_at, "created_at should be set");
  assert.ok(goal.updated_at, "updated_at should be set");
  assert.equal(goal.created_at, goal.updated_at);
});

test("G2: updateStatus updates updated_at but not created_at", async () => {
  const mgr = new GoalManager();
  const goal = mgr.initializeRootGoal("ses_1", {
    input_id: "inp_1",
    content: "test goal",
    created_at: new Date().toISOString()
  });

  const originalCreatedAt = goal.created_at;

  await new Promise((r) => setTimeout(r, 2));
  mgr.updateStatus("ses_1", goal.goal_id, "completed");

  assert.equal(goal.created_at, originalCreatedAt, "created_at should not change");
  assert.notEqual(goal.updated_at, originalCreatedAt, "updated_at should change");
});

test("G3: child goals added via addMany get their own created_at", () => {
  const mgr = new GoalManager();
  const root = mgr.initializeRootGoal("ses_1", {
    input_id: "inp_1",
    content: "parent goal",
    created_at: new Date().toISOString()
  });

  const childGoal = {
    goal_id: "gol_child_1",
    schema_version: "0.1.0",
    session_id: "ses_1",
    parent_goal_id: root.goal_id,
    title: "Child goal",
    goal_type: "subtask",
    status: "pending",
    priority: 90,
    owner: "agent",
    metadata: {}
  };

  const added = mgr.addMany("ses_1", [childGoal]);
  assert.equal(added.length, 1);
  assert.ok(added[0].created_at, "child goal should have created_at");
  assert.ok(added[0].updated_at, "child goal should have updated_at");
});
