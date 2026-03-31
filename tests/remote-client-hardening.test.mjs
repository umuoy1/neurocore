import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { connectRemoteAgent } from "@neurocore/sdk-core";

test("P3: Remote client - request timeout throws timeout error", async () => {
  const server = http.createServer((req, res) => {
    // Never respond - simulate hanging server
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const client = connectRemoteAgent({
    agentId: "test-agent",
    baseUrl: `http://127.0.0.1:${port}`,
    requestTimeoutMs: 500,
    maxRetries: 0
  });

  try {
    await client.fetchSession("test-session");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(
      err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("abort"),
      `Expected timeout error, got: ${err.name}: ${err.message}`
    );
  } finally {
    server.close();
  }
});

test("P3: Remote client - retries on 500 then succeeds", async () => {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts++;
    if (attempts <= 1) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server_error", message: "Internal error" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ session: { session_id: "s1", state: "completed" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const client = connectRemoteAgent({
    agentId: "test-agent",
    baseUrl: `http://127.0.0.1:${port}`,
    requestTimeoutMs: 5000,
    maxRetries: 2
  });

  try {
    const result = await client.fetchSession("s1");
    assert.ok(result);
    assert.ok(attempts >= 2, `Expected at least 2 attempts, got ${attempts}`);
  } finally {
    server.close();
  }
});
