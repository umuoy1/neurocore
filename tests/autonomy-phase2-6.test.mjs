import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

function makeProfile(overrides = {}) {
  return {
    agent_id: "autonomy-phase2-agent",
    schema_version: "1.0.0",
    name: "Autonomy Phase 2 Agent",
    version: "1.0.0",
    role: "assistant",
    mode: "runtime",
    domain: "research.analysis",
    tool_refs: [],
    skill_refs: ["skill.search", "skill.summarize"],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    runtime_config: { max_cycles: 2 },
    autonomy_config: {
      enabled: true,
      planner_enabled: true,
      monitor_enabled: true,
      self_goal_enabled: true,
      transfer_enabled: true,
      continual_learning_enabled: true,
      goal_value_threshold: 0.2,
      goal_feasibility_threshold: 0.2,
      alignment: {
        allow_self_generated_goals: true,
        high_risk_self_goal_requires_approval: true,
        max_concurrent_self_goals: 2,
        allow_autonomous_recovery: true,
        shutdown_responsive: true
      }
    },
    ...overrides
  };
}

function makeCommand(content = "start autonomy maintenance") {
  return {
    agent_id: "autonomy-phase2-agent",
    tenant_id: "tenant_autonomy",
    initial_input: {
      content
    }
  };
}

function makeInput(content = "continue autonomy") {
  return {
    input_id: `in_${Math.random().toString(36).slice(2)}`,
    content,
    created_at: ts()
  };
}

function makeFailureReasoner() {
  return {
    name: "autonomy-phase2-failure-reasoner",
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
          preconditions: ["tool:missing_tool:registered=true"],
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function makeAutonomyAwareReasoner(captured) {
  return {
    name: "autonomy-phase5-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      captured.runtimeState = structuredClone(ctx.runtime_state);
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Report autonomy state",
          description: [
            ctx.runtime_state.autonomy_current_phase,
            ctx.runtime_state.autonomy_health_status
          ].filter(Boolean).join(":") || "missing"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function makeTraceReasoner() {
  return {
    name: "autonomy-phase6-trace-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Trigger recovery and maintenance",
          tool_name: "echo",
          tool_args: {
            message: "trace maintenance"
          },
          preconditions: ["tool:missing_tool:registered=true"],
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function completeRootGoal(runtime, sessionId) {
  const root = runtime.listGoals(sessionId).find((goal) => goal.metadata?.root_goal === true);
  assert.ok(root);
  runtime.goals.updateStatus(sessionId, root.goal_id, "completed");
}

test("M12 Phase 2: self monitor emits health, drift, and recovery artifacts", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeFailureReasoner()
  });
  const profile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: true,
      self_goal_enabled: false,
      transfer_enabled: false,
      continual_learning_enabled: false,
      alignment: {
        allow_autonomous_recovery: true,
        shutdown_responsive: true
      }
    }
  });
  const session = runtime.createSession(profile, makeCommand("monitor this"));
  const result = await runtime.runOnce(profile, session.session_id, makeInput("monitor this"));

  assert.ok(["waiting", "aborted", "completed"].includes(result.sessionState));
  const autonomyState = runtime.getAutonomyState(session.session_id);
  assert.ok(autonomyState?.health_report);
  assert.ok(autonomyState?.drift_signals?.length);
  assert.ok(autonomyState?.recovery_queue?.length);
  const goals = runtime.listGoals(session.session_id);
  assert.ok(goals.some((goal) => goal.goal_type === "recovery"));
  const events = runtime.listEvents(session.session_id).map((event) => event.event_type);
  assert.ok(events.includes("health.report"));
  assert.ok(events.includes("drift.detected"));
  assert.ok(events.includes("recovery.triggered"));
});

test("M12 Phase 3: self-generated goals are filtered and injected under governance", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeFailureReasoner()
  });
  const profile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: false,
      self_goal_enabled: true,
      transfer_enabled: false,
      continual_learning_enabled: false,
      goal_value_threshold: 0.2,
      goal_feasibility_threshold: 0.2,
      alignment: {
        allow_self_generated_goals: true,
        high_risk_self_goal_requires_approval: true,
        max_concurrent_self_goals: 2,
        shutdown_responsive: true
      }
    }
  });
  const session = runtime.createSession(profile, makeCommand("generate goals"));
  completeRootGoal(runtime, session.session_id);

  const result = await runtime.runOnce(profile, session.session_id, makeInput("generate goals"));
  assert.equal(result.sessionState, "waiting");
  const autonomyState = runtime.getAutonomyState(session.session_id);
  assert.ok(autonomyState?.intrinsic_motivation);
  assert.ok(autonomyState?.suggested_goals?.length);
  assert.ok(autonomyState?.suggested_goals?.some((goal) => goal.status === "accepted"));
  const goals = runtime.listGoals(session.session_id);
  assert.ok(goals.some((goal) => goal.owner === "agent" && goal.metadata?.self_generated === true));
  const events = runtime.listEvents(session.session_id).map((event) => event.event_type);
  assert.ok(events.includes("motivation.computed"));
  assert.ok(events.includes("goal.self_generated"));
});

test("M12 Phase 4: transfer and continual learning update autonomy state", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeFailureReasoner()
  });
  const profile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: false,
      self_goal_enabled: false,
      transfer_enabled: true,
      continual_learning_enabled: true,
      alignment: {
        shutdown_responsive: true
      }
    }
  });
  const session = runtime.createSession(profile, makeCommand("transfer and learn"));

  const result = await runtime.runOnce(profile, session.session_id, makeInput("transfer and learn"));
  assert.equal(result.sessionState, "waiting");
  const autonomyState = runtime.getAutonomyState(session.session_id);
  assert.ok(autonomyState?.latest_transfer);
  assert.ok(autonomyState?.latest_knowledge_snapshot);
  assert.ok(autonomyState?.performance_baseline);
  assert.ok(autonomyState?.curriculum_stage);
  const events = runtime.listEvents(session.session_id).map((event) => event.event_type);
  assert.ok(events.includes("transfer.attempted"));
  assert.ok(events.includes("transfer.validated"));
  assert.ok(events.includes("consolidation.completed"));
});

test("M12 Phase 5: cycle runtime state exposes autonomy features to reasoning", async () => {
  const captured = {};
  const runtime = new AgentRuntime({
    reasoner: makeAutonomyAwareReasoner(captured)
  });
  const profile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: false,
      self_goal_enabled: false,
      transfer_enabled: false,
      continual_learning_enabled: false,
      alignment: {
        shutdown_responsive: true
      }
    }
  });
  const session = runtime.createSession(profile, makeCommand("use autonomy state"));
  runtime.setAutonomyState(session.session_id, {
    schema_version: profile.schema_version,
    session_id: session.session_id,
    active_plan: {
      plan_id: "plan_phase5",
      session_id: session.session_id,
      title: "Phase 5 plan",
      summary: "Drive long-horizon execution.",
      status: "active",
      phase: "execution",
      phases: [],
      goal_ids: [],
      checkpoints: [],
      contingencies: [],
      created_at: ts(),
      updated_at: ts()
    },
    health_report: {
      report_id: "hrp_phase5",
      session_id: session.session_id,
      overall_status: "degraded",
      modules: [],
      summary: "degraded",
      created_at: ts()
    },
    updated_at: ts()
  });

  const result = await runtime.runOnce(profile, session.session_id, makeInput("use autonomy state"));
  assert.equal(result.sessionState, "completed");
  assert.equal(captured.runtimeState.autonomy_current_phase, "execution");
  assert.equal(captured.runtimeState.autonomy_health_status, "degraded");
  assert.equal(result.outputText, "execution:degraded");
});

test("M12 Phase 6: policy can block plan adoption and self-generated goals", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeFailureReasoner(),
    policyProviders: [
      {
        name: "autonomy-block-policy",
        async evaluatePlan(ctx, plan) {
          return [
            {
              decision_id: ctx.services.generateId("pol"),
              schema_version: ctx.profile.schema_version,
              session_id: ctx.session.session_id,
              cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
              policy_id: "autonomy-block-policy",
              level: "block",
              severity: 50,
              target_type: "plan",
              target_id: plan.plan_id,
              reason: "Block plan adoption in this test.",
              created_at: ctx.services.now()
            }
          ];
        },
        async evaluateSelfGoal(ctx, goal) {
          return [
            {
              decision_id: ctx.services.generateId("pol"),
              schema_version: ctx.profile.schema_version,
              session_id: ctx.session.session_id,
              cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
              policy_id: "autonomy-block-policy",
              level: "block",
              severity: 50,
              target_type: "goal",
              target_id: goal.goal_id,
              reason: "Block self-generated goal adoption in this test.",
              created_at: ctx.services.now()
            }
          ];
        }
      }
    ]
  });
  const profile = makeProfile();
  const session = runtime.createSession(profile, makeCommand("blocked autonomy"));
  completeRootGoal(runtime, session.session_id);

  const result = await runtime.runOnce(profile, session.session_id, makeInput("blocked autonomy"));
  assert.equal(result.sessionState, "waiting");
  const autonomyState = runtime.getAutonomyState(session.session_id);
  assert.equal(autonomyState?.active_plan, undefined);
  assert.ok(autonomyState?.suggested_goals?.every((goal) => goal.status !== "accepted"));
  const goals = runtime.listGoals(session.session_id);
  assert.equal(goals.some((goal) => goal.owner === "agent" && goal.metadata?.self_generated === true), false);
});

test("M12 Phase 6: trace and event flow capture full autonomy lifecycle", async () => {
  const runtime = new AgentRuntime({
    reasoner: makeTraceReasoner()
  });
  const planningProfile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: false,
      self_goal_enabled: false,
      transfer_enabled: false,
      continual_learning_enabled: false,
      alignment: {
        shutdown_responsive: true
      }
    }
  });
  const selfGoalProfile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: false,
      self_goal_enabled: true,
      transfer_enabled: true,
      continual_learning_enabled: true,
      goal_value_threshold: 0.2,
      goal_feasibility_threshold: 0.2,
      alignment: {
        allow_self_generated_goals: true,
        high_risk_self_goal_requires_approval: true,
        max_concurrent_self_goals: 2,
        shutdown_responsive: true
      }
    }
  });
  const recoveryProfile = makeProfile({
    autonomy_config: {
      enabled: true,
      monitor_enabled: true,
      self_goal_enabled: false,
      transfer_enabled: false,
      continual_learning_enabled: false,
      alignment: {
        allow_autonomous_recovery: true,
        shutdown_responsive: true
      }
    }
  });
  const session = runtime.createSession(planningProfile, makeCommand("full autonomy lifecycle"));
  await runtime.runOnce(planningProfile, session.session_id, makeInput("full autonomy lifecycle plan"));
  completeRootGoal(runtime, session.session_id);
  await runtime.runOnce(selfGoalProfile, session.session_id, makeInput("full autonomy lifecycle self-goal"));
  const result = await runtime.runOnce(recoveryProfile, session.session_id, makeInput("full autonomy lifecycle recovery"));
  assert.ok(["waiting", "aborted", "completed"].includes(result.sessionState));
  const events = runtime.listEvents(session.session_id).map((event) => event.event_type);
  assert.ok(events.includes("plan.generated"));
  assert.ok(events.includes("motivation.computed"));
  assert.ok(events.includes("goal.self_generated"));
  assert.ok(events.includes("drift.detected"));
  assert.ok(events.includes("recovery.triggered"));
  assert.ok(events.includes("transfer.attempted"));
  assert.ok(events.includes("consolidation.completed"));

  const traceRecords = runtime.getTraceRecords(session.session_id);
  assert.ok(traceRecords.length >= 1);
  assert.ok(traceRecords.at(-1)?.autonomy_state);
  assert.ok(traceRecords.at(-1)?.autonomy_decision);
  assert.ok(traceRecords.at(-1)?.workspace?.autonomy_state);
});
