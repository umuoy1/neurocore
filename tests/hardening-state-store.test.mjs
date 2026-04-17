import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "@neurocore/runtime-core";

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

test("R1: RuntimeStateStore save errors degrade persistence state without breaking createSession", () => {
  let saveAttempts = 0;
  const stateStore = {
    getSession() {
      return undefined;
    },
    listSessions() {
      return [];
    },
    saveSession() {
      saveAttempts += 1;
      throw new Error("disk full");
    }
  };

  const runtime = new AgentRuntime({
    stateStore,
    reasoner: {
      name: "failing-store-reasoner",
      async plan() {
        return [];
      },
      async respond() {
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

  const session = runtime.createSession(makeProfile(), makeCommand());
  assert.equal(saveAttempts, 1);
  assert.equal(session.metadata.persistence_status.state, "degraded");
  assert.equal(session.metadata.persistence_status.operation, "save_session");

  const events = runtime.listEvents(session.session_id);
  const persistenceStatus = events.find(
    (event) => event.event_type === "runtime.status" && event.payload.summary === "State persistence degraded"
  );
  assert.ok(persistenceStatus);
});
