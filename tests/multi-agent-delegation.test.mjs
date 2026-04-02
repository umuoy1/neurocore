import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultTaskDelegator,
  InMemoryAgentRegistry,
  LocalInterAgentBus,
  CapabilityBasedMatcher,
  LoadBalancedAssigner,
  CostAwareSelector
} from "@neurocore/multi-agent";

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

function makeRequest(overrides = {}) {
  return {
    delegation_id: `del-${Date.now()}`,
    source_agent_id: "agent-a",
    source_session_id: "ses-1",
    source_cycle_id: "cyc-1",
    source_goal_id: "goal-1",
    mode: "unicast",
    target_agent_id: "inst-b",
    goal: {
      title: "Test Task",
      goal_type: "task",
      priority: 1
    },
    timeout_ms: 5000,
    max_depth: 3,
    current_depth: 0,
    created_at: new Date().toISOString(),
    ...overrides
  };
}

test("DefaultTaskDelegator", async (t) => {
  await t.test("unicast success", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    await registry.register(makeDescriptor({ instance_id: "inst-b", agent_id: "agent-b" }));
    bus.registerHandler("inst-b", async (msg) => ({
      ...msg,
      message_id: "resp-1",
      pattern: "response",
      source_agent_id: "agent-b",
      source_instance_id: "inst-b",
      target_agent_id: msg.source_instance_id,
      payload: { result: { status: "success", summary: "Done" } }
    }));
    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest());
    assert.equal(response.status, "completed");
    await bus.close();
  });

  await t.test("unicast to unavailable agent returns rejected", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    await registry.register(makeDescriptor({
      instance_id: "inst-b",
      agent_id: "agent-b",
      status: "terminated"
    }));
    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest());
    assert.equal(response.status, "rejected");
    await bus.close();
  });

  await t.test("unicast without target_agent_id returns rejected", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest({ target_agent_id: undefined }));
    assert.equal(response.status, "rejected");
    await bus.close();
  });

  await t.test("depth exceeded returns rejected", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest({ current_depth: 3, max_depth: 3 }));
    assert.equal(response.status, "rejected");
    assert.ok(response.error?.includes("depth"));
    await bus.close();
  });

  await t.test("broadcast first acceptor wins", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    await registry.register(makeDescriptor({
      instance_id: "inst-b",
      agent_id: "agent-b",
      capabilities: [{ name: "data_analysis", proficiency: 0.8 }]
    }));
    await registry.register(makeDescriptor({
      instance_id: "inst-c",
      agent_id: "agent-c",
      capabilities: [{ name: "data_analysis", proficiency: 0.9 }]
    }));
    bus.registerHandler("inst-b", async (msg) => ({
      ...msg,
      message_id: "resp-b",
      pattern: "response",
      source_agent_id: "agent-b",
      source_instance_id: "inst-b",
      target_agent_id: msg.source_instance_id,
      payload: { result: { status: "success", summary: "B done" } }
    }));
    bus.registerHandler("inst-c", async (msg) => ({
      ...msg,
      message_id: "resp-c",
      pattern: "response",
      source_agent_id: "agent-c",
      source_instance_id: "inst-c",
      target_agent_id: msg.source_instance_id,
      payload: { result: { status: "success", summary: "C done" } }
    }));
    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest({
      mode: "broadcast",
      target_agent_id: undefined,
      target_capabilities: ["data_analysis"]
    }));
    assert.equal(response.status, "completed");
    assert.ok(response.assigned_agent_id);
    await bus.close();
  });

  await t.test("broadcast with no candidates returns rejected", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest({
      mode: "broadcast",
      target_agent_id: undefined,
      target_capabilities: ["nonexistent"]
    }));
    assert.equal(response.status, "rejected");
    await bus.close();
  });

  await t.test("auction executes selected winner", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();

    await registry.register(makeDescriptor({
      instance_id: "inst-b",
      agent_id: "agent-b",
      capabilities: [{ name: "data_analysis", proficiency: 0.75 }]
    }));
    await registry.register(makeDescriptor({
      instance_id: "inst-c",
      agent_id: "agent-c",
      capabilities: [{ name: "data_analysis", proficiency: 0.95 }]
    }));

    bus.registerHandler("inst-b", async (msg) => {
      if (msg.payload.type === "auction_request") {
        return {
          ...msg,
          message_id: "resp-auction-b",
          pattern: "response",
          source_agent_id: "agent-b",
          source_instance_id: "inst-b",
          target_agent_id: msg.source_instance_id,
          payload: {
            bid: {
              agent_id: "agent-b",
              instance_id: "inst-b",
              estimated_duration_ms: 3000,
              estimated_cost: 0.05,
              confidence: 0.7
            }
          }
        };
      }

      return {
        ...msg,
        message_id: "resp-b",
        pattern: "response",
        source_agent_id: "agent-b",
        source_instance_id: "inst-b",
        target_agent_id: msg.source_instance_id,
        payload: {
          response: {
            delegation_id: msg.correlation_id,
            status: "completed",
            assigned_agent_id: "agent-b",
            assigned_instance_id: "inst-b",
            result: {
              status: "success",
              summary: "B done"
            }
          }
        }
      };
    });

    bus.registerHandler("inst-c", async (msg) => {
      if (msg.payload.type === "auction_request") {
        return {
          ...msg,
          message_id: "resp-auction-c",
          pattern: "response",
          source_agent_id: "agent-c",
          source_instance_id: "inst-c",
          target_agent_id: msg.source_instance_id,
          payload: {
            bid: {
              agent_id: "agent-c",
              instance_id: "inst-c",
              estimated_duration_ms: 1500,
              estimated_cost: 0.03,
              confidence: 0.95
            }
          }
        };
      }

      return {
        ...msg,
        message_id: "resp-c",
        pattern: "response",
        source_agent_id: "agent-c",
        source_instance_id: "inst-c",
        target_agent_id: msg.source_instance_id,
        payload: {
          response: {
            delegation_id: msg.correlation_id,
            status: "completed",
            assigned_agent_id: "agent-c",
            assigned_instance_id: "inst-c",
            result: {
              status: "success",
              summary: "C done"
            }
          }
        }
      };
    });

    const delegator = new DefaultTaskDelegator(registry, bus);
    const response = await delegator.delegate(makeRequest({
      mode: "auction",
      target_agent_id: undefined,
      target_capabilities: ["data_analysis"]
    }));

    assert.equal(response.status, "completed");
    assert.equal(response.assigned_agent_id, "agent-c");
    assert.equal(response.selected_bid?.agent_id, "agent-c");
    assert.equal(response.result?.summary, "C done");
    await bus.close();
  });

  await t.test("cancel does not throw", async () => {
    const registry = new InMemoryAgentRegistry();
    const bus = new LocalInterAgentBus();
    const delegator = new DefaultTaskDelegator(registry, bus);
    await delegator.cancel("del-1");
    await bus.close();
  });
});

test("CapabilityBasedMatcher", async (t) => {
  await t.test("filters and sorts by proficiency", () => {
    const matcher = new CapabilityBasedMatcher();
    const agents = [
      makeDescriptor({ instance_id: "a", capabilities: [{ name: "ml", proficiency: 0.7 }] }),
      makeDescriptor({ instance_id: "b", capabilities: [{ name: "ml", proficiency: 0.95 }] }),
      makeDescriptor({ instance_id: "c", capabilities: [{ name: "nlp", proficiency: 0.9 }] })
    ];
    const result = matcher.match(["ml"], agents);
    assert.equal(result.length, 2);
    assert.equal(result[0].instance_id, "b");
    assert.equal(result[1].instance_id, "a");
  });

  await t.test("returns empty when no match", () => {
    const matcher = new CapabilityBasedMatcher();
    const agents = [
      makeDescriptor({ instance_id: "a", capabilities: [{ name: "nlp", proficiency: 0.9 }] })
    ];
    const result = matcher.match(["ml"], agents);
    assert.equal(result.length, 0);
  });
});

test("LoadBalancedAssigner", async (t) => {
  await t.test("selects least loaded agent", () => {
    const assigner = new LoadBalancedAssigner();
    const agents = [
      makeDescriptor({ instance_id: "a", current_load: 3, max_capacity: 5 }),
      makeDescriptor({ instance_id: "b", current_load: 0, max_capacity: 5 }),
      makeDescriptor({ instance_id: "c", current_load: 4, max_capacity: 5 })
    ];
    const result = assigner.assign(agents);
    assert.equal(result?.instance_id, "b");
  });

  await t.test("filters full capacity agents", () => {
    const assigner = new LoadBalancedAssigner();
    const agents = [
      makeDescriptor({ instance_id: "a", current_load: 5, max_capacity: 5 })
    ];
    const result = assigner.assign(agents);
    assert.equal(result, undefined);
  });
});

test("CostAwareSelector", async (t) => {
  await t.test("selects best scoring bid", () => {
    const selector = new CostAwareSelector();
    const bids = [
      { agent_id: "a", instance_id: "inst-a", estimated_duration_ms: 5000, estimated_cost: 0.05, confidence: 0.8, },
      { agent_id: "b", instance_id: "inst-b", estimated_duration_ms: 3000, estimated_cost: 0.03, confidence: 0.9, },
      { agent_id: "c", instance_id: "inst-c", estimated_duration_ms: 8000, estimated_cost: 0.08, confidence: 0.6, }
    ];
    const weights = { duration: 0.3, cost: 0.3, confidence: 0.4 };
    const result = selector.select(bids, weights);
    assert.equal(result?.agent_id, "b");
  });

  await t.test("returns undefined for empty bids", () => {
    const selector = new CostAwareSelector();
    const result = selector.select([], { duration: 0.3, cost: 0.3, confidence: 0.4 });
    assert.equal(result, undefined);
  });
});
