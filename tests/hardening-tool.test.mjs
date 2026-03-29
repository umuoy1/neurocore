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
