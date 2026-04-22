import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySharedStateStore } from "@neurocore/multi-agent";

test("InMemorySharedStateStore", async (t) => {
  await t.test("applyDiff writes and getState reads", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "sensor", properties: { temp: 25 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    const state = await store.getState("ns1");
    assert.deepEqual(state["e1"], { temp: 25 });
  });

  await t.test("applyDiff updates existing entity", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "sensor", properties: { temp: 25 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    await store.applyDiff("agent-b", "ns1", {
      added_entities: [],
      updated_entities: [{ entity_id: "e1", changes: { temp: 30 } }],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    const state = await store.getState("ns1");
    assert.deepEqual(state["e1"], { temp: 30 });
  });

  await t.test("applyDiff removes entity", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "sensor", properties: { temp: 25 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [],
      updated_entities: [],
      removed_entity_ids: ["e1"],
      added_relations: [],
      removed_relation_ids: []
    });
    const state = await store.getState("ns1");
    assert.equal(state["e1"], undefined);
  });

  await t.test("subscribe receives notifications", async () => {
    const store = new InMemorySharedStateStore();
    const events = [];
    store.subscribe("ns1", (agentId, diff) => {
      events.push({ agentId, entityCount: diff.added_entities.length });
    });
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "sensor", properties: {}, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].agentId, "agent-a");
  });

  await t.test("unsubscribe stops notifications", async () => {
    const store = new InMemorySharedStateStore();
    const events = [];
    const unsub = store.subscribe("ns1", (agentId) => { events.push(agentId); });
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "t", properties: {}, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    assert.equal(events.length, 1);
    unsub();
    await store.applyDiff("agent-b", "ns1", {
      added_entities: [{ entity_id: "e2", entity_type: "t", properties: {}, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    assert.equal(events.length, 1);
  });

  await t.test("version vector increments per agent", async () => {
    const store = new InMemorySharedStateStore();
    const emptyDiff = { added_entities: [], updated_entities: [], removed_entity_ids: [], added_relations: [], removed_relation_ids: [] };
    await store.applyDiff("agent-a", "ns1", emptyDiff);
    await store.applyDiff("agent-a", "ns1", emptyDiff);
    await store.applyDiff("agent-b", "ns1", emptyDiff);
    const vv = store.getVersionVector("ns1");
    assert.equal(vv["agent-a"], 2);
    assert.equal(vv["agent-b"], 1);
  });

  await t.test("namespace isolation", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "t", properties: { x: 1 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    await store.applyDiff("agent-a", "ns2", {
      added_entities: [{ entity_id: "e2", entity_type: "t", properties: { y: 2 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    const state1 = await store.getState("ns1");
    const state2 = await store.getState("ns2");
    assert.equal(Object.keys(state1).length, 1);
    assert.equal(Object.keys(state2).length, 1);
    assert.deepEqual(state1["e1"], { x: 1 });
    assert.deepEqual(state2["e2"], { y: 2 });
  });

  await t.test("concurrent writes (last-writer-wins)", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "t", properties: { val: "a" }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    await store.applyDiff("agent-b", "ns1", {
      added_entities: [],
      updated_entities: [{ entity_id: "e1", changes: { val: "b" } }],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    const state = await store.getState("ns1");
    assert.deepEqual(state["e1"], { val: "b" });
  });

  await t.test("getState for unknown namespace returns empty", async () => {
    const store = new InMemorySharedStateStore();
    const state = await store.getState("nonexistent");
    assert.deepEqual(state, {});
  });

  await t.test("getVersionVector for unknown namespace returns empty", () => {
    const store = new InMemorySharedStateStore();
    const vv = store.getVersionVector("nonexistent");
    assert.deepEqual(vv, {});
  });

  await t.test("stale version writes record conflict", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "t", properties: { value: 1 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    await store.applyDiff("agent-b", "ns1", {
      added_entities: [],
      updated_entities: [{ entity_id: "e1", changes: { value: 2 } }],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    }, {
      expectedVersionVector: { "agent-a": 0 },
      resolution: "merge"
    });
    const conflicts = store.getConflicts("ns1");
    assert.ok(conflicts.length >= 1);
    assert.ok(conflicts.some((conflict) => conflict.conflict_type === "stale_version"));
  });

  await t.test("last_writer_wins resolution replaces entity body", async () => {
    const store = new InMemorySharedStateStore();
    await store.applyDiff("agent-a", "ns1", {
      added_entities: [{ entity_id: "e1", entity_type: "t", properties: { a: 1, b: 2 }, confidence: 1, last_observed: new Date().toISOString() }],
      updated_entities: [],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    });
    await store.applyDiff("agent-b", "ns1", {
      added_entities: [],
      updated_entities: [{ entity_id: "e1", changes: { b: 9 } }],
      removed_entity_ids: [],
      added_relations: [],
      removed_relation_ids: []
    }, {
      expectedVersionVector: { "agent-a": 1 },
      resolution: "last_writer_wins"
    });
    const state = await store.getState("ns1");
    assert.deepEqual(state["e1"], { b: 9 });
  });
});
