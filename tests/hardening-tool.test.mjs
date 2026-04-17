import assert from "node:assert/strict";
import test from "node:test";
import { ToolGateway } from "@neurocore/runtime-core";

function makeCtx() {
  return {
    tenant_id: "t1",
    session_id: "ses_test",
    cycle_id: "cyc_test"
  };
}

function makeAction(toolName, toolArgs) {
  return {
    action_id: "act_1",
    action_type: "call_tool",
    title: "Test action",
    tool_name: toolName,
    tool_args: toolArgs
  };
}

function makeTool(schema) {
  const invokeCalls = [];
  return {
    name: "test-tool",
    description: "A test tool",
    sideEffectLevel: "none",
    inputSchema: schema,
    invokeCalls,
    async invoke(input) {
      invokeCalls.push(input);
      return { summary: `Called with ${JSON.stringify(input)}` };
    }
  };
}

test("T1: missing required arg returns invalid_action failure, tool.invoke not called", async () => {
  const gw = new ToolGateway();
  const tool = makeTool({
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"]
  });
  gw.register(tool);

  const result = await gw.execute(makeAction("test-tool", {}), makeCtx());
  assert.equal(result.execution.status, "failed");
  assert.ok(result.observation.summary.includes("validation failed"));
  assert.equal(tool.invokeCalls.length, 0);
});

test("T2: type mismatch returns validation errors", async () => {
  const gw = new ToolGateway();
  const tool = makeTool({
    type: "object",
    properties: { count: { type: "number" } },
    required: ["count"]
  });
  gw.register(tool);

  const result = await gw.execute(makeAction("test-tool", { count: "not-a-number" }), makeCtx());
  assert.equal(result.execution.status, "failed");
  assert.ok(result.observation.summary.includes("should be number"));
  assert.equal(tool.invokeCalls.length, 0);
});

test("T3: empty schema ({}) passes validation and invokes tool", async () => {
  const gw = new ToolGateway();
  const tool = makeTool({});
  gw.register(tool);

  const result = await gw.execute(makeAction("test-tool", { foo: "bar" }), makeCtx());
  assert.equal(result.execution.status, "succeeded");
  assert.equal(tool.invokeCalls.length, 1);
});

test("T4: args={} with no required fields passes and invokes", async () => {
  const gw = new ToolGateway();
  const tool = makeTool({
    type: "object",
    properties: { name: { type: "string" } }
  });
  gw.register(tool);

  const result = await gw.execute(makeAction("test-tool", {}), makeCtx());
  assert.equal(result.execution.status, "succeeded");
  assert.equal(tool.invokeCalls.length, 1);
});

test("T5: retry uses exponential backoff delay", async () => {
  const gw = new ToolGateway();
  let callCount = 0;
  const delays = [];

  const originalSetTimeout = globalThis.setTimeout;
  const mockSetTimeout = (fn, ms) => {
    delays.push(ms);
    return originalSetTimeout(fn, 0);
  };
  globalThis.setTimeout = mockSetTimeout;

  try {
    gw.register({
      name: "flaky-tool",
      description: "Fails twice",
      sideEffectLevel: "none",
      inputSchema: {},
      async invoke() {
        callCount++;
        if (callCount <= 2) throw new Error("fail");
        return { summary: "ok" };
      }
    });

    const result = await gw.execute(
      {
        action_id: "act_1",
        action_type: "call_tool",
        title: "Flaky",
        tool_name: "flaky-tool",
        tool_args: {}
      },
      makeCtx(),
      { defaultExecution: { max_retries: 2, retry_backoff_ms: 100 } }
    );

    assert.equal(result.execution.status, "succeeded");
    assert.equal(callCount, 3);
    assert.equal(delays.length, 2);
    assert.ok(delays[0] >= 100, `first delay should be >= 100, got ${delays[0]}`);
    assert.ok(delays[1] >= 200, `second delay should be >= 200 (exponential), got ${delays[1]}`);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("T6: permanent tool errors do not retry", async () => {
  const gw = new ToolGateway();
  let callCount = 0;

  gw.register({
    name: "permanent-tool",
    description: "Always returns permanent client error",
    sideEffectLevel: "none",
    inputSchema: {},
    async invoke() {
      callCount += 1;
      const error = new Error("invalid request");
      error.statusCode = 400;
      throw error;
    }
  });

  const result = await gw.execute(
    makeAction("permanent-tool", {}),
    makeCtx(),
    { defaultExecution: { max_retries: 3 } }
  );

  assert.equal(result.execution.status, "failed");
  assert.equal(callCount, 1);
  assert.equal(result.observation.structured_payload.__execution.final_error.type, "invoke_permanent_error");
  assert.equal(result.observation.structured_payload.__execution.retry_count, 0);
});

test("T7: circuit breaker opens after repeated failures and short-circuits later calls", async () => {
  const gw = new ToolGateway();
  let callCount = 0;

  gw.register({
    name: "breaker-tool",
    description: "Always returns transient server error",
    sideEffectLevel: "none",
    inputSchema: {},
    async invoke() {
      callCount += 1;
      const error = new Error("upstream unavailable");
      error.statusCode = 503;
      throw error;
    }
  });

  const options = {
    defaultExecution: {
      circuit_breaker_failure_threshold: 2,
      circuit_breaker_open_ms: 1000
    }
  };

  const first = await gw.execute(makeAction("breaker-tool", {}), makeCtx(), options);
  const second = await gw.execute(makeAction("breaker-tool", {}), makeCtx(), options);
  const third = await gw.execute(makeAction("breaker-tool", {}), makeCtx(), options);

  assert.equal(first.execution.status, "failed");
  assert.equal(second.execution.status, "failed");
  assert.equal(third.execution.status, "failed");
  assert.equal(callCount, 2);
  assert.equal(third.observation.structured_payload.__execution.final_error.type, "circuit_open");
  assert.equal(third.observation.structured_payload.__execution.circuit_breaker.state, "open");
});

test("T8: circuit breaker half-open probe resets after recovery", async () => {
  const gw = new ToolGateway();
  let callCount = 0;
  let fail = true;
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    gw.register({
      name: "recovery-tool",
      description: "Fails once then recovers",
      sideEffectLevel: "none",
      inputSchema: {},
      async invoke() {
        callCount += 1;
        if (fail) {
          const error = new Error("temporary outage");
          error.statusCode = 503;
          throw error;
        }
        return { summary: "ok" };
      }
    });

    const options = {
      defaultExecution: {
        circuit_breaker_failure_threshold: 1,
        circuit_breaker_open_ms: 1000
      }
    };

    const first = await gw.execute(makeAction("recovery-tool", {}), makeCtx(), options);
    assert.equal(first.execution.status, "failed");

    now += 500;
    const blocked = await gw.execute(makeAction("recovery-tool", {}), makeCtx(), options);
    assert.equal(blocked.observation.structured_payload.__execution.final_error.type, "circuit_open");

    fail = false;
    now += 1000;
    const recovered = await gw.execute(makeAction("recovery-tool", {}), makeCtx(), options);
    assert.equal(recovered.execution.status, "succeeded");
    assert.equal(callCount, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("T9: idempotency_key returns cached tool result within TTL", async () => {
  const gw = new ToolGateway();
  let callCount = 0;
  gw.register({
    name: "cache-tool",
    description: "Cacheable tool",
    sideEffectLevel: "none",
    inputSchema: {},
    async invoke() {
      callCount += 1;
      return { summary: `call-${callCount}`, payload: { callCount } };
    }
  });

  const action = {
    action_id: "act_cache",
    action_type: "call_tool",
    title: "Cache",
    tool_name: "cache-tool",
    tool_args: {},
    idempotency_key: "same-key"
  };

  const first = await gw.execute(action, makeCtx(), {
    defaultExecution: { cache_ttl_ms: 60_000 }
  });
  const second = await gw.execute(action, {
    ...makeCtx(),
    cycle_id: "cyc_test_2"
  }, {
    defaultExecution: { cache_ttl_ms: 60_000 }
  });

  assert.equal(callCount, 1);
  assert.equal(first.observation.summary, "call-1");
  assert.equal(second.observation.summary, "call-1");
  assert.equal(second.observation.structured_payload.__execution.cache_hit, true);
});

test("T10: cache invalidation namespaces clear matching cached tool results", async () => {
  const gw = new ToolGateway();
  let readCount = 0;

  gw.register({
    name: "profile-read",
    description: "Cached profile read",
    sideEffectLevel: "none",
    inputSchema: {},
    execution: {
      cache_namespace: "profile"
    },
    async invoke() {
      readCount += 1;
      return { summary: `profile-${readCount}`, payload: { readCount } };
    }
  });

  gw.register({
    name: "profile-write",
    description: "Mutates profile state",
    sideEffectLevel: "low",
    inputSchema: {},
    execution: {
      invalidate_cache_namespaces: ["profile"]
    },
    async invoke() {
      return { summary: "profile-updated" };
    }
  });

  const readAction = {
    action_id: "act_profile_read",
    action_type: "call_tool",
    title: "Read profile",
    tool_name: "profile-read",
    tool_args: {},
    idempotency_key: "profile-key"
  };

  const first = await gw.execute(readAction, makeCtx(), {
    defaultExecution: { cache_ttl_ms: 60_000 }
  });
  const second = await gw.execute(readAction, {
    ...makeCtx(),
    cycle_id: "cyc_test_2"
  }, {
    defaultExecution: { cache_ttl_ms: 60_000 }
  });
  assert.equal(first.observation.summary, "profile-1");
  assert.equal(second.observation.structured_payload.__execution.cache_hit, true);

  const write = await gw.execute({
    action_id: "act_profile_write",
    action_type: "call_tool",
    title: "Write profile",
    tool_name: "profile-write",
    tool_args: {}
  }, {
    ...makeCtx(),
    cycle_id: "cyc_test_3"
  }, {
    defaultExecution: { cache_ttl_ms: 60_000 }
  });
  assert.deepEqual(
    write.observation.structured_payload.__execution.cache_invalidated_namespaces,
    ["profile"]
  );

  const third = await gw.execute(readAction, {
    ...makeCtx(),
    cycle_id: "cyc_test_4"
  }, {
    defaultExecution: { cache_ttl_ms: 60_000 }
  });

  assert.equal(readCount, 2);
  assert.equal(third.observation.summary, "profile-2");
  assert.equal(third.observation.structured_payload.__execution.cache_hit, undefined);
});
