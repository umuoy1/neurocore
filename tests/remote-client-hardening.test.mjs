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

test("P3: Remote client - retries on 429 then succeeds", async () => {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts++;
    if (attempts <= 1) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rate_limited", message: "Too many requests" }));
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

test("P3: Remote client - SSE reconnect sends Last-Event-ID and resumes stream", async () => {
  const headersSeen = [];
  const received = [];
  let streamCount = 0;

  const server = http.createServer((req, res) => {
    if (req.url !== "/v1/sessions/s1/events/stream") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", message: "missing route" }));
      return;
    }

    streamCount += 1;
    headersSeen.push(req.headers["last-event-id"] ?? null);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache"
    });

    const event =
      streamCount === 1
        ? {
            event_id: "evt_1",
            event_type: "session.created",
            schema_version: "1.0.0",
            tenant_id: "tenant",
            session_id: "s1",
            cycle_id: undefined,
            sequence_no: 1,
            timestamp: new Date().toISOString(),
            payload: { session_id: "s1", state: "waiting" }
          }
        : {
            event_id: "evt_2",
            event_type: "session.completed",
            schema_version: "1.0.0",
            tenant_id: "tenant",
            session_id: "s1",
            cycle_id: undefined,
            sequence_no: 2,
            timestamp: new Date().toISOString(),
            payload: { session_id: "s1", state: "completed" }
          };

    res.write(`id: ${event.event_id}\n`);
    res.write(`event: ${event.event_type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    setTimeout(() => res.end(), 10);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const client = connectRemoteAgent({
    agentId: "test-agent",
    baseUrl: `http://127.0.0.1:${port}`,
    requestTimeoutMs: 5000,
    maxRetries: 1
  });

  const subscription = await client.subscribeToSessionEvents(
    "s1",
    (event) => {
      received.push(event);
    },
    {
      reconnect: true,
      maxReconnects: 1
    }
  );

  try {
    const timeoutAt = Date.now() + 3000;
    while (received.length < 2 && Date.now() < timeoutAt) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(received.length, 2);
    assert.equal(received[0].event_id, "evt_1");
    assert.equal(received[1].event_id, "evt_2");
    assert.equal(headersSeen[0], null);
    assert.equal(headersSeen[1], "evt_1");
  } finally {
    subscription.close();
    await subscription.done;
    server.close();
  }
});
