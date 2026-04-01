import assert from "node:assert/strict";
import test from "node:test";
import { DefaultPerceptionPipeline } from "@neurocore/device-core";

function ts() {
  return new Date().toISOString();
}

function makeReading(sensorId, modality, data) {
  return {
    sensor_id: sensorId,
    timestamp: ts(),
    modality,
    structured_data: data,
    confidence: 0.9
  };
}

function makeProcessor(name, modalities, transformFn) {
  return {
    name,
    supported_modalities: modalities,
    async process(readings) {
      if (transformFn) return transformFn(readings);
      return readings.map((r, i) => ({
        percept_id: `${name}-percept-${i}`,
        source_sensor_ids: [r.sensor_id],
        modality: r.modality,
        percept_type: `${name}_detection`,
        timestamp: r.timestamp,
        data: r.structured_data ?? {},
        confidence: r.confidence ?? 0.9
      }));
    }
  };
}

test("PerceptionPipeline single processor processes readings", async () => {
  const pipeline = new DefaultPerceptionPipeline();
  pipeline.addProcessor(makeProcessor("visual", ["visual"]));

  const readings = [makeReading("cam-1", "visual", { frame: 1 })];
  const percepts = await pipeline.ingest(readings);

  assert.equal(percepts.length, 1);
  assert.equal(percepts[0].modality, "visual");
  assert.equal(percepts[0].percept_type, "visual_detection");
});

test("PerceptionPipeline multiple processors for different modalities", async () => {
  const pipeline = new DefaultPerceptionPipeline();
  pipeline.addProcessor(makeProcessor("visual", ["visual"]));
  pipeline.addProcessor(makeProcessor("auditory", ["auditory"]));

  const readings = [
    makeReading("cam-1", "visual", { frame: 1 }),
    makeReading("mic-1", "auditory", { text: "hello" })
  ];
  const percepts = await pipeline.ingest(readings);

  assert.equal(percepts.length, 2);
  const modalities = percepts.map((p) => p.modality).sort();
  assert.deepEqual(modalities, ["auditory", "visual"]);
});

test("PerceptionPipeline error isolation: one processor fails, others succeed", async () => {
  const pipeline = new DefaultPerceptionPipeline();
  pipeline.addProcessor(makeProcessor("good", ["visual"]));
  pipeline.addProcessor({
    name: "bad",
    supported_modalities: ["auditory"],
    async process() {
      throw new Error("Processing failed");
    }
  });

  const readings = [
    makeReading("cam-1", "visual", { frame: 1 }),
    makeReading("mic-1", "auditory", { text: "hello" })
  ];
  const percepts = await pipeline.ingest(readings);

  assert.equal(percepts.length, 1);
  assert.equal(percepts[0].modality, "visual");
});

test("PerceptionPipeline timeout protection", async () => {
  const pipeline = new DefaultPerceptionPipeline(50);
  pipeline.addProcessor({
    name: "slow",
    supported_modalities: ["visual"],
    async process() {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [{ percept_id: "p1", source_sensor_ids: ["s1"], modality: "visual", percept_type: "test", timestamp: ts(), data: {}, confidence: 0.9 }];
    }
  });

  const readings = [makeReading("cam-1", "visual", {})];
  const percepts = await pipeline.ingest(readings);

  assert.equal(percepts.length, 0);
});

test("PerceptionPipeline empty readings returns empty", async () => {
  const pipeline = new DefaultPerceptionPipeline();
  pipeline.addProcessor(makeProcessor("visual", ["visual"]));

  const percepts = await pipeline.ingest([]);
  assert.equal(percepts.length, 0);
});

test("PerceptionPipeline removeProcessor", async () => {
  const pipeline = new DefaultPerceptionPipeline();
  pipeline.addProcessor(makeProcessor("visual", ["visual"]));
  pipeline.removeProcessor("visual");

  const readings = [makeReading("cam-1", "visual", {})];
  const percepts = await pipeline.ingest(readings);
  assert.equal(percepts.length, 0);
});
