import assert from "node:assert/strict";
import test from "node:test";
import {
  MockCameraSensor,
  MockSpeakerActuator
} from "@neurocore/device-core";

test("MockCameraSensor lifecycle: start/stop/read", async () => {
  const sensor = new MockCameraSensor("cam-01");
  assert.equal(sensor.descriptor.sensor_id, "cam-01");
  assert.equal(sensor.descriptor.status, "offline");

  await sensor.start();
  assert.equal(sensor.descriptor.status, "online");

  const reading = await sensor.read();
  assert.equal(reading.sensor_id, "cam-01");
  assert.equal(reading.modality, "visual");
  assert.ok(reading.raw_data_ref);
  assert.ok(reading.timestamp);
  assert.equal(reading.confidence, 0.95);
  assert.ok(reading.structured_data);

  await sensor.stop();
  assert.equal(sensor.descriptor.status, "offline");
});

test("MockCameraSensor read throws when not running", async () => {
  const sensor = new MockCameraSensor();
  await assert.rejects(() => sensor.read(), /not running/);
});

test("MockCameraSensor subscribe receives readings", async () => {
  const sensor = new MockCameraSensor();
  await sensor.start();

  const received = [];
  const unsub = sensor.subscribe((reading) => {
    received.push(reading);
  });

  await sensor.read();
  await sensor.read();
  assert.equal(received.length, 2);

  unsub();
  await sensor.read();
  assert.equal(received.length, 2);

  await sensor.stop();
});

test("MockSpeakerActuator lifecycle: initialize/execute/stop", async () => {
  const actuator = new MockSpeakerActuator("spk-01");
  assert.equal(actuator.descriptor.actuator_id, "spk-01");
  assert.equal(actuator.getStatus(), "offline");

  await actuator.initialize();
  assert.equal(actuator.getStatus(), "ready");

  const result = await actuator.execute({
    command_id: "cmd-1",
    actuator_id: "spk-01",
    command_type: "speak",
    parameters: { text: "hello", voice_model_ref: "expressive-v2" }
  });

  assert.equal(result.command_id, "cmd-1");
  assert.equal(result.status, "completed");
  assert.ok(result.duration_ms > 0);
  assert.deepEqual(result.side_effects, ["audio_output"]);
  assert.equal(result.result.text_spoken, "hello");

  await actuator.stop();
  assert.equal(actuator.getStatus(), "offline");
});

test("MockSpeakerActuator execute fails when not initialized", async () => {
  const actuator = new MockSpeakerActuator();
  const result = await actuator.execute({
    command_id: "cmd-1",
    actuator_id: "mock-speaker-01",
    command_type: "speak",
    parameters: { text: "test" }
  });
  assert.equal(result.status, "failed");
  assert.ok(result.error);
});

test("MockSpeakerActuator emergencyStop", async () => {
  const actuator = new MockSpeakerActuator();
  await actuator.initialize();
  assert.equal(actuator.getStatus(), "ready");

  await actuator.emergencyStop();
  assert.equal(actuator.getStatus(), "offline");
});
