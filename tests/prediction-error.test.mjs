import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryPredictionStore,
  computePredictionErrors,
  RuleBasedPredictor,
  DefaultMetaController
} from "@neurocore/runtime-core";
import { defineAgent } from "@neurocore/sdk-core";

function ts() {
  return new Date().toISOString();
}

let idCounter = 0;
function gid(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

test("InMemoryPredictionStore CRUD and getRecentErrorRate", () => {
  const store = new InMemoryPredictionStore();
  const sessionId = "ses_1";

  const prediction = {
    prediction_id: "prd_1",
    session_id: sessionId,
    cycle_id: "cyc_1",
    action_id: "act_1",
    predictor_name: "test",
    expected_outcome: "success",
    success_probability: 0.9,
    created_at: ts()
  };
  store.recordPrediction(prediction);

  const error1 = {
    prediction_error_id: "pe_1",
    prediction_id: "prd_1",
    action_id: "act_1",
    session_id: sessionId,
    cycle_id: "cyc_1",
    error_type: "outcome_mismatch",
    severity: "high",
    expected: { success_probability: 0.9 },
    actual: { status: "failure" },
    created_at: ts()
  };
  store.recordError(error1);

  const error2 = {
    prediction_error_id: "pe_2",
    prediction_id: "prd_2",
    action_id: "act_2",
    session_id: sessionId,
    cycle_id: "cyc_2",
    error_type: "duration_mismatch",
    severity: "low",
    expected: { estimated_duration_ms: 100 },
    actual: { latency_ms: 500 },
    created_at: ts()
  };
  store.recordError(error2);

  assert.equal(store.listErrors(sessionId).length, 2);
  assert.equal(store.getErrorsByAction(sessionId, "act_1").length, 1);
  assert.equal(store.getErrorsByAction(sessionId, "act_2").length, 1);
  assert.equal(store.getErrorsByAction(sessionId, "act_99").length, 0);

  const rate = store.getRecentErrorRate(sessionId, 5);
  assert.equal(rate, 0.5);

  store.deleteSession(sessionId);
  assert.equal(store.listErrors(sessionId).length, 0);
});

test("InMemoryPredictionStore getRecentErrorRate counts only medium/high severity", () => {
  const store = new InMemoryPredictionStore();
  const sessionId = "ses_rate";

  for (let i = 0; i < 3; i++) {
    store.recordError({
      prediction_error_id: `pe_${i}`,
      prediction_id: `prd_${i}`,
      action_id: `act_${i}`,
      session_id: sessionId,
      cycle_id: `cyc_${i}`,
      error_type: "duration_mismatch",
      severity: "low",
      expected: {},
      actual: {},
      created_at: ts()
    });
  }

  assert.equal(store.getRecentErrorRate(sessionId, 5), 0);
});

test("computePredictionErrors detects outcome mismatch (predicted success, actual failure)", () => {
  const errors = computePredictionErrors({
    predictions: [
      {
        prediction_id: "prd_1",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        action_id: "act_1",
        predictor_name: "test",
        expected_outcome: "should succeed",
        success_probability: 0.9,
        created_at: ts()
      }
    ],
    observation: {
      observation_id: "obs_1",
      session_id: "ses_1",
      cycle_id: "cyc_1",
      source_action_id: "act_1",
      source_type: "tool",
      status: "failure",
      summary: "Tool call failed",
      created_at: ts()
    },
    generateId: gid,
    now: ts
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].error_type, "outcome_mismatch");
  assert.equal(errors[0].severity, "high");
});

test("computePredictionErrors detects outcome mismatch (predicted failure, actual success)", () => {
  const errors = computePredictionErrors({
    predictions: [
      {
        prediction_id: "prd_2",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        action_id: "act_2",
        predictor_name: "test",
        expected_outcome: "should fail",
        success_probability: 0.2,
        created_at: ts()
      }
    ],
    observation: {
      observation_id: "obs_2",
      session_id: "ses_1",
      cycle_id: "cyc_1",
      source_action_id: "act_2",
      source_type: "tool",
      status: "success",
      summary: "Tool call succeeded",
      created_at: ts()
    },
    generateId: gid,
    now: ts
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].error_type, "outcome_mismatch");
  assert.equal(errors[0].severity, "medium");
});

test("computePredictionErrors detects duration mismatch", () => {
  const errors = computePredictionErrors({
    predictions: [
      {
        prediction_id: "prd_3",
        session_id: "ses_1",
        cycle_id: "cyc_1",
        action_id: "act_3",
        predictor_name: "test",
        expected_outcome: "ok",
        estimated_duration_ms: 100,
        created_at: ts()
      }
    ],
    observation: {
      observation_id: "obs_3",
      session_id: "ses_1",
      cycle_id: "cyc_1",
      source_action_id: "act_3",
      source_type: "tool",
      status: "success",
      summary: "Done",
      created_at: ts()
    },
    execution: {
      execution_id: "exe_3",
      session_id: "ses_1",
      cycle_id: "cyc_1",
      action_id: "act_3",
      status: "succeeded",
      started_at: ts(),
      ended_at: ts(),
      executor: "tool_gateway",
      metrics: { latency_ms: 600 }
    },
    generateId: gid,
    now: ts
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].error_type, "duration_mismatch");
  assert.equal(errors[0].severity, "high");
});

test("E2E: predictor predicts success but tool fails → prediction_error.recorded event + trace contains errors", async () => {
  let toolCallCount = 0;

  const agent = defineAgent({
    id: "test-prediction-error-agent",
    role: "Test agent for prediction error loop."
  })
    .useReasoner({
      name: "prediction-error-test-reasoner",
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
            payload: { summary: "Call failing tool" }
          }
        ];
      },
      async respond(ctx) {
        const currentInput =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";

        if (currentInput.startsWith("Tool observation:")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Return observation",
              description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
              side_effect_level: "none"
            }
          ];
        }

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Call failing_tool",
            tool_name: "failing_tool",
            tool_args: {},
            side_effect_level: "none"
          }
        ];
      }
    })
    .registerPredictor({
      name: "optimistic-predictor",
      async predict(ctx, action) {
        return {
          prediction_id: ctx.services.generateId("prd"),
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          action_id: action.action_id,
          predictor_name: "optimistic-predictor",
          expected_outcome: "Tool should succeed.",
          success_probability: 0.95,
          uncertainty: 0.05,
          created_at: ctx.services.now()
        };
      }
    })
    .registerTool({
      name: "failing_tool",
      description: "Always fails for testing.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        toolCallCount += 1;
        throw new Error("Intentional tool failure");
      }
    });

  const session = agent.createSession({
    agent_id: "test-prediction-error-agent",
    tenant_id: "local",
    initial_input: { content: "Run the failing tool." }
  });

  const result = await session.run();

  const events = session.getEvents();
  const predictionErrorEvents = events.filter((e) => e.event_type === "prediction_error.recorded");
  assert.ok(predictionErrorEvents.length >= 1, "Should have at least one prediction_error.recorded event");

  const traceRecords = session.getTraceRecords();
  const recordsWithErrors = traceRecords.filter(
    (r) => r.prediction_errors && r.prediction_errors.length > 0
  );
  assert.ok(recordsWithErrors.length >= 1, "At least one trace record should contain prediction errors");

  const firstErrorRecord = recordsWithErrors[0];
  assert.equal(firstErrorRecord.prediction_errors[0].error_type, "outcome_mismatch");

  const traceWithRefs = traceRecords.find(
    (r) => r.trace.prediction_error_refs && r.trace.prediction_error_refs.length > 0
  );
  assert.ok(traceWithRefs, "Trace should have prediction_error_refs");

  session.cleanup({ force: true });
});

test("High prediction error rate causes MetaController to lower confidence and trigger approval", async () => {
  const ctrl = new DefaultMetaController();
  const ctx = {
    tenant_id: "t1",
    session: {
      session_id: "ses_meta",
      schema_version: "0.1.0",
      tenant_id: "t1",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "gt1",
      budget_state: { cycle_used: 0, tool_call_used: 0, token_budget_used: 0 },
      policy_state: {}
    },
    profile: {
      agent_id: "test-agent",
      schema_version: "0.1.0",
      name: "Test",
      version: "1.0.0",
      role: "test",
      mode: "embedded",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: { working_memory_enabled: true, episodic_memory_enabled: false, write_policy: "immediate" },
      runtime_config: { max_cycles: 10 }
    },
    goals: [],
    runtime_state: {},
    services: { now: () => new Date().toISOString(), generateId: (p) => `${p}_1` }
  };

  const actions = [
    { action_id: "a1", action_type: "call_tool", title: "Do something", tool_name: "test_tool", side_effect_level: "none" }
  ];
  const predictions = [
    {
      prediction_id: "p1",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      action_id: "a1",
      predictor_name: "test",
      expected_outcome: "ok",
      uncertainty: 0.1,
      success_probability: 0.8,
      created_at: ts()
    }
  ];

  const resultNoError = await ctrl.evaluate(ctx, actions, predictions, [], 0);
  assert.equal(resultNoError.decision_type, "execute_action");
  const baseConfidence = resultNoError.confidence;

  const resultHighError = await ctrl.evaluate(ctx, actions, predictions, [], 0.8);
  assert.equal(resultHighError.decision_type, "request_approval");
  assert.ok(resultHighError.confidence < baseConfidence, "Confidence should be lowered with high error rate");
  assert.ok(resultHighError.risk_summary.includes("prediction error rate"), "Risk summary should mention error rate");
});

test("RuleBasedPredictor basic prediction and uncertainty increases after error", async () => {
  const predictor = new RuleBasedPredictor();
  const ctx = {
    tenant_id: "t1",
    session: {
      session_id: "ses_rbp",
      schema_version: "0.1.0",
      tenant_id: "t1",
      state: "running",
      session_mode: "sync",
      current_cycle_id: "cyc_1",
      goal_tree_ref: "gt1",
      budget_state: {},
      policy_state: {}
    },
    profile: {
      agent_id: "test-agent",
      schema_version: "0.1.0",
      name: "Test",
      version: "1.0.0",
      role: "test",
      mode: "embedded",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: { working_memory_enabled: true, episodic_memory_enabled: false, write_policy: "immediate" },
      runtime_config: { max_cycles: 10 }
    },
    goals: [],
    runtime_state: {},
    services: { now: () => new Date().toISOString(), generateId: gid }
  };

  const action = {
    action_id: "act_rbp",
    action_type: "call_tool",
    title: "Test tool call",
    tool_name: "test_tool",
    side_effect_level: "low"
  };

  const prediction = await predictor.predict(ctx, action);
  assert.ok(prediction, "Should return a prediction");
  assert.equal(prediction.predictor_name, "rule-based-predictor");
  assert.ok(prediction.success_probability > 0, "Should have positive success probability");
  assert.ok(prediction.uncertainty > 0, "Should have non-zero uncertainty");

  const initialUncertainty = predictor.getBaseUncertainty();

  await predictor.recordError({
    prediction_error_id: "pe_rbp_1",
    prediction_id: prediction.prediction_id,
    action_id: "act_rbp",
    session_id: "ses_rbp",
    cycle_id: "cyc_1",
    error_type: "outcome_mismatch",
    severity: "high",
    expected: { success_probability: 0.85 },
    actual: { status: "failure" },
    created_at: ts()
  });

  const newUncertainty = predictor.getBaseUncertainty();
  assert.ok(newUncertainty > initialUncertainty, "Uncertainty should increase after recording an error");
});
