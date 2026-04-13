import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentRuntime,
  CycleEngine,
  DeepEvaluator,
  DefaultMetaController,
  FastMonitor,
  MetaSignalBus
} from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

let idCounter = 0;
function gid(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function makeProfile() {
  return {
    agent_id: "meta-test-agent",
    schema_version: "1.0.0",
    name: "Meta Test Agent",
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
      write_policy: "immediate",
      retrieval_top_k: 5
    },
    runtime_config: {
      max_cycles: 3,
      auto_approve: false
    }
  };
}

function makeSession() {
  return {
    session_id: "ses_meta",
    schema_version: "1.0.0",
    tenant_id: "tenant_meta",
    agent_id: "meta-test-agent",
    state: "running",
    session_mode: "sync",
    goal_tree_ref: "goal_tree_meta",
    budget_state: {},
    policy_state: {}
  };
}

function makeInput() {
  return {
    input_id: gid("inp"),
    content: "please summarize the current plan",
    created_at: ts(),
    metadata: {}
  };
}

function makeCtx() {
  return {
    tenant_id: "tenant_meta",
    session: makeSession(),
    profile: makeProfile(),
    goals: [
      {
        goal_id: "goal_1",
        schema_version: "1.0.0",
        session_id: "ses_meta",
        title: "help user",
        goal_type: "task",
        status: "active",
        priority: 100,
        dependencies: ["goal_dep_1"]
      }
    ],
    runtime_state: {
      memory_recall_proposals: [],
      skill_match_proposals: []
    },
    services: {
      now: () => ts(),
      generateId: (prefix) => gid(prefix)
    }
  };
}

function makeWorkspace() {
  return {
    workspace_id: "wrk_1",
    schema_version: "1.0.0",
    session_id: "ses_meta",
    cycle_id: "cyc_1",
    input_events: [{ input_id: "inp_1", source_type: "user" }],
    active_goals: [{ goal_id: "goal_1", title: "help user", status: "active", priority: 100 }],
    context_summary: "please summarize the current plan",
    memory_digest: [],
    skill_digest: [],
    candidate_actions: [],
    created_at: ts()
  };
}

test("MetaSignalBus collects structured meta signals", () => {
  const signalBus = new MetaSignalBus();
  const ctx = makeCtx();
  const frame = signalBus.collect({
    ctx,
    workspace: makeWorkspace(),
    actions: [
      {
        action_id: "act_1",
        action_type: "respond",
        title: "Respond"
      },
      {
        action_id: "act_2",
        action_type: "call_tool",
        title: "Call browser",
        tool_name: "browser_open",
        side_effect_level: "medium"
      }
    ],
    predictions: [
      {
        prediction_id: "prd_1",
        session_id: "ses_meta",
        cycle_id: "cyc_1",
        action_id: "act_1",
        predictor_name: "rule",
        expected_outcome: "response",
        success_probability: 0.75,
        uncertainty: 0.35,
        created_at: ts()
      }
    ],
    policies: [
      {
        decision_id: "pol_1",
        policy_name: "warn-medium-risk",
        level: "warn",
        target_type: "action",
        target_id: "act_2",
        reason: "medium risk action"
      }
    ],
    predictionErrorRate: 0.2,
    goals: ctx.goals
  });

  assert.equal(frame.session_id, "ses_meta");
  assert.equal(frame.goal_id, "goal_1");
  assert.ok(frame.task_signals.task_novelty >= 0);
  assert.equal(frame.task_signals.decomposition_depth, frame.task_signals.goal_decomposition_depth);
  assert.ok(frame.evidence_signals.retrieval_coverage <= 1);
  assert.ok(frame.reasoning_signals.candidate_reasoning_divergence > 0);
  assert.equal(frame.governance_signals.policy_warning_density > 0, true);
  assert.equal(typeof frame.prediction_signals.predictor_error_rate, "number");
  assert.equal(typeof frame.prediction_signals.predictor_bucket_reliability, "number");
  assert.ok(Array.isArray(frame.provenance));
  assert.ok(frame.provenance.some((row) => row.field === "retrieval_coverage"));
});

test("MetaSignalBus aggregates budget pressure and provenance conservatively", () => {
  const signalBus = new MetaSignalBus();
  const ctx = makeCtx();
  ctx.session.budget_state = {
    token_budget_total: 100,
    token_budget_used: 90,
    tool_call_limit: 10,
    tool_call_used: 8
  };
  ctx.runtime_state.current_input_content = "latest price and current market update";

  const frame = signalBus.collect({
    ctx,
    workspace: makeWorkspace(),
    actions: [
      {
        action_id: "act_1",
        action_type: "call_tool",
        title: "Fetch live market data",
        tool_name: "web_search"
      }
    ],
    predictions: [],
    policies: [],
    goals: ctx.goals
  });

  assert.ok(frame.governance_signals.budget_pressure >= 0.8);
  assert.ok(frame.evidence_signals.evidence_freshness <= 0.3);
  assert.ok(frame.evidence_signals.missing_critical_evidence_flags.includes("missing_current_grounding"));
  assert.ok(frame.provenance.some((row) => row.field === "budget_pressure"));
});

test("FastMonitor emits evidence-insufficient for low evidence coverage", () => {
  const signalBus = new MetaSignalBus();
  const monitor = new FastMonitor();
  const frame = signalBus.collect({
    ctx: makeCtx(),
    workspace: makeWorkspace(),
    actions: [
      {
        action_id: "act_1",
        action_type: "respond",
        title: "Respond"
      }
    ],
    predictions: [
      {
        prediction_id: "prd_1",
        session_id: "ses_meta",
        cycle_id: "cyc_1",
        action_id: "act_1",
        predictor_name: "rule",
        expected_outcome: "response",
        success_probability: 0.7,
        uncertainty: 0.4,
        created_at: ts()
      }
    ],
    policies: [],
    predictionErrorRate: 0.1,
    goals: makeCtx().goals
  });

  const assessment = monitor.assess(frame);
  assert.equal(assessment.meta_state, "evidence-insufficient");
  assert.ok(assessment.trigger_tags.includes("evidence_gap"));
  assert.equal(assessment.trigger_deep_eval, true);
  assert.ok(assessment.recommended_control_actions.includes("request-more-evidence"));
});

test("FastMonitor emits simulation-unreliable and suppresses expensive actions under tight budget", () => {
  const monitor = new FastMonitor();
  const frame = {
    frame_id: "frm_1",
    session_id: "ses_meta",
    cycle_id: "cyc_1",
    task_signals: {
      task_novelty: 0.2,
      domain_familiarity: 0.8,
      historical_success_rate: 0.7,
      ood_score: 0.1,
      goal_decomposition_depth: 1,
      unresolved_dependency_count: 0
    },
    evidence_signals: {
      retrieval_coverage: 0.8,
      evidence_freshness: 0.8,
      evidence_agreement_score: 0.7,
      source_reliability_prior: 0.8,
      missing_critical_evidence_flags: []
    },
    reasoning_signals: {
      candidate_reasoning_divergence: 0.2,
      step_consistency: 0.8,
      contradiction_score: 0.1,
      assumption_count: 1,
      unsupported_leap_count: 0,
      self_consistency_margin: 0.7
    },
    prediction_signals: {
      predicted_success_probability: 0.6,
      predicted_downside_severity: 0.2,
      uncertainty_decomposition: {
        epistemic: 0.3,
        aleatoric: 0.2,
        evidence_missing: 0.1,
        model_disagreement: 0.7,
        simulator_unreliability: 0.7,
        calibration_gap: 0.2
      },
      simulator_confidence: 0.25,
      predictor_calibration_bucket: "mid",
      world_model_mismatch_score: 0.2
    },
    action_signals: {
      tool_precondition_completeness: 0.9,
      schema_confidence: 0.9,
      side_effect_severity: 0.2,
      reversibility_score: 0.8,
      observability_after_action: 0.8,
      fallback_availability: 0.7
    },
    governance_signals: {
      policy_warning_density: 0,
      budget_pressure: 0.8,
      remaining_recovery_options: 0.7,
      need_for_human_accountability: 0.2
    },
    created_at: ts()
  };

  const assessment = monitor.assess(frame);
  assert.equal(assessment.meta_state, "simulation-unreliable");
  assert.ok(assessment.trigger_tags.includes("simulation_unreliable"));
  assert.ok(assessment.trigger_tags.includes("budget_tight"));
  assert.equal(assessment.trigger_deep_eval, true);
  assert.ok(!assessment.recommended_control_actions.includes("run-more-samples"));
  assert.ok(assessment.recommended_control_actions.includes("switch-to-safe-response"));
});

test("DeepEvaluator produces verification trace and calibrated assessment", () => {
  const signalBus = new MetaSignalBus();
  const monitor = new FastMonitor();
  const evaluator = new DeepEvaluator();
  const frame = signalBus.collect({
    ctx: makeCtx(),
    workspace: makeWorkspace(),
    actions: [
      {
        action_id: "act_ask",
        action_type: "ask_user",
        title: "Ask for missing details"
      },
      {
        action_id: "act_tool",
        action_type: "call_tool",
        title: "Mutate external system",
        tool_name: "dangerous_tool",
        side_effect_level: "high"
      }
    ],
    predictions: [
      {
        prediction_id: "prd_1",
        session_id: "ses_meta",
        cycle_id: "cyc_1",
        action_id: "act_tool",
        predictor_name: "rule",
        expected_outcome: "tool succeeds",
        success_probability: 0.55,
        uncertainty: 0.6,
        created_at: ts()
      }
    ],
    policies: [
      {
        decision_id: "pol_1",
        policy_name: "warn-dangerous",
        level: "warn",
        target_type: "action",
        target_id: "act_tool",
        reason: "dangerous external mutation"
      }
    ],
    predictionErrorRate: 0.35,
    goals: makeCtx().goals
  });

  const fast = monitor.assess(frame);
  const assessment = evaluator.evaluate({
    frame,
    fastAssessment: fast,
    actions: [
      {
        action_id: "act_ask",
        action_type: "ask_user",
        title: "Ask for missing details"
      },
      {
        action_id: "act_tool",
        action_type: "call_tool",
        title: "Mutate external system",
        tool_name: "dangerous_tool",
        side_effect_level: "high"
      }
    ],
    predictions: [
      {
        prediction_id: "prd_1",
        session_id: "ses_meta",
        cycle_id: "cyc_1",
        action_id: "act_tool",
        predictor_name: "rule",
        expected_outcome: "tool succeeds",
        success_probability: 0.55,
        uncertainty: 0.6,
        created_at: ts()
      }
    ],
    policies: [
      {
        decision_id: "pol_1",
        policy_name: "warn-dangerous",
        level: "warn",
        target_type: "action",
        target_id: "act_tool",
        reason: "dangerous external mutation"
      }
    ]
  });

  assert.equal(assessment.deep_evaluation_used, true);
  assert.ok(assessment.verification_trace);
  assert.ok(assessment.verification_trace.verifier_runs.some((row) => row.verifier === "evidence-verifier"));
  assert.ok(assessment.calibrated_confidence <= assessment.confidence.overall_confidence);
  assert.equal(typeof assessment.recommended_control_action, "string");
});

test("DefaultMetaController consumes deep meta assessment and selects ask_user for missing evidence", async () => {
  const controller = new DefaultMetaController();
  const decision = await controller.evaluate(
    {
      ...makeCtx(),
      workspace: {
        ...makeWorkspace(),
        metacognitive_state: {
          assessment_id: "fast_1",
          session_id: "ses_meta",
          cycle_id: "cyc_1",
          meta_state: "evidence-insufficient",
          provisional_confidence: 0.35,
          trigger_deep_eval: true,
          recommended_control_actions: ["request-more-evidence"],
          rationale: "missing evidence",
          created_at: ts()
        }
      },
      runtime_state: {
        meta_assessment: {
          assessment_id: "meta_1",
          session_id: "ses_meta",
          cycle_id: "cyc_1",
          meta_state: "evidence-insufficient",
          confidence: {
            answer_confidence: 0.4,
            process_confidence: 0.45,
            evidence_confidence: 0.2,
            simulation_confidence: 0.5,
            action_safety_confidence: 0.9,
            tool_readiness_confidence: 0.9,
            calibration_confidence: 0.5,
            overall_confidence: 0.45
          },
          calibrated_confidence: 0.32,
          uncertainty_decomposition: {
            epistemic: 0.5,
            aleatoric: 0.2,
            evidence_missing: 0.8,
            model_disagreement: 0.3,
            simulator_unreliability: 0.2,
            calibration_gap: 0.3
          },
          failure_modes: ["insufficient_evidence"],
          recommended_control_action: "request-more-evidence",
          recommended_candidate_action_id: "act_ask",
          rationale: "need more evidence",
          created_at: ts(),
          deep_evaluation_used: true
        }
      }
    },
    [
      {
        action_id: "act_resp",
        action_type: "respond",
        title: "Respond from current context"
      },
      {
        action_id: "act_ask",
        action_type: "ask_user",
        title: "Ask user for clarifying evidence"
      }
    ],
    [
      {
        prediction_id: "prd_1",
        session_id: "ses_meta",
        cycle_id: "cyc_1",
        action_id: "act_resp",
        predictor_name: "rule",
        expected_outcome: "respond",
        success_probability: 0.85,
        uncertainty: 0.25,
        created_at: ts()
      },
      {
        prediction_id: "prd_2",
        session_id: "ses_meta",
        cycle_id: "cyc_1",
        action_id: "act_ask",
        predictor_name: "rule",
        expected_outcome: "request evidence",
        success_probability: 0.7,
        uncertainty: 0.1,
        created_at: ts()
      }
    ],
    [],
    0.05
  );

  assert.equal(decision.decision_type, "execute_action");
  assert.equal(decision.selected_action_id, "act_ask");
  assert.ok(decision.meta_actions.includes("request-more-evidence"));
});

test("CycleEngine run attaches metacognitive artifacts to workspace and decision", async () => {
  const engine = new CycleEngine();
  const reasoner = {
    name: "test-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Ask the user for missing facts",
          description: "Request the evidence needed to proceed"
        },
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond to user",
          description: "Provide a concise answer"
        }
      ];
    }
  };

  const result = await engine.run({
    tenantId: "tenant_meta",
    session: makeSession(),
    profile: makeProfile(),
    input: makeInput(),
    goals: makeCtx().goals,
    reasoner,
    metaController: new DefaultMetaController(),
    memoryProviders: [],
    predictors: [
      {
        name: "rule",
        async predict(ctx, action) {
          return {
            prediction_id: ctx.services.generateId("prd"),
            session_id: ctx.session.session_id,
            cycle_id: ctx.session.current_cycle_id ?? "cyc_unknown",
            action_id: action.action_id,
            predictor_name: "rule",
            expected_outcome: "respond successfully",
            success_probability: 0.8,
            uncertainty: 0.25,
            created_at: ctx.services.now()
          };
        }
      }
    ],
    policies: []
  });

  assert.ok(result.metaSignalFrame);
  assert.ok(result.fastMetaAssessment);
  assert.ok(result.metaAssessment);
  assert.ok(result.selfEvaluationReport);
  assert.equal(result.metaAssessment.deep_evaluation_used, true);
  assert.ok(result.metaAssessment.verification_trace);
  assert.ok(result.selfEvaluationReport.verification_trace);
  assert.ok(result.workspace.metacognitive_state);
  assert.equal(result.workspace.meta_signal_frame_ref, result.metaSignalFrame.frame_id);
  assert.equal(result.workspace.meta_assessment_ref, result.metaAssessment.assessment_id);
  assert.equal(result.workspace.self_evaluation_report_ref, result.selfEvaluationReport.report_id);
  assert.ok(Array.isArray(result.decision.meta_actions));
  assert.ok(typeof result.decision.meta_state === "string");
  assert.equal(result.decision.selected_action_id, result.actions[0].action_id);
});

test("AgentRuntime trace records persist metacognitive artifacts", async () => {
  const reasoner = {
    name: "runtime-meta-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond to user",
          description: "Runtime response"
        }
      ];
    }
  };

  const runtime = new AgentRuntime({ reasoner });
  const profile = makeProfile();
  const initialInput = makeInput();
  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_meta",
    initial_input: initialInput
  });

  await runtime.runOnce(profile, session.session_id, makeInput());
  const records = runtime.getTraceRecords(session.session_id);
  const calibrationRecords = runtime.listCalibrationRecords(session.session_id);
  assert.equal(records.length, 1);
  assert.equal(calibrationRecords.length, 1);
  assert.ok(records[0].workspace?.metacognitive_state);
  assert.ok(records[0].meta_signal_frame);
  assert.ok(records[0].fast_meta_assessment);
  assert.ok(records[0].meta_assessment);
  assert.ok(records[0].self_evaluation_report);
  assert.ok(records[0].calibration_record);
  assert.equal(records[0].calibration_record?.record_id, calibrationRecords[0].record_id);
});
