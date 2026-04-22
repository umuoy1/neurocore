import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfidenceWeightedFusionStrategy,
  DefaultActuatorOrchestrator,
  InMemoryDeviceRegistry,
  MockSpeakerActuator
} from "@neurocore/device-core";

function percept(id, overrides = {}) {
  return {
    percept_id: id,
    source_sensor_ids: [`sensor-${id}`],
    modality: "visual",
    percept_type: "object_detection",
    timestamp: new Date().toISOString(),
    data: { label: "cup" },
    confidence: 0.5,
    ...overrides
  };
}

function command(id, actuatorId, overrides = {}) {
  return {
    command_id: id,
    actuator_id: actuatorId,
    command_type: "speak",
    parameters: { text: `message-${id}` },
    ...overrides
  };
}

test("ConfidenceWeightedFusionStrategy merges same-object percepts", async () => {
  const strategy = new ConfidenceWeightedFusionStrategy();
  const fused = await strategy.fuse([
    percept("1", {
      confidence: 0.9,
      source_sensor_ids: ["cam-a"],
      spatial_ref: { x: 1, y: 2, frame: "world" }
    }),
    percept("2", {
      confidence: 0.6,
      source_sensor_ids: ["cam-b"],
      spatial_ref: { x: 3, y: 4, frame: "world" }
    })
  ]);

  assert.equal(fused.length, 1);
  assert.deepEqual(fused[0].source_sensor_ids.sort(), ["cam-a", "cam-b"]);
  assert.equal(fused[0].data.label, "cup");
  assert.equal(fused[0].data.fused_count, 2);
  assert.ok(fused[0].confidence > 0.7);
  assert.equal(fused[0].metadata.fused, true);
});

test("ConfidenceWeightedFusionStrategy keeps distinct percepts separate", async () => {
  const strategy = new ConfidenceWeightedFusionStrategy();
  const fused = await strategy.fuse([
    percept("1", { data: { label: "cup" } }),
    percept("2", { data: { label: "bottle" } })
  ]);

  assert.equal(fused.length, 2);
});

test("DefaultActuatorOrchestrator runs commands serially", async () => {
  const registry = new InMemoryDeviceRegistry();
  const speaker = new MockSpeakerActuator("speaker-1");
  await speaker.initialize();
  registry.registerActuator(speaker);

  const orchestrator = new DefaultActuatorOrchestrator();
  const results = await orchestrator.execute([
    command("1", "speaker-1"),
    command("2", "speaker-1")
  ], registry, "serial");

  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.status === "completed"));
});

test("DefaultActuatorOrchestrator runs commands in parallel", async () => {
  const registry = new InMemoryDeviceRegistry();
  const speakerA = new MockSpeakerActuator("speaker-a");
  const speakerB = new MockSpeakerActuator("speaker-b");
  await speakerA.initialize();
  await speakerB.initialize();
  registry.registerActuator(speakerA);
  registry.registerActuator(speakerB);

  const orchestrator = new DefaultActuatorOrchestrator();
  const results = await orchestrator.execute([
    command("1", "speaker-a"),
    command("2", "speaker-b")
  ], registry, "parallel");

  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.status === "completed"));
});

test("DefaultActuatorOrchestrator returns failed result for unknown actuator", async () => {
  const registry = new InMemoryDeviceRegistry();
  const orchestrator = new DefaultActuatorOrchestrator();
  const results = await orchestrator.execute([
    command("1", "missing-actuator")
  ], registry, "serial");

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.match(results[0].error, /Unknown actuator/);
});
