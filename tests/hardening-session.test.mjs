import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentRuntime,
  FileRuntimeStateStore,
  SessionManager,
  SessionStateConflictError
} from "@neurocore/runtime-core";

function makeProfile() {
  return {
    agent_id: "test-agent",
    schema_version: "0.1.0",
    name: "Test Agent",
    version: "1.0.0",
    role: "test",
    mode: "embedded",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: { working_memory_enabled: true, episodic_memory_enabled: false, write_policy: "immediate" },
    runtime_config: { max_cycles: 10 }
  };
}

function makeCommand() {
  return {
    tenant_id: "t1",
    user_id: "u1",
    session_mode: "sync",
    initial_input: { input_id: "inp_1", content: "test", created_at: new Date().toISOString() }
  };
}

test("S1: hydrate already-existing session throws Error", () => {
  const mgr = new SessionManager();
  const session = mgr.create(makeProfile(), makeCommand());

  assert.throws(
    () => mgr.hydrate(structuredClone(session)),
    (err) => err instanceof Error && err.message.includes("already exists")
  );
});

test("S2: beginRun on already-running session returns same session", () => {
  const mgr = new SessionManager();
  const session = mgr.create(makeProfile(), makeCommand());
  const run1 = mgr.beginRun(session.session_id);
  assert.equal(run1.state, "running");
  const run2 = mgr.beginRun(session.session_id);
  assert.equal(run2.state, "running");
  assert.equal(run1.session_id, run2.session_id);
});

test("S3: mutation methods update last_active_at", async () => {
  const mgr = new SessionManager();
  const session = mgr.create(makeProfile(), makeCommand());
  mgr.beginRun(session.session_id);
  assert.ok(session.last_active_at, "beginRun should set last_active_at");

  await new Promise((r) => setTimeout(r, 2));
  const beforeCycle = session.last_active_at;
  mgr.setCurrentCycle(session.session_id, "cyc_1");
  assert.notEqual(session.last_active_at, beforeCycle, "setCurrentCycle should update last_active_at");

  await new Promise((r) => setTimeout(r, 2));
  const beforeApproval = session.last_active_at;
  mgr.setApprovalState(session.session_id, "apr_1");
  assert.notEqual(session.last_active_at, beforeApproval, "setApprovalState should update last_active_at");

  await new Promise((r) => setTimeout(r, 2));
  const beforeClear = session.last_active_at;
  mgr.clearApprovalState(session.session_id);
  assert.notEqual(session.last_active_at, beforeClear, "clearApprovalState should update last_active_at");
});

test("S4: session retention metadata drives TTL expiration checks", () => {
  const mgr = new SessionManager();
  const profile = makeProfile();
  profile.runtime_config.session_ttl_ms = 1000;
  profile.runtime_config.session_idle_ttl_ms = 500;
  const session = mgr.create(profile, makeCommand());

  session.last_active_at = new Date(Date.parse(session.started_at) + 100).toISOString();

  const beforeIdleExpiry = mgr.collectExpiredSessionIds(Date.parse(session.started_at) + 400);
  const afterIdleExpiry = mgr.collectExpiredSessionIds(Date.parse(session.started_at) + 700);

  assert.deepEqual(beforeIdleExpiry, []);
  assert.deepEqual(afterIdleExpiry, [session.session_id]);
});

test("S5: LRU eviction candidates respect max_in_memory_sessions", async () => {
  const mgr = new SessionManager();
  const profile = makeProfile();
  profile.runtime_config.max_in_memory_sessions = 2;

  const first = mgr.create(profile, makeCommand());
  await new Promise((r) => setTimeout(r, 2));
  const second = mgr.create(profile, makeCommand());
  await new Promise((r) => setTimeout(r, 2));
  const third = mgr.create(profile, makeCommand());

  first.last_active_at = first.started_at;
  second.last_active_at = second.started_at;
  third.last_active_at = new Date(Date.parse(third.started_at) + 100).toISOString();

  const candidates = mgr.collectLruEvictionSessionIds(new Set([third.session_id]));
  assert.deepEqual(candidates, [first.session_id]);
});

test("S6: AgentRuntime evicts least-recent resident session but can reload it from state store", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-hardening-session-"));
  const stateStore = new FileRuntimeStateStore({ directory: stateDir });
  const runtime = new AgentRuntime({
    stateStore,
    reasoner: {
      name: "session-hardening-reasoner",
      async plan() {
        return [];
      },
      async respond(_ctx) {
        return [
          {
            action_id: "act_1",
            action_type: "respond",
            title: "respond",
            description: "ok",
            side_effect_level: "none"
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    }
  });

  const profile = makeProfile();
  profile.runtime_config.max_in_memory_sessions = 2;

  const session1 = runtime.createSession(profile, makeCommand());
  const session2 = runtime.createSession(profile, makeCommand());
  const session3 = runtime.createSession(profile, makeCommand());

  assert.equal(runtime.sessions.get(session1.session_id), undefined);
  const reloaded = runtime.getSession(session1.session_id);
  assert.ok(reloaded);
  assert.equal(reloaded.session_id, session1.session_id);
  assert.ok(stateStore.getSession(session1.session_id));

  runtime.cleanupSession(session1.session_id, { force: true });
  runtime.cleanupSession(session2.session_id, { force: true });
  runtime.cleanupSession(session3.session_id, { force: true });
});
