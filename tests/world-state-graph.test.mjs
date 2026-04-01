import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWorldStateGraph } from "@neurocore/world-model";

function ts() {
  return new Date().toISOString();
}

test("WorldStateGraph entity CRUD", () => {
  const graph = new InMemoryWorldStateGraph();

  graph.addEntity({
    entity_id: "cup-01",
    entity_type: "object",
    properties: { label: "cup", color: "red" },
    confidence: 0.9,
    last_observed: ts()
  });

  const entity = graph.getEntity("cup-01");
  assert.ok(entity);
  assert.equal(entity.entity_type, "object");
  assert.equal(entity.properties.label, "cup");

  graph.updateEntity("cup-01", { properties: { color: "blue" } });
  const updated = graph.getEntity("cup-01");
  assert.equal(updated.properties.color, "blue");
  assert.equal(updated.properties.label, "cup");

  graph.removeEntity("cup-01");
  assert.equal(graph.getEntity("cup-01"), undefined);
});

test("WorldStateGraph relation CRUD", () => {
  const graph = new InMemoryWorldStateGraph();
  const now = ts();

  graph.addEntity({ entity_id: "a", entity_type: "obj", properties: {}, confidence: 0.9, last_observed: now });
  graph.addEntity({ entity_id: "b", entity_type: "obj", properties: {}, confidence: 0.9, last_observed: now });
  graph.addRelation({
    relation_id: "r1",
    relation_type: "near",
    source_entity_id: "a",
    target_entity_id: "b",
    strength: 0.8,
    confidence: 0.9,
    last_observed: now
  });

  const result = graph.query({ entity_type: "obj" });
  assert.equal(result.entities.length, 2);
  assert.equal(result.relations.length, 1);

  graph.removeRelation("r1");
  const result2 = graph.query({ entity_type: "obj" });
  assert.equal(result2.relations.length, 0);
});

test("WorldStateGraph removeEntity cascades to relations", () => {
  const graph = new InMemoryWorldStateGraph();
  const now = ts();

  graph.addEntity({ entity_id: "a", entity_type: "obj", properties: {}, confidence: 0.9, last_observed: now });
  graph.addEntity({ entity_id: "b", entity_type: "obj", properties: {}, confidence: 0.9, last_observed: now });
  graph.addRelation({
    relation_id: "r1",
    relation_type: "near",
    source_entity_id: "a",
    target_entity_id: "b",
    strength: 0.8,
    confidence: 0.9,
    last_observed: now
  });

  graph.removeEntity("a");
  const result = graph.query({});
  assert.equal(result.entities.length, 1);
  assert.equal(result.relations.length, 0);
});

test("WorldStateGraph query with filters", () => {
  const graph = new InMemoryWorldStateGraph();
  const now = ts();

  graph.addEntity({ entity_id: "e1", entity_type: "person", properties: {}, confidence: 0.9, last_observed: now });
  graph.addEntity({ entity_id: "e2", entity_type: "object", properties: {}, confidence: 0.3, last_observed: now });
  graph.addEntity({ entity_id: "e3", entity_type: "person", properties: {}, confidence: 0.8, last_observed: now });

  const persons = graph.query({ entity_type: "person" });
  assert.equal(persons.entities.length, 2);

  const highConf = graph.query({ min_confidence: 0.5 });
  assert.equal(highConf.entities.length, 2);

  const byId = graph.query({ entity_id: "e2" });
  assert.equal(byId.entities.length, 1);
  assert.equal(byId.entities[0].entity_id, "e2");
});

test("WorldStateGraph applyPercepts creates new entities", () => {
  const graph = new InMemoryWorldStateGraph();

  const diff = graph.applyPercepts([{
    percept_id: "p1",
    source_sensor_ids: ["cam-1"],
    modality: "visual",
    percept_type: "object_detection",
    timestamp: ts(),
    data: { label: "cup", bbox: [10, 20, 30, 40] },
    confidence: 0.95
  }]);

  assert.equal(diff.added_entities.length, 1);
  assert.equal(diff.updated_entities.length, 0);
  assert.equal(diff.added_entities[0].entity_type, "object_detection");

  const snapshot = graph.snapshot();
  assert.equal(snapshot.entities.length, 1);
});

test("WorldStateGraph decayConfidence reduces confidence over time", () => {
  const graph = new InMemoryWorldStateGraph({
    confidence_decay_factor: 0.5,
    confidence_decay_interval_ms: 1000
  });

  const pastTime = new Date(Date.now() - 2000).toISOString();
  graph.addEntity({
    entity_id: "e1",
    entity_type: "obj",
    properties: {},
    confidence: 1.0,
    last_observed: pastTime
  });

  graph.decayConfidence(new Date().toISOString());
  const entity = graph.getEntity("e1");
  assert.ok(entity.confidence < 1.0);
  assert.ok(entity.confidence > 0);
});

test("WorldStateGraph pruneExpired removes old entities", () => {
  const graph = new InMemoryWorldStateGraph({
    default_entity_ttl_ms: 100,
    prune_confidence_threshold: 0.1
  });

  const oldTime = new Date(Date.now() - 200).toISOString();
  graph.addEntity({
    entity_id: "old",
    entity_type: "obj",
    properties: {},
    confidence: 0.9,
    last_observed: oldTime,
    ttl_ms: 100
  });
  graph.addEntity({
    entity_id: "new",
    entity_type: "obj",
    properties: {},
    confidence: 0.9,
    last_observed: ts()
  });

  const pruned = graph.pruneExpired(ts());
  assert.equal(pruned, 1);
  assert.equal(graph.getEntity("old"), undefined);
  assert.ok(graph.getEntity("new"));
});

test("WorldStateGraph pruneExpired removes low confidence entities", () => {
  const graph = new InMemoryWorldStateGraph({
    prune_confidence_threshold: 0.5
  });

  graph.addEntity({
    entity_id: "low",
    entity_type: "obj",
    properties: {},
    confidence: 0.05,
    last_observed: ts()
  });

  const pruned = graph.pruneExpired(ts());
  assert.equal(pruned, 1);
});

test("WorldStateGraph toDigest returns valid digest", () => {
  const graph = new InMemoryWorldStateGraph();

  const emptyDigest = graph.toDigest();
  assert.equal(emptyDigest.summary, "World state: empty");

  graph.addEntity({ entity_id: "e1", entity_type: "person", properties: {}, confidence: 0.9, last_observed: ts() });
  graph.addEntity({ entity_id: "e2", entity_type: "object", properties: {}, confidence: 0.8, last_observed: ts() });

  const digest = graph.toDigest();
  assert.ok(digest.summary.includes("2 entities"));
  assert.ok(typeof digest.uncertainty === "number");
  assert.ok(digest.uncertainty >= 0 && digest.uncertainty <= 1);
});

test("WorldStateGraph snapshot returns deep copy", () => {
  const graph = new InMemoryWorldStateGraph();
  graph.addEntity({ entity_id: "e1", entity_type: "obj", properties: { v: 1 }, confidence: 0.9, last_observed: ts() });

  const snap = graph.snapshot();
  snap.entities[0].properties.v = 999;

  const entity = graph.getEntity("e1");
  assert.equal(entity.properties.v, 1);
});
