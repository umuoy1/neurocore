import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, SessionStateConflictError } from "@neurocore/runtime-core";

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
