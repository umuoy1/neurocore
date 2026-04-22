import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { ApiKeyAuthenticator } from "@neurocore/runtime-server";
import { InMemoryEvalStore, SqliteEvalStore } from "@neurocore/runtime-server";
import { Logger } from "@neurocore/runtime-server";
import { createRuntimeServer } from "@neurocore/runtime-server";
import { defineAgent } from "@neurocore/sdk-core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { FileRuntimeStateStore } from "@neurocore/runtime-core";

const echoAgent = defineAgent({
  id: "test-hosted-agent",
  role: "Deterministic hosted productization test agent."
}).useReasoner({
  name: "test-hosted-reasoner",
  async plan(ctx) {
    return [
      {
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "Echo the input back." }
      }
    ];
  },
  async respond(ctx) {
    const input =
      typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
    return [
      {
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Echo",
        description: input,
        side_effect_level: "none"
      }
    ];
  },
  async *streamText(_ctx, action) {
    yield action.description ?? action.title;
  }
});

const observabilityDisabledAgent = defineAgent({
  id: "test-observability-disabled-agent",
  role: "Hosted productization agent with external observability disabled."
}).configureObservability({
  trace_enabled: false,
  event_stream_enabled: false
}).useReasoner({
  name: "test-observability-disabled-reasoner",
  async plan(ctx) {
    return [
      {
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "Echo the input back." }
      }
    ];
  },
  async respond(ctx) {
    const input =
      typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
    return [
      {
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Echo",
        description: input,
        side_effect_level: "none"
      }
    ];
  },
  async *streamText(_ctx, action) {
    yield action.description ?? action.title;
  }
});

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers: options.headers ?? {}
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            json = body;
          }
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test("M6.1: ApiKeyAuthenticator - valid key returns AuthContext", async () => {
  const keys = new Map([
    ["key-abc", { tenant_id: "tenant-1", permissions: ["read", "write"] }]
  ]);
  const auth = new ApiKeyAuthenticator(keys);

  const mockReq = { headers: { authorization: "Bearer key-abc" } };
  const ctx = await auth.authenticate(mockReq);
  assert.ok(ctx);
  assert.equal(ctx.tenant_id, "tenant-1");
  assert.equal(ctx.api_key_id, "key-abc");
  assert.deepEqual(ctx.permissions, ["read", "write"]);
});

test("M6.1: ApiKeyAuthenticator - invalid key returns null", async () => {
  const keys = new Map([
    ["key-abc", { tenant_id: "tenant-1", permissions: [] }]
  ]);
  const auth = new ApiKeyAuthenticator(keys);

  const mockReq = { headers: { authorization: "Bearer wrong-key" } };
  const ctx = await auth.authenticate(mockReq);
  assert.equal(ctx, null);
});

test("M6.1: ApiKeyAuthenticator - X-API-Key header works", async () => {
  const keys = new Map([
    ["key-xyz", { tenant_id: "tenant-2", permissions: ["read"] }]
  ]);
  const auth = new ApiKeyAuthenticator(keys);

  const mockReq = { headers: { "x-api-key": "key-xyz" } };
  const ctx = await auth.authenticate(mockReq);
  assert.ok(ctx);
  assert.equal(ctx.tenant_id, "tenant-2");
});

test("M6.1: ApiKeyAuthenticator - missing header returns null", async () => {
  const keys = new Map([
    ["key-abc", { tenant_id: "tenant-1", permissions: [] }]
  ]);
  const auth = new ApiKeyAuthenticator(keys);

  const mockReq = { headers: {} };
  const ctx = await auth.authenticate(mockReq);
  assert.equal(ctx, null);
});

test("M6.1: Auth middleware - no authenticator means no gating", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  } finally {
    await server.close();
  }
});

test("M6.1: Auth middleware - with authenticator, invalid key returns 401", async () => {
  const keys = new Map([
    ["valid-key", { tenant_id: "t1", permissions: [] }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/sessions`, {
      headers: { authorization: "Bearer bad-key" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "unauthorized");
  } finally {
    await server.close();
  }
});

test("M6.1: Auth middleware - healthz is not gated", async () => {
  const keys = new Map([
    ["valid-key", { tenant_id: "t1", permissions: [] }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  } finally {
    await server.close();
  }
});

test("M11: auth me returns authenticated principal context", async () => {
  const keys = new Map([
    ["key-auth-me", { tenant_id: "tenant-auth", permissions: ["read"], role: "viewer" }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/auth/me`, {
      headers: {
        authorization: "Bearer key-auth-me"
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.tenant_id, "tenant-auth");
    assert.equal(res.body.api_key_id, "key-auth-me");
    assert.deepEqual(res.body.permissions, ["read"]);
    assert.equal(res.body.role, "viewer");
  } finally {
    await server.close();
  }
});

test("M11: session detail endpoints expose memory, goals, world state, devices, and delegations", async () => {
  const keys = new Map([
    ["key-console", { tenant_id: "tenant-console", permissions: ["read", "write"], role: "admin" }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const created = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-console"
      },
      body: JSON.stringify({
        tenant_id: "tenant-console",
        initial_input: { content: "hello console" }
      })
    });
    assert.equal(created.status, 201);
    const sessionId = created.body.session.session_id;

    const [memory, goals, semantic, skills, worldState, devices, delegations] = await Promise.all([
      httpRequest(`${url}/v1/sessions/${sessionId}/memory`, { headers: { authorization: "Bearer key-console" } }),
      httpRequest(`${url}/v1/sessions/${sessionId}/goals`, { headers: { authorization: "Bearer key-console" } }),
      httpRequest(`${url}/v1/sessions/${sessionId}/memory/semantic`, { headers: { authorization: "Bearer key-console" } }),
      httpRequest(`${url}/v1/sessions/${sessionId}/skills`, { headers: { authorization: "Bearer key-console" } }),
      httpRequest(`${url}/v1/sessions/${sessionId}/world-state`, { headers: { authorization: "Bearer key-console" } }),
      httpRequest(`${url}/v1/devices`, { headers: { authorization: "Bearer key-console" } }),
      httpRequest(`${url}/v1/delegations`, { headers: { authorization: "Bearer key-console" } })
    ]);

    assert.equal(memory.status, 200);
    assert.ok(Array.isArray(memory.body.working_memory));
    assert.equal(goals.status, 200);
    assert.ok(Array.isArray(goals.body.goals));
    assert.equal(semantic.status, 200);
    assert.ok(Array.isArray(semantic.body.semantic_memory));
    assert.equal(skills.status, 200);
    assert.ok(Array.isArray(skills.body.skills));
    assert.equal(worldState.status, 200);
    assert.ok(Array.isArray(worldState.body.entities));
    assert.ok(Array.isArray(worldState.body.relations));
    assert.equal(devices.status, 200);
    assert.ok(Array.isArray(devices.body.devices));
    assert.equal(delegations.status, 200);
    assert.ok(Array.isArray(delegations.body.delegations));
  } finally {
    await server.close();
  }
});

test("M11: session list includes persisted sessions after restart", async () => {
  const dir = join(tmpdir(), `neurocore-m11-${randomUUID()}`);
  const makePersistedAgent = () => defineAgent({
    id: "test-hosted-persisted-agent",
    role: "Persisted hosted agent."
  })
    .useRuntimeStateStore(() => new FileRuntimeStateStore({ directory: dir }))
    .useReasoner({
      name: "persisted-hosted-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Return input." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Echo",
          description: typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "",
          side_effect_level: "none"
        }];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });

  const keys = new Map([
    ["key-persisted", { tenant_id: "tenant-persisted", permissions: ["read", "write"], role: "admin" }]
  ]);

  let server = createRuntimeServer({
    agents: [makePersistedAgent()],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const first = await server.listen();
  let sessionId;
  try {
    const created = await httpRequest(`${first.url}/v1/agents/test-hosted-persisted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-persisted"
      },
      body: JSON.stringify({
        tenant_id: "tenant-persisted",
        initial_input: { content: "persist me" }
      })
    });
    assert.equal(created.status, 201);
    sessionId = created.body.session.session_id;
  } finally {
    await server.close();
  }

  server = createRuntimeServer({
    agents: [makePersistedAgent()],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const second = await server.listen();
  try {
    const listed = await httpRequest(`${second.url}/v1/sessions`, {
      headers: {
        authorization: "Bearer key-persisted"
      }
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.sessions.some((session) => session.session_id === sessionId));
  } finally {
    await server.close();
  }
});

test("M6.1: Tenant isolation - session creation with mismatched tenant_id is rejected", async () => {
  const keys = new Map([
    ["key-t1", { tenant_id: "tenant-1", permissions: [] }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-t1"
      },
      body: JSON.stringify({
        tenant_id: "tenant-OTHER",
        initial_input: { content: "hi" }
      })
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "tenant_mismatch");
  } finally {
    await server.close();
  }
});

test("M6.1: Auth middleware - valid key allows session creation", async () => {
  const keys = new Map([
    ["key-t1", { tenant_id: "tenant-1", permissions: [] }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-t1"
      },
      body: JSON.stringify({
        tenant_id: "tenant-1",
        initial_input: { content: "hello" }
      })
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.session);
  } finally {
    await server.close();
  }
});

test("M6.1: WsServer delivers session events over /v1/ws", async () => {
  const keys = new Map([
    ["key-ws", { tenant_id: "tenant-ws", permissions: ["read", "write"] }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();

  try {
    const sessionRes = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-ws"
      },
      body: JSON.stringify({
        tenant_id: "tenant-ws",
        initial_input: { content: "hello ws" }
      })
    });
    assert.equal(sessionRes.status, 201);
    const sessionId = sessionRes.body.session.session_id;
    for (let attempt = 0; attempt < 20; attempt++) {
      const statusRes = await httpRequest(`${url}/v1/sessions/${sessionId}`, {
        headers: {
          authorization: "Bearer key-ws"
        }
      });
      assert.equal(statusRes.status, 200);
      if (!statusRes.body.active_run) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const wsUrl = new URL(url);
    const socket = new WebSocket(`ws://${wsUrl.host}/v1/ws?token=key-ws`, {
      headers: {
        authorization: "Bearer key-ws"
      }
    });

    const eventPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for WS event")), 5000);
      socket.on("message", (chunk) => {
        const message = JSON.parse(String(chunk));
        if (message.type === "event" && message.channel === `session:${sessionId}`) {
          clearTimeout(timer);
          resolve(message.payload);
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const subscribeAck = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for WS subscribe ack")), 5000);
      socket.on("message", (chunk) => {
        const message = JSON.parse(String(chunk));
        if (message.type === "ack" && message.channel === `session:${sessionId}`) {
          clearTimeout(timer);
          resolve(message);
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    await new Promise((resolve, reject) => {
      socket.on("open", resolve);
      socket.on("error", reject);
    });
    socket.send(JSON.stringify({
      type: "subscribe",
      channel: `session:${sessionId}`,
      payload: {},
      message_id: "msg-subscribe",
      timestamp: new Date().toISOString()
    }));
    await subscribeAck;

    const payload = await eventPromise;
    assert.equal(payload.session_id, sessionId);
    socket.close();
  } finally {
    await server.close();
  }
});

test("M6.1: Request-time permission checks reject writes for read-only keys", async () => {
  const keys = new Map([
    ["read-only", { tenant_id: "tenant-1", permissions: ["read"] }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer read-only"
      },
      body: JSON.stringify({
        tenant_id: "tenant-1",
        initial_input: { content: "hi" }
      })
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "insufficient_permissions");
  } finally {
    await server.close();
  }
});

test("M6.2: InMemoryEvalStore - CRUD + list filtering", () => {
  const store = new InMemoryEvalStore();

  const report1 = {
    run_id: "run-1",
    tenant_id: "t1",
    agent_id: "agent-a",
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
    case_count: 1,
    pass_count: 1,
    pass_rate: 1,
    average_score: 1,
    results: []
  };

  const report2 = {
    run_id: "run-2",
    tenant_id: "t2",
    agent_id: "agent-b",
    started_at: "2026-01-02T00:00:00Z",
    ended_at: "2026-01-02T00:01:00Z",
    case_count: 2,
    pass_count: 1,
    pass_rate: 0.5,
    average_score: 0.5,
    results: []
  };

  store.save(report1);
  store.save(report2);

  assert.deepEqual(store.get("run-1"), report1);
  assert.deepEqual(store.get("run-2"), report2);
  assert.equal(store.get("run-missing"), undefined);

  assert.equal(store.list().length, 2);
  assert.equal(store.list({ tenant_id: "t1" }).length, 1);
  assert.equal(store.list({ agent_id: "agent-b" }).length, 1);
  assert.equal(store.list({ limit: 1 }).length, 1);
  assert.equal(store.list({ offset: 1, limit: 1 }).length, 1);

  store.delete("run-1");
  assert.equal(store.get("run-1"), undefined);
  assert.equal(store.list().length, 1);
});

test("M6.2: SqliteEvalStore - CRUD + list filtering + persistence", async () => {
  const filename = join(tmpdir(), `neurocore-test-${randomUUID()}.db`);
  const store = new SqliteEvalStore({ filename });

  try {
    const report1 = {
      run_id: "run-s1",
      tenant_id: "t1",
      agent_id: "agent-a",
      started_at: "2026-01-01T00:00:00Z",
      ended_at: "2026-01-01T00:01:00Z",
      case_count: 1,
      pass_count: 1,
      pass_rate: 1,
      average_score: 1,
      results: []
    };

    const report2 = {
      run_id: "run-s2",
      tenant_id: "t2",
      agent_id: "agent-b",
      started_at: "2026-01-02T00:00:00Z",
      ended_at: "2026-01-02T00:01:00Z",
      case_count: 2,
      pass_count: 1,
      pass_rate: 0.5,
      average_score: 0.5,
      results: []
    };

    store.save(report1);
    store.save(report2);

    assert.deepEqual(store.get("run-s1"), report1);
    assert.deepEqual(store.get("run-s2"), report2);
    assert.equal(store.get("run-missing"), undefined);

    assert.equal(store.list().length, 2);
    assert.equal(store.list({ tenant_id: "t1" }).length, 1);
    assert.equal(store.list({ agent_id: "agent-b" }).length, 1);

    store.delete("run-s1");
    assert.equal(store.get("run-s1"), undefined);

    store.close();

    const store2 = new SqliteEvalStore({ filename });
    try {
      assert.deepEqual(store2.get("run-s2"), report2);
      assert.equal(store2.get("run-s1"), undefined);
    } finally {
      store2.close();
    }
  } finally {
    try {
      const fs = await import("node:fs");
      fs.unlinkSync(filename);
    } catch {}
  }
});

test("M6.2: GET /v1/sessions returns session list", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "hi" } })
    });

    const res = await httpRequest(`${url}/v1/sessions`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sessions));
    assert.ok(res.body.sessions.length >= 1);
  } finally {
    await server.close();
  }
});

test("M6.2: GET /v1/evals/runs returns eval list", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/evals/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "test-hosted-agent",
        cases: [
          {
            case_id: "c1",
            description: "test",
            input: { content: "hi" },
            expectations: { final_state: "completed" }
          }
        ]
      })
    });

    const listRes = await httpRequest(`${url}/v1/evals/runs`);
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.runs));
    assert.ok(listRes.body.runs.length >= 1);
  } finally {
    await server.close();
  }
});

test("M6.2: DELETE /v1/evals/runs/:runId removes eval run", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/evals/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "test-hosted-agent",
        cases: [
          { case_id: "c1", description: "test", input: { content: "hi" }, expectations: { final_state: "completed" } }
        ]
      })
    });
    const runId = createRes.body.run_id;
    assert.ok(runId);

    const delRes = await httpRequest(`${url}/v1/evals/runs/${runId}`, { method: "DELETE" });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.deleted, true);

    const getRes = await httpRequest(`${url}/v1/evals/runs/${runId}`);
    assert.equal(getRes.status, 404);
  } finally {
    await server.close();
  }
});

test("M6.2: GET /v1/approvals returns approval list", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/approvals`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.approvals));
  } finally {
    await server.close();
  }
});

test("M6.3: Logger outputs structured JSON", () => {
  const output = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output.push(chunk);
    return true;
  };

  try {
    const logger = new Logger({ minLevel: "info" });
    logger.info("test message", { key: "value" });
    logger.debug("should be filtered");
    logger.error("error message", { code: 500 });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(output.length, 2);

  const entry1 = JSON.parse(output[0]);
  assert.equal(entry1.level, "info");
  assert.equal(entry1.message, "test message");
  assert.equal(entry1.key, "value");
  assert.ok(entry1.timestamp);

  const entry2 = JSON.parse(output[1]);
  assert.equal(entry2.level, "error");
  assert.equal(entry2.message, "error message");
  assert.equal(entry2.code, 500);
});

test("M6.3: GET /healthz returns enhanced fields", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(typeof res.body.active_sessions, "number");
    assert.equal(typeof res.body.uptime_seconds, "number");
    assert.equal(typeof res.body.version, "string");
  } finally {
    await server.close();
  }
});

test("M6.3: GET /v1/metrics returns metrics", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/metrics`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.total_sessions_created, "number");
    assert.equal(typeof res.body.total_cycles_executed, "number");
    assert.equal(typeof res.body.total_eval_runs, "number");
    assert.equal(typeof res.body.active_sessions, "number");
    assert.equal(typeof res.body.active_sse_connections, "number");
  } finally {
    await server.close();
  }
});

test("M6.3: GET /v1/metrics/prometheus exports Prometheus text format", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "metrics export" } })
    });

    const res = await httpRequest(`${url}/v1/metrics/prometheus`);
    assert.equal(res.status, 200);
    assert.match(res.body, /neurocore_sessions_created_total/);
    assert.match(res.body, /neurocore_cycle_latency_ms/);
  } finally {
    await server.close();
  }
});

test("M6.3: GET /v1/runtime/saturation returns runtime pressure snapshot", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "saturation" } })
    });

    const res = await httpRequest(`${url}/v1/runtime/saturation`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.active_session_count, "number");
    assert.equal(typeof res.body.active_run_ratio, "number");
    assert.equal(typeof res.body.queue_pressure, "number");
    assert.equal(typeof res.body.sessions_per_agent["test-hosted-agent"], "number");
  } finally {
    await server.close();
  }
});

test("M6.3: Runtime server accepts custom logger and tracer", async () => {
  const logs = [];
  const spans = [];
  const logger = {
    debug(message, fields) {
      logs.push({ level: "debug", message, fields });
    },
    info(message, fields) {
      logs.push({ level: "info", message, fields });
    },
    warn(message, fields) {
      logs.push({ level: "warn", message, fields });
    },
    error(message, fields) {
      logs.push({ level: "error", message, fields });
    }
  };
  const tracer = {
    startSpan(name, attributes) {
      const span = { name, attributes: { ...(attributes ?? {}) }, events: [], ended: false, exception: undefined };
      spans.push(span);
      return {
        setAttribute(key, value) {
          span.attributes[key] = value;
        },
        addEvent(name, attributes) {
          span.events.push({ name, attributes });
        },
        recordException(error) {
          span.exception = error instanceof Error ? error.message : String(error);
        },
        end() {
          span.ended = true;
        }
      };
    }
  };
  const server = createRuntimeServer({ agents: [echoAgent], logger, tracer });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/healthz`);
    assert.equal(res.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    await server.close();
  }

  assert.ok(logs.some((entry) => entry.level === "info" && entry.message === "request"));
  assert.ok(spans.some((span) => span.name === "runtime_server.request" && span.ended === true));
});

test("M6.3: trace_enabled and event_stream_enabled gate trace and event APIs", async () => {
  const server = createRuntimeServer({ agents: [observabilityDisabledAgent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-observability-disabled-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "observability gating" } })
    });
    assert.equal(createRes.status, 201);
    const sessionId = createRes.body.session.session_id;

    const tracesRes = await httpRequest(`${url}/v1/sessions/${sessionId}/traces`);
    assert.equal(tracesRes.status, 403);
    assert.equal(tracesRes.body.error, "trace_disabled");

    const eventsRes = await httpRequest(`${url}/v1/sessions/${sessionId}/events`);
    assert.equal(eventsRes.status, 403);
    assert.equal(eventsRes.body.error, "event_stream_disabled");
  } finally {
    await server.close();
  }
});

test("M6.2: GET /v1/sessions/:id/replay returns SessionReplay", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "replay test" } })
    });
    const sessionId = createRes.body.session.session_id;

    const replayRes = await httpRequest(`${url}/v1/sessions/${sessionId}/replay`);
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.session_id, sessionId);
    assert.equal(typeof replayRes.body.cycle_count, "number");
    assert.ok(replayRes.body.cycle_count >= 1);
    assert.ok(Array.isArray(replayRes.body.traces));
  } finally {
    await server.close();
  }
});

test("M6.2: GET /v1/sessions/:id/traces/export supports json and ndjson", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "trace export" } })
    });
    const sessionId = createRes.body.session.session_id;

    const jsonRes = await httpRequest(`${url}/v1/sessions/${sessionId}/traces/export`);
    assert.equal(jsonRes.status, 200);
    assert.equal(jsonRes.body.session_id, sessionId);
    assert.ok(Array.isArray(jsonRes.body.traces));

    const ndjsonRes = await httpRequest(`${url}/v1/sessions/${sessionId}/traces/export?format=ndjson`);
    assert.equal(ndjsonRes.status, 200);
    const entries = typeof ndjsonRes.body === "string"
      ? String(ndjsonRes.body).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [ndjsonRes.body];
    assert.ok(entries.length >= 1);
    const first = entries[0];
    assert.equal(first.trace.session_id, sessionId);
  } finally {
    await server.close();
  }
});

test("P3: Webhook delivery - successful delivery is logged", async () => {
  let webhookReceived = false;
  const webhookServer = http.createServer((req, res) => {
    webhookReceived = true;
    res.writeHead(200);
    res.end();
  });
  await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const whPort = webhookServer.address().port;

  const server = createRuntimeServer({
    agents: [echoAgent],
    webhooks: [{ url: `http://127.0.0.1:${whPort}/hook` }]
  });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "webhook test" } })
    });

    await new Promise((r) => setTimeout(r, 500));
    const logRes = await httpRequest(`${url}/v1/webhooks/deliveries`);
    assert.equal(logRes.status, 200);
    assert.ok(Array.isArray(logRes.body.deliveries));
    const successes = logRes.body.deliveries.filter((d) => d.status === "success");
    assert.ok(successes.length >= 1, "Should have at least one successful delivery");
  } finally {
    await server.close();
    webhookServer.close();
  }
});

test("P3: Webhook delivery - 503 triggers retry then succeeds", async () => {
  let attempts = 0;
  const webhookServer = http.createServer((req, res) => {
    attempts++;
    if (attempts <= 1) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end();
  });
  await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const whPort = webhookServer.address().port;

  const server = createRuntimeServer({
    agents: [echoAgent],
    webhooks: [{ url: `http://127.0.0.1:${whPort}/hook`, event_types: ["session.created"] }]
  });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "retry test" } })
    });

    await new Promise((r) => setTimeout(r, 3000));
    const logRes = await httpRequest(`${url}/v1/webhooks/deliveries`);
    const retried = logRes.body.deliveries.find((d) => d.attempts > 1 && d.status === "success");
    assert.ok(retried, "Should have a retried successful delivery");
  } finally {
    await server.close();
    webhookServer.close();
  }
});

test("P3: Webhook delivery - all retries fail logs failure", async () => {
  const webhookServer = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const whPort = webhookServer.address().port;

  const server = createRuntimeServer({
    agents: [echoAgent],
    webhooks: [{ url: `http://127.0.0.1:${whPort}/hook`, event_types: ["session.created"] }]
  });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "fail test" } })
    });

    await new Promise((r) => setTimeout(r, 10000));
    const logRes = await httpRequest(`${url}/v1/webhooks/deliveries`);
    const failed = logRes.body.deliveries.find((d) => d.status === "failed");
    assert.ok(failed, "Should have a failed delivery record");
    assert.equal(failed.attempts, 3);
  } finally {
    await server.close();
    webhookServer.close();
  }
});

test("P3: Webhook delivery - signature headers are attached when configured", async () => {
  let receivedSignature;
  let receivedTimestamp;
  let receivedBody = "";
  const secret = "top-secret";
  const webhookServer = http.createServer((req, res) => {
    receivedSignature = req.headers["x-neurocore-signature"];
    receivedTimestamp = req.headers["x-neurocore-timestamp"];
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      receivedBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const whPort = webhookServer.address().port;

  const server = createRuntimeServer({
    agents: [echoAgent],
    webhooks: [{
      url: `http://127.0.0.1:${whPort}/hook`,
      event_types: ["session.created"],
      signature_secret: secret
    }]
  });
  const { url } = await server.listen();

  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "signed" } })
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(typeof receivedSignature, "string");
    assert.equal(typeof receivedTimestamp, "string");
    const expected = `sha256=${createHmac("sha256", secret).update(`${receivedTimestamp}.${receivedBody}`).digest("hex")}`;
    assert.equal(receivedSignature, expected);
  } finally {
    await server.close();
    webhookServer.close();
  }
});

test("P3: Webhook delivery - timeout pushes event into DLQ", async () => {
  const webhookServer = http.createServer(() => {});
  await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const whPort = webhookServer.address().port;

  const server = createRuntimeServer({
    agents: [echoAgent],
    webhooks: [{
      url: `http://127.0.0.1:${whPort}/hook`,
      event_types: ["session.created"],
      timeout_ms: 100,
      max_attempts: 2,
      retry_backoff_ms: 20
    }]
  });
  const { url } = await server.listen();
  try {
    await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "timeout dlq" } })
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    const dlqRes = await httpRequest(`${url}/v1/webhooks/dlq`);
    assert.equal(dlqRes.status, 200);
    assert.ok(Array.isArray(dlqRes.body.dead_letters));
    const deadLetter = dlqRes.body.dead_letters.find((record) => record.event_type === "session.created");
    assert.ok(deadLetter);
    assert.equal(deadLetter.attempts, 2);
  } finally {
    await server.close();
    webhookServer.close();
  }
});

test("P3: Batch session creation API returns per-item results", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const res = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        continue_on_error: true,
        sessions: [
          { tenant_id: "t1", initial_input: { content: "batch one" } },
          { tenant_id: "t1", initial_input: {} }
        ]
      })
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.total, 2);
    assert.equal(res.body.succeeded, 1);
    assert.equal(res.body.failed, 1);
    assert.equal(res.body.results.length, 2);
    assert.equal(res.body.results[0].success, true);
    assert.equal(res.body.results[1].success, false);
  } finally {
    await server.close();
  }
});

test("P3: Agent versioning routes sessions to requested version and preserves resume compatibility", async () => {
  const v1 = defineAgent({
    id: "versioned-agent",
    version: "1.0.0",
    role: "v1 agent"
  }).useReasoner({
    name: "versioned-v1",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "v1",
        description: "v1",
        side_effect_level: "none"
      }];
    },
    async *streamText() {
      yield "v1";
    }
  });
  const v2 = defineAgent({
    id: "versioned-agent",
    version: "2.0.0",
    role: "v2 agent"
  }).useReasoner({
    name: "versioned-v2",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "v2",
        description: "v2",
        side_effect_level: "none"
      }];
    },
    async *streamText() {
      yield "v2";
    }
  });

  let server = createRuntimeServer({ agents: [v1, v2] });
  let url;
  try {
    ({ url } = await server.listen());
    const createRes = await httpRequest(`${url}/v1/agents/versioned-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "t1",
        agent_version: "1.0.0",
        initial_input: { content: "hello" }
      })
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.session.agent_version, "1.0.0");

    const sessionId = createRes.body.session.session_id;
    await server.close();

    server = createRuntimeServer({ agents: [v1, v2] });
    ({ url } = await server.listen());
    const sessionRes = await httpRequest(`${url}/v1/sessions/${sessionId}`);
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.body.session.agent_version, "1.0.0");

    const listRes = await httpRequest(`${url}/v1/agents`);
    const versioned = listRes.body.agents.find((entry) => entry.agent_id === "versioned-agent");
    assert.deepEqual(versioned.versions, ["2.0.0", "1.0.0"]);
  } finally {
    await server.close();
  }
});

test("P3: Session sharing enforces viewer, contributor, and approver roles", async () => {
  const keys = new Map([
    ["owner-key", { tenant_id: "tenant-1", permissions: ["read", "write", "approve"], role: "operator" }],
    ["viewer-key", { tenant_id: "tenant-1", permissions: ["read"], role: "viewer" }],
    ["contrib-key", { tenant_id: "tenant-1", permissions: ["read", "write"], role: "operator" }],
    ["approver-key", { tenant_id: "tenant-1", permissions: ["read", "approve"], role: "operator" }]
  ]);
  const server = createRuntimeServer({
    agents: [echoAgent, approvalAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const collaborativeRes = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-key"
      },
      body: JSON.stringify({
        tenant_id: "tenant-1",
        run_immediately: false,
        initial_input: { content: "shared session" }
      })
    });
    assert.equal(collaborativeRes.status, 201);
    const sessionId = collaborativeRes.body.session.session_id;

    await httpRequest(`${url}/v1/sessions/${sessionId}/shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-key"
      },
      body: JSON.stringify({ principal_id: "viewer-key", role: "viewer" })
    });
    await httpRequest(`${url}/v1/sessions/${sessionId}/shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-key"
      },
      body: JSON.stringify({ principal_id: "contrib-key", role: "contributor" })
    });
    await httpRequest(`${url}/v1/sessions/${sessionId}/shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-key"
      },
      body: JSON.stringify({ principal_id: "approver-key", role: "approver" })
    });

    const viewerGet = await httpRequest(`${url}/v1/sessions/${sessionId}`, {
      headers: { authorization: "Bearer viewer-key" }
    });
    assert.equal(viewerGet.status, 200);

    const viewerWrite = await httpRequest(`${url}/v1/sessions/${sessionId}/inputs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer viewer-key"
      },
      body: JSON.stringify({ input: { content: "viewer write" } })
    });
    assert.equal(viewerWrite.status, 403);

    const contributorWrite = await httpRequest(`${url}/v1/sessions/${sessionId}/inputs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer contrib-key"
      },
      body: JSON.stringify({ input: { content: "contributor write" } })
    });
    assert.equal(contributorWrite.status, 200);

    const approvalRes = await httpRequest(`${url}/v1/agents/test-approval-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-key"
      },
      body: JSON.stringify({
        tenant_id: "tenant-1",
        initial_input: { content: "needs approval" }
      })
    });
    assert.equal(approvalRes.status, 201);
    const approvalSessionId = approvalRes.body.session.session_id;
    const approvalId = approvalRes.body.pending_approval.approval_id;
    await httpRequest(`${url}/v1/sessions/${approvalSessionId}/shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-key"
      },
      body: JSON.stringify({ principal_id: "approver-key", role: "approver" })
    });

    const contributorApprove = await httpRequest(`${url}/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer contrib-key"
      },
      body: JSON.stringify({ approver_id: "contrib-key", decision: "approved" })
    });
    assert.equal(contributorApprove.status, 403);

    const approverDecision = await httpRequest(`${url}/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer approver-key"
      },
      body: JSON.stringify({ approver_id: "approver-key", decision: "approved" })
    });
    assert.equal(approverDecision.status, 200);
  } finally {
    await server.close();
  }
});

test("M6.2: GET /v1/sessions/:id/replay/:cycleId returns single cycle record", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-hosted-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "t1", initial_input: { content: "cycle test" } })
    });
    const sessionId = createRes.body.session.session_id;

    const replayRes = await httpRequest(`${url}/v1/sessions/${sessionId}/replay`);
    assert.ok(replayRes.body.traces.length >= 1);
    const firstCycleId = replayRes.body.traces[0].trace.cycle_id;

    const cycleRes = await httpRequest(`${url}/v1/sessions/${sessionId}/replay/${firstCycleId}`);
    assert.equal(cycleRes.status, 200);
    assert.equal(cycleRes.body.trace.cycle_id, firstCycleId);

    const notFoundRes = await httpRequest(`${url}/v1/sessions/${sessionId}/replay/nonexistent`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    await server.close();
  }
});

test("P3: GET /v1/evals/compare returns comparison of two runs", async () => {
  const server = createRuntimeServer({ agents: [echoAgent] });
  const { url } = await server.listen();
  try {
    const runA = await httpRequest(`${url}/v1/evals/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "test-hosted-agent",
        cases: [
          { case_id: "c1", description: "test1", input: { content: "hi" }, expectations: { final_state: "completed" } },
          { case_id: "c2", description: "test2", input: { content: "hello" }, expectations: { final_state: "completed" } }
        ]
      })
    });

    const runB = await httpRequest(`${url}/v1/evals/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "test-hosted-agent",
        cases: [
          { case_id: "c1", description: "test1", input: { content: "hi" }, expectations: { final_state: "completed" } },
          { case_id: "c2", description: "test2", input: { content: "hello" }, expectations: { final_state: "completed" } }
        ]
      })
    });

    const res = await httpRequest(`${url}/v1/evals/compare?run_a=${runA.body.run_id}&run_b=${runB.body.run_id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.run_a_id, runA.body.run_id);
    assert.equal(res.body.run_b_id, runB.body.run_id);
    assert.equal(typeof res.body.pass_rate_delta, "number");
    assert.ok(Array.isArray(res.body.regressions));
    assert.ok(Array.isArray(res.body.improvements));
    assert.ok(Array.isArray(res.body.unchanged));
    assert.ok(res.body.unchanged.length >= 1);
  } finally {
    await server.close();
  }
});

test("P3: Eval comparison - different case sets only compare overlapping", async () => {
  const { compareEvalRuns } = await import("@neurocore/eval-core");

  const reportA = {
    run_id: "a1",
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
    case_count: 2,
    pass_count: 2,
    pass_rate: 1,
    average_score: 1,
    results: [
      { case_id: "c1", description: "t1", passed: true, score: 1, failures: [], observed: {} },
      { case_id: "c-only-a", description: "only a", passed: true, score: 1, failures: [], observed: {} }
    ]
  };

  const reportB = {
    run_id: "b1",
    started_at: "2026-01-02T00:00:00Z",
    ended_at: "2026-01-02T00:01:00Z",
    case_count: 2,
    pass_count: 1,
    pass_rate: 0.5,
    average_score: 0.5,
    results: [
      { case_id: "c1", description: "t1", passed: false, score: 0, failures: ["mismatch"], observed: {} },
      { case_id: "c-only-b", description: "only b", passed: true, score: 1, failures: [], observed: {} }
    ]
  };

  const comparison = compareEvalRuns(reportA, reportB);
  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.regressions[0].case_id, "c1");
  assert.equal(comparison.improvements.length, 0);
  assert.equal(comparison.unchanged.length, 0);
});

const approvalAgent = defineAgent({
  id: "test-approval-agent",
  role: "Agent that triggers approval via high side-effect tool."
}).useReasoner({
  name: "approval-reasoner",
  async plan(ctx) {
    return [
      {
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "Call high-risk tool." }
      }
    ];
  },
  async respond(ctx) {
    return [
      {
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "High risk op",
        tool_name: "risky_op",
        tool_args: {},
        side_effect_level: "high"
      }
    ];
  },
  async *streamText(_ctx, action) {
    yield action.description ?? action.title;
  }
}).registerTool({
  name: "risky_op",
  description: "A high-risk operation.",
  sideEffectLevel: "high",
  inputSchema: { type: "object", properties: {} },
  async invoke() {
    return { summary: "done", payload: {} };
  }
});

function makeApprovalAgent(approvalPolicy) {
  const agent = defineAgent({
    id: "test-approval-policy-agent",
    role: "Agent with approval_policy."
  }).useReasoner({
    name: "approval-policy-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Call high-risk tool." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "High risk op",
          tool_name: "risky_op",
          tool_args: {},
          side_effect_level: "high"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  }).registerTool({
    name: "risky_op",
    description: "A high-risk operation.",
    sideEffectLevel: "high",
    inputSchema: { type: "object", properties: {} },
    async invoke() {
      return { summary: "done", payload: {} };
    }
  });

  if (approvalPolicy) {
    agent.configureApprovalPolicy(approvalPolicy);
  }

  return agent;
}

test("M6.4: Allowed approvers configured - unauthorized approver is rejected", async () => {
  const agent = makeApprovalAgent({ allowed_approvers: ["admin"] });
  const server = createRuntimeServer({ agents: [agent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-approval-policy-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "t1",
        initial_input: { content: "run risky op" }
      })
    });
    assert.equal(createRes.body.session.state, "escalated");
    const pendingApproval = createRes.body.pending_approval;
    assert.ok(pendingApproval);

    const decisionRes = await httpRequest(`${url}/v1/approvals/${pendingApproval.approval_id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approver_id: "unauthorized-user",
        decision: "approved"
      })
    });
    assert.equal(decisionRes.status, 500);
    assert.ok(decisionRes.body.message.includes("not in the allowed approvers list"));
  } finally {
    await server.close();
  }
});

test("M6.4: No allowed_approvers configured - any approver can approve", async () => {
  const agent = makeApprovalAgent();
  const server = createRuntimeServer({ agents: [agent] });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-approval-policy-agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: "t1",
        initial_input: { content: "run risky op" }
      })
    });
    assert.equal(createRes.body.session.state, "escalated");
    const pendingApproval = createRes.body.pending_approval;
    assert.ok(pendingApproval);

    const decisionRes = await httpRequest(`${url}/v1/approvals/${pendingApproval.approval_id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approver_id: "anyone",
        decision: "approved"
      })
    });
    assert.equal(decisionRes.status, 200);
    assert.equal(decisionRes.body.approval.decision, "approved");
  } finally {
    await server.close();
  }
});

test("M6.4: Tenant mismatch in approval decision is rejected", async () => {
  const keys = new Map([
    ["key-t1", { tenant_id: "tenant-1", permissions: [] }],
    ["key-t2", { tenant_id: "tenant-2", permissions: [] }]
  ]);
  const server = createRuntimeServer({
    agents: [approvalAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-approval-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-t1"
      },
      body: JSON.stringify({
        tenant_id: "tenant-1",
        initial_input: { content: "run risky op" }
      })
    });
    assert.equal(createRes.body.session.state, "escalated");
    const pendingApproval = createRes.body.pending_approval;
    assert.ok(pendingApproval);

    const decisionRes = await httpRequest(`${url}/v1/approvals/${pendingApproval.approval_id}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-t2"
      },
      body: JSON.stringify({
        approver_id: "admin",
        decision: "approved"
      })
    });
    assert.equal(decisionRes.status, 403);
    assert.equal(decisionRes.body.error, "tenant_mismatch");
  } finally {
    await server.close();
  }
});

test("M6.4: Approval decisions persist reviewer identity and audit log", async () => {
  const keys = new Map([
    ["key-t1", { tenant_id: "tenant-1", permissions: ["write", "approve", "read"] }]
  ]);
  const server = createRuntimeServer({
    agents: [approvalAgent],
    authenticator: new ApiKeyAuthenticator(keys)
  });
  const { url } = await server.listen();
  try {
    const createRes = await httpRequest(`${url}/v1/agents/test-approval-agent/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-t1"
      },
      body: JSON.stringify({
        tenant_id: "tenant-1",
        initial_input: { content: "run risky op" }
      })
    });
    const pendingApproval = createRes.body.pending_approval;
    assert.ok(pendingApproval);

    const decisionRes = await httpRequest(`${url}/v1/approvals/${pendingApproval.approval_id}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer key-t1"
      },
      body: JSON.stringify({
        approver_id: "admin",
        decision: "approved"
      })
    });
    assert.equal(decisionRes.status, 200);
    assert.equal(decisionRes.body.approval.reviewer_identity.api_key_id, "key-t1");
    assert.equal(decisionRes.body.approval.reviewer_identity.tenant_id, "tenant-1");
    assert.ok(decisionRes.body.approval.reviewer_identity.permissions.includes("approve"));

    const auditRes = await httpRequest(`${url}/v1/audit-logs?action=approval.approved`, {
      headers: {
        authorization: "Bearer key-t1"
      }
    });
    assert.equal(auditRes.status, 200);
    assert.ok(auditRes.body.entries.some((entry) =>
      entry.target_id === pendingApproval.approval_id &&
      entry.details?.reviewer_identity?.api_key_id === "key-t1"
    ));
  } finally {
    await server.close();
  }
});
