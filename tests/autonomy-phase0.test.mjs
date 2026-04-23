import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime, FileRuntimeStateStore } from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

function makeProfile() {
  return {
    agent_id: "autonomy-phase0-agent",
    schema_version: "1.0.0",
    name: "Autonomy Phase 0 Agent",
    version: "1.0.0",
    role: "assistant",
    mode: "runtime",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    runtime_config: { max_cycles: 2 }
  };
}

function makeCommand(content = "start autonomy") {
  return {
    agent_id: "autonomy-phase0-agent",
    tenant_id: "tenant_autonomy",
    initial_input: {
      content
    }
  };
}

function makeReasoner() {
  return {
    name: "autonomy-phase0-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: `ok:${typeof ctx.runtime_state.current_input_content === "string" ? ctx.runtime_state.current_input_content : ""}`,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function makeFailureReasoner() {
  return {
    name: "autonomy-phase1-failure-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Fail on unmet precondition",
          tool_name: "echo",
          tool_args: {
            message: "should not execute"
          },
          preconditions: ["tool:missing_tool"],
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function makeAutonomyState(sessionId) {
  const now = ts();
  return {
    schema_version: "1.0.0",
    session_id: sessionId,
    active_plan: {
      plan_id: "plan_autonomy",
      session_id: sessionId,
      title: "Autonomy bootstrap plan",
      summary: "Establish baseline autonomous execution state.",
      status: "active",
      phase: "planning",
      goal_ids: [],
      checkpoints: [],
      contingencies: [],
      created_at: now,
      updated_at: now
    },
    intrinsic_motivation: {
      motivation_id: "mot_1",
      session_id: sessionId,
      curiosity: {
        score: 0.6,
        rationale: "Need more information."
      },
      competence: {
        score: 0.7,
        rationale: "Current skill coverage is acceptable."
      },
      autonomy: {
        score: 0.8,
        rationale: "Runtime can proceed without supervision."
      },
      composite_drive: 0.7,
      exploration_targets: [],
      created_at: now
    },
    suggested_goals: [],
    drift_signals: [],
    recovery_queue: [],
    updated_at: now
  };
}

test("M12 Phase 0: runtime snapshot round-trip preserves autonomy state", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-autonomy-phase0-"));
  try {
    const stateStore = new FileRuntimeStateStore({ directory: stateDir });
    const runtime1 = new AgentRuntime({
      reasoner: makeReasoner(),
      stateStore
    });
    const profile = makeProfile();
    const session = runtime1.createSession(profile, makeCommand());
    const autonomyState = makeAutonomyState(session.session_id);

    runtime1.setAutonomyState(session.session_id, autonomyState);

    const snapshot = stateStore.getSession(session.session_id);
    assert.deepEqual(snapshot?.autonomy_state, autonomyState);

    const runtime2 = new AgentRuntime({
      reasoner: makeReasoner(),
      stateStore: new FileRuntimeStateStore({ directory: stateDir })
    });

    assert.deepEqual(runtime2.getAutonomyState(session.session_id), autonomyState);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("M12 Phase 0: checkpoint restore preserves autonomy state", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeReasoner()
  });
  const profile = makeProfile();
  const session = runtime.createSession(profile, makeCommand());
  const autonomyState = makeAutonomyState(session.session_id);

  runtime.setAutonomyState(session.session_id, autonomyState);
  const checkpoint = runtime.createCheckpoint(session.session_id);

  runtime.cleanupSession(session.session_id, { force: true });
  runtime.restoreSession(checkpoint);

  assert.deepEqual(runtime.getAutonomyState(session.session_id), autonomyState);
});

test("M12 Phase 0: trace records and workspace snapshots carry autonomy state", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeReasoner()
  });
  const profile = makeProfile();
  const session = runtime.createSession(profile, makeCommand("trace autonomy"));
  const autonomyState = makeAutonomyState(session.session_id);

  runtime.setAutonomyState(session.session_id, autonomyState);

  const result = await runtime.runUntilSettled(profile, session.session_id, {
    input_id: "in_autonomy_trace",
    content: "trace autonomy",
    created_at: ts()
  });

  assert.equal(result.finalState, "completed");
  const traceRecords = runtime.getTraceRecords(session.session_id);
  assert.ok(traceRecords.length >= 1);
  assert.equal(traceRecords[0].autonomy_state?.session_id, autonomyState.session_id);
  assert.equal(
    traceRecords[0].autonomy_state?.intrinsic_motivation?.motivation_id,
    autonomyState.intrinsic_motivation.motivation_id
  );
  assert.equal(traceRecords[0].workspace?.autonomy_state?.session_id, autonomyState.session_id);
  assert.equal(
    traceRecords[0].workspace?.autonomy_state?.intrinsic_motivation?.motivation_id,
    autonomyState.intrinsic_motivation.motivation_id
  );
});

test("M12 Phase 1: runtime generates an autonomous plan and injects plan-owned goals", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeReasoner()
  });
  const profile = makeProfile();
  const session = runtime.createSession(profile, makeCommand("plan this work"));
  const events = [];
  const unsubscribe = runtime.subscribeToSessionEvents(session.session_id, (event) => {
    events.push(event);
  });

  try {
    const result = await runtime.runUntilSettled(profile, session.session_id, {
      input_id: "in_autonomy_plan",
      content: "plan this work",
      created_at: ts()
    });

    assert.equal(result.finalState, "completed");
    const autonomyState = runtime.getAutonomyState(session.session_id);
    assert.ok(autonomyState?.active_plan);
    assert.equal(autonomyState?.active_plan?.phases.length, 3);
    assert.ok(autonomyState?.active_plan?.goal_ids.length >= 3);

    const goals = runtime.listGoals(session.session_id);
    const planOwnedGoals = goals.filter((goal) => goal.metadata?.plan_owned === true);
    assert.ok(planOwnedGoals.length >= 3);
    assert.ok(events.some((event) => event.event_type === "plan.generated"));
  } finally {
    unsubscribe();
  }
});

test("M12 Phase 1: failed cycle revises plan into recovery state", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeFailureReasoner()
  });
  const profile = makeProfile();
  const session = runtime.createSession(profile, makeCommand("fail and revise"));
  const events = [];
  const unsubscribe = runtime.subscribeToSessionEvents(session.session_id, (event) => {
    events.push(event);
  });

  try {
    const result = await runtime.runUntilSettled(profile, session.session_id, {
      input_id: "in_autonomy_fail",
      content: "fail and revise",
      created_at: ts()
    });

    assert.equal(result.finalState, "failed");
    const autonomyState = runtime.getAutonomyState(session.session_id);
    assert.equal(autonomyState?.active_plan?.phase, "recovery");
    assert.equal(autonomyState?.last_decision?.decision_type, "revise_plan");
    assert.ok(events.some((event) => event.event_type === "plan.revised"));
    assert.ok(events.some((event) => event.event_type === "plan.status_changed"));
  } finally {
    unsubscribe();
  }
});
