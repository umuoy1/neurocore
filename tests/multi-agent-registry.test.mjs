import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAgentRegistry } from "@neurocore/multi-agent";

function makeDescriptor(overrides = {}) {
  const now = new Date().toISOString();
  return {
    agent_id: "agent-1",
    instance_id: "inst-1",
    name: "Test Agent",
    version: "1.0.0",
    status: "idle",
    capabilities: [{ name: "data_analysis", proficiency: 0.9 }],
    domains: ["analytics"],
    current_load: 0,
    max_capacity: 5,
    heartbeat_interval_ms: 30000,
    last_heartbeat_at: now,
    registered_at: now,
    ...overrides
  };
}

test("InMemoryAgentRegistry", async (t) => {
  await t.test("register and get agent", async () => {
    const registry = new InMemoryAgentRegistry();
    const desc = makeDescriptor();
    await registry.register(desc);
    const found = await registry.get("inst-1");
    assert.equal(found?.agent_id, "agent-1");
    assert.equal(found?.instance_id, "inst-1");
  });

  await t.test("duplicate registration throws", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor());
    await assert.rejects(
      () => registry.register(makeDescriptor()),
      /already registered/
    );
  });

  await t.test("deregister removes agent", async () => {
    const registry = new InMemoryAgentRegistry();
    const deregistered = [];
    registry.onDeregistered((descriptor) => {
      deregistered.push(descriptor.instance_id);
    });
    await registry.register(makeDescriptor());
    await registry.deregister("inst-1");
    const found = await registry.get("inst-1");
    assert.equal(found, undefined);
    assert.deepEqual(deregistered, ["inst-1"]);
  });

  await t.test("listAll returns all agents", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({ instance_id: "inst-1", agent_id: "a1" }));
    await registry.register(makeDescriptor({ instance_id: "inst-2", agent_id: "a2" }));
    await registry.register(makeDescriptor({ instance_id: "inst-3", agent_id: "a3" }));
    const all = await registry.listAll();
    assert.equal(all.length, 3);
  });

  await t.test("discover by capability", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({
      instance_id: "inst-1",
      capabilities: [{ name: "data_analysis", proficiency: 0.9 }]
    }));
    await registry.register(makeDescriptor({
      instance_id: "inst-2",
      capabilities: [{ name: "report_writing", proficiency: 0.8 }]
    }));
    const found = await registry.discover({ capabilities: ["data_analysis"] });
    assert.equal(found.length, 1);
    assert.equal(found[0].instance_id, "inst-1");
  });

  await t.test("discover by domain", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({
      instance_id: "inst-1",
      domains: ["analytics"]
    }));
    await registry.register(makeDescriptor({
      instance_id: "inst-2",
      domains: ["reporting"]
    }));
    const found = await registry.discover({ domains: ["analytics"] });
    assert.equal(found.length, 1);
    assert.equal(found[0].instance_id, "inst-1");
  });

  await t.test("discover by status", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({ instance_id: "inst-1", status: "idle" }));
    await registry.register(makeDescriptor({ instance_id: "inst-2", status: "busy" }));
    const found = await registry.discover({ status: ["idle"] });
    assert.equal(found.length, 1);
    assert.equal(found[0].instance_id, "inst-1");
  });

  await t.test("discover by min_available_capacity", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({
      instance_id: "inst-1",
      current_load: 4,
      max_capacity: 5
    }));
    await registry.register(makeDescriptor({
      instance_id: "inst-2",
      current_load: 0,
      max_capacity: 5
    }));
    const found = await registry.discover({ min_available_capacity: 3 });
    assert.equal(found.length, 1);
    assert.equal(found[0].instance_id, "inst-2");
  });

  await t.test("onStatusChange callback fires", async () => {
    const registry = new InMemoryAgentRegistry();
    const changes = [];
    registry.onStatusChange((desc, prev) => {
      changes.push({ instanceId: desc.instance_id, from: prev, to: desc.status });
    });
    await registry.register(makeDescriptor({ instance_id: "inst-1", heartbeat_interval_ms: 10 }));
    registry.heartbeatMonitor.check();
    assert.equal(changes.length, 0);

    await new Promise((r) => setTimeout(r, 20));
    registry.heartbeatMonitor.check();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].from, "idle");
    assert.equal(changes[0].to, "unreachable");
  });

  await t.test("onRegistered callback fires", async () => {
    const registry = new InMemoryAgentRegistry();
    const registered = [];
    registry.onRegistered((descriptor) => {
      registered.push(descriptor.instance_id);
    });
    await registry.register(makeDescriptor({ instance_id: "inst-1" }));
    assert.deepEqual(registered, ["inst-1"]);
  });

  await t.test("heartbeat resets miss count", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({ instance_id: "inst-1", heartbeat_interval_ms: 10 }));
    await new Promise((r) => setTimeout(r, 20));
    registry.heartbeatMonitor.check();
    const entry = registry.heartbeatMonitor.getEntry("inst-1");
    assert.equal(entry?.miss_count, 1);

    await registry.heartbeat("inst-1");
    const after = registry.heartbeatMonitor.getEntry("inst-1");
    assert.equal(after?.miss_count, 0);
  });

  await t.test("3 misses trigger terminated", async () => {
    const registry = new InMemoryAgentRegistry();
    const changes = [];
    registry.onStatusChange((desc, prev) => {
      changes.push({ from: prev, to: desc.status });
    });
    await registry.register(makeDescriptor({ instance_id: "inst-1", heartbeat_interval_ms: 10 }));
    await new Promise((r) => setTimeout(r, 20));
    registry.heartbeatMonitor.check();
    registry.heartbeatMonitor.check();
    registry.heartbeatMonitor.check();
    const terminated = changes.find((c) => c.to === "terminated");
    assert.ok(terminated, "Should have transitioned to terminated");
  });

  await t.test("heartbeat loss callback fires on miss", async () => {
    const registry = new InMemoryAgentRegistry();
    const losses = [];
    registry.onHeartbeatLost((descriptor, previous) => {
      losses.push({ instanceId: descriptor.instance_id, previous });
    });
    await registry.register(makeDescriptor({ instance_id: "inst-1", heartbeat_interval_ms: 10 }));
    await new Promise((r) => setTimeout(r, 20));
    registry.heartbeatMonitor.check();
    assert.equal(losses.length, 1);
    assert.equal(losses[0].instanceId, "inst-1");
    assert.equal(losses[0].previous, "idle");
  });

  await t.test("heartbeat recovery from unreachable", async () => {
    const registry = new InMemoryAgentRegistry();
    const changes = [];
    registry.onStatusChange((desc, prev) => {
      changes.push({ from: prev, to: desc.status });
    });
    await registry.register(makeDescriptor({ instance_id: "inst-1", heartbeat_interval_ms: 10 }));
    await new Promise((r) => setTimeout(r, 20));
    registry.heartbeatMonitor.check();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].to, "unreachable");

    await registry.heartbeat("inst-1");
    assert.equal(changes.length, 2);
    assert.equal(changes[1].to, "idle");
  });

  await t.test("capability index intersection query", async () => {
    const registry = new InMemoryAgentRegistry();
    await registry.register(makeDescriptor({
      instance_id: "inst-1",
      capabilities: [
        { name: "data_analysis", proficiency: 0.9 },
        { name: "ml", proficiency: 0.8 }
      ]
    }));
    await registry.register(makeDescriptor({
      instance_id: "inst-2",
      capabilities: [{ name: "data_analysis", proficiency: 0.7 }]
    }));
    const found = await registry.discover({ capabilities: ["data_analysis", "ml"] });
    assert.equal(found.length, 1);
    assert.equal(found[0].instance_id, "inst-1");
  });
});
