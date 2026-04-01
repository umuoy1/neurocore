import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryDeviceRegistry,
  MockCameraSensor,
  MockSpeakerActuator
} from "@neurocore/device-core";

test("DeviceRegistry register and query sensors", () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor = new MockCameraSensor("cam-01");
  registry.registerSensor(sensor);

  const all = registry.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].device_id, "cam-01");
  assert.equal(all[0].device_type, "sensor");

  const found = registry.query({ device_type: "sensor" });
  assert.equal(found.length, 1);

  const byModality = registry.query({ modality: "visual" });
  assert.equal(byModality.length, 1);

  const empty = registry.query({ modality: "auditory" });
  assert.equal(empty.length, 0);
});

test("DeviceRegistry register and query actuators", () => {
  const registry = new InMemoryDeviceRegistry();
  const actuator = new MockSpeakerActuator("spk-01");
  registry.registerActuator(actuator);

  const found = registry.query({ device_type: "actuator" });
  assert.equal(found.length, 1);
  assert.equal(found[0].device_id, "spk-01");

  assert.equal(registry.getActuator("spk-01"), actuator);
  assert.equal(registry.getActuator("nonexistent"), undefined);
});

test("DeviceRegistry duplicate registration throws", () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor = new MockCameraSensor("dev-01");
  registry.registerSensor(sensor);

  assert.throws(() => registry.registerSensor(sensor), /already registered/);
});

test("DeviceRegistry unregister removes device", () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor = new MockCameraSensor("cam-01");
  registry.registerSensor(sensor);

  assert.equal(registry.listAll().length, 1);
  registry.unregister("cam-01");
  assert.equal(registry.listAll().length, 0);
  assert.equal(registry.getSensor("cam-01"), undefined);
});

test("DeviceRegistry hot-plug: register after unregister", () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor1 = new MockCameraSensor("cam-01");
  registry.registerSensor(sensor1);
  registry.unregister("cam-01");

  const sensor2 = new MockCameraSensor("cam-01");
  registry.registerSensor(sensor2);
  assert.equal(registry.getSensor("cam-01"), sensor2);
});

test("DeviceRegistry health check callback on status change", async () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor = new MockCameraSensor("cam-fail");

  registry.registerSensor(sensor);

  const healthChanges = [];
  registry.onHealthChange((deviceId, status, error) => {
    healthChanges.push({ deviceId, status, error });
  });

  registry.startHealthCheck(50);
  await new Promise((resolve) => setTimeout(resolve, 120));
  registry.stopHealthCheck();

  assert.ok(healthChanges.length > 0);
  assert.equal(healthChanges[0].deviceId, "cam-fail");
  assert.ok(["degraded", "unreachable"].includes(healthChanges[0].status));
});

test("DeviceRegistry health check consecutive failure escalation", async () => {
  const registry = new InMemoryDeviceRegistry();
  const sensor = new MockCameraSensor("cam-bad");

  registry.registerSensor(sensor);

  const statuses = [];
  registry.onHealthChange((deviceId, status) => {
    statuses.push(status);
  });

  registry.startHealthCheck(30);
  await new Promise((resolve) => setTimeout(resolve, 250));
  registry.stopHealthCheck();

  const hasUnreachable = statuses.includes("unreachable");
  assert.ok(hasUnreachable, `Expected escalation to unreachable, got: ${statuses.join(", ")}`);
});
