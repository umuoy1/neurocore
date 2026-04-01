import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultAgentLifecycleManager,
  InMemoryAgentRegistry,
  LocalInterAgentBus
} from "@neurocore/multi-agent";

test("DefaultAgentLifecycleManager", async (t) => {
  await t.test("spawn registers agent as idle", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    const instanceId = await mgr.spawn("agent-1", "inst-1");
    assert.equal(instanceId, "inst-1");
    const agent = await registry.get("inst-1");
    assert.ok(agent);
    assert.equal(agent.status, "idle");
    await bus.close();
  });

  await t.test("terminate removes agent from registry", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    await mgr.spawn("agent-1", "inst-1");
    await mgr.terminate("inst-1", true);
    const agent = await registry.get("inst-1");
    assert.equal(agent, undefined);
    await bus.close();
  });

  await t.test("drain sets draining status", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    await mgr.spawn("agent-1", "inst-1");
    await mgr.drain("inst-1");
    assert.ok(mgr.isDraining("inst-1"));
    await bus.close();
  });

  await t.test("pause and resume", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    await mgr.spawn("agent-1", "inst-1");
    assert.equal(mgr.isPaused("inst-1"), false);
    await mgr.pause("inst-1");
    assert.equal(mgr.isPaused("inst-1"), true);
    await mgr.resume("inst-1");
    assert.equal(mgr.isPaused("inst-1"), false);
    await bus.close();
  });

  await t.test("terminate nonexistent is noop", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    await mgr.terminate("nonexistent", true);
    await bus.close();
  });

  await t.test("drain nonexistent is noop", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    await mgr.drain("nonexistent");
    await bus.close();
  });

  await t.test("spawn with custom options", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const mgr = new DefaultAgentLifecycleManager(registry, bus);
    await mgr.spawn("agent-1", "inst-1", { max_capacity: 10, heartbeat_interval_ms: 5000 });
    const agent = await registry.get("inst-1");
    assert.equal(agent?.max_capacity, 10);
    assert.equal(agent?.heartbeat_interval_ms, 5000);
    await bus.close();
  });
});
