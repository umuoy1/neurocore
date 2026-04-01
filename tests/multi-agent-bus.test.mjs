import assert from "node:assert/strict";
import test from "node:test";
import { LocalInterAgentBus } from "@neurocore/multi-agent";

function makeMessage(overrides = {}) {
  return {
    message_id: `msg-${Date.now()}-${Math.random()}`,
    correlation_id: `corr-${Date.now()}`,
    trace_id: `trace-${Date.now()}`,
    pattern: "request",
    source_agent_id: "agent-a",
    source_instance_id: "inst-a",
    target_agent_id: "inst-b",
    payload: { data: "hello" },
    created_at: new Date().toISOString(),
    ...overrides
  };
}

test("LocalInterAgentBus", async (t) => {
  await t.test("send → handler → response", async () => {
    const bus = new LocalInterAgentBus();
    bus.registerHandler("inst-b", async (msg) => ({
      ...msg,
      message_id: `resp-${Date.now()}`,
      pattern: "response",
      source_agent_id: "agent-b",
      source_instance_id: "inst-b",
      target_agent_id: msg.source_instance_id,
      payload: { result: "done" }
    }));
    const response = await bus.send(makeMessage());
    assert.equal(response.payload.result, "done");
    assert.equal(response.pattern, "response");
    await bus.close();
  });

  await t.test("send to unknown handler throws", async () => {
    const bus = new LocalInterAgentBus();
    await assert.rejects(
      () => bus.send(makeMessage({ target_agent_id: "nonexistent" })),
      /No handler/
    );
    await bus.close();
  });

  await t.test("send timeout rejects", async () => {
    const bus = new LocalInterAgentBus();
    bus.registerHandler("inst-b", async () => {
      await new Promise((r) => setTimeout(r, 200));
      return undefined;
    });
    await assert.rejects(
      () => bus.send(makeMessage({ ttl_ms: 50 })),
      /timed out/
    );
    await bus.close();
  });

  await t.test("publish → multiple subscribers receive", async () => {
    const bus = new LocalInterAgentBus();
    const received1 = [];
    const received2 = [];
    bus.subscribe("test.topic", async (msg) => { received1.push(msg); });
    bus.subscribe("test.topic", async (msg) => { received2.push(msg); });
    await bus.publish("test.topic", makeMessage({ topic: "test.topic" }));
    assert.equal(received1.length, 1);
    assert.equal(received2.length, 1);
    await bus.close();
  });

  await t.test("publish subscriber failure does not block others", async () => {
    const bus = new LocalInterAgentBus();
    const received = [];
    bus.subscribe("test.topic", async () => { throw new Error("fail"); });
    bus.subscribe("test.topic", async (msg) => { received.push(msg); });
    await bus.publish("test.topic", makeMessage({ topic: "test.topic" }));
    assert.equal(received.length, 1);
    await bus.close();
  });

  await t.test("subscribe/unsubscribe", async () => {
    const bus = new LocalInterAgentBus();
    const received = [];
    const unsub = bus.subscribe("test.topic", async (msg) => { received.push(msg); });
    await bus.publish("test.topic", makeMessage({ topic: "test.topic" }));
    assert.equal(received.length, 1);
    unsub();
    await bus.publish("test.topic", makeMessage({ topic: "test.topic" }));
    assert.equal(received.length, 1);
    await bus.close();
  });

  await t.test("publish to topic with no subscribers is noop", async () => {
    const bus = new LocalInterAgentBus();
    await bus.publish("no.subs", makeMessage({ topic: "no.subs" }));
    await bus.close();
  });

  await t.test("stream data + end", async () => {
    const bus = new LocalInterAgentBus();
    const chunks = [];
    let ended = false;
    bus.registerStream("stream-1", {
      onData: (msg) => { chunks.push(msg.payload); },
      onEnd: () => { ended = true; },
      onError: () => {}
    });
    const stream = await bus.openStream("inst-b", "stream-1");
    stream.write({ chunk: 1 });
    stream.write({ chunk: 2 });
    stream.end();
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks[0], { chunk: 1 });
    assert.deepEqual(chunks[1], { chunk: 2 });
    assert.ok(ended);
    await bus.close();
  });

  await t.test("close rejects pending requests", async () => {
    const bus = new LocalInterAgentBus();
    bus.registerHandler("inst-b", async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return undefined;
    });
    const sendPromise = bus.send(makeMessage({ ttl_ms: 5000 }));
    await bus.close();
    await assert.rejects(sendPromise, /Bus closed/);
  });
});
