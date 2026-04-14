import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  AgentRuntime,
  Calibrator,
  CycleEngine,
  DefaultControlAllocator,
  DeepEvaluator,
  DefaultMetaController,
  FastMonitor,
  InMemoryCalibrationStore,
  MetaSignalBus,
  SqliteRuntimeStateStore
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
  const assessmentPromise = evaluator.evaluate({
    ctx: makeCtx(),
    workspace: makeWorkspace(),
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

  return assessmentPromise.then((assessment) => {
    assert.equal(assessment.deep_evaluation_used, true);
    assert.ok(assessment.verification_trace);
    assert.ok(assessment.verification_trace.verifier_runs.some((row) => row.verifier === "evidence-verifier"));
    assert.ok(assessment.calibrated_confidence <= assessment.confidence.overall_confidence);
    assert.equal(typeof assessment.recommended_control_action, "string");
  });
});

test("DeepEvaluator recommends replan when tool verifier finds readiness unresolved", async () => {
  const evaluator = new DeepEvaluator();
  const frame = {
    frame_id: "frm_tool",
    session_id: "ses_meta",
    cycle_id: "cyc_1",
    task_signals: {
      task_novelty: 0.3,
      domain_familiarity: 0.8,
      historical_success_rate: 0.7,
      ood_score: 0.2,
      decomposition_depth: 1,
      goal_decomposition_depth: 1,
      unresolved_dependency_count: 0
    },
    evidence_signals: {
      retrieval_coverage: 0.8,
      evidence_freshness: 0.8,
      evidence_agreement_score: 0.8,
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
      predicted_success_probability: 0.7,
      predicted_downside_severity: 0.2,
      uncertainty_decomposition: {
        epistemic: 0.2,
        aleatoric: 0.2,
        evidence_missing: 0.1,
        model_disagreement: 0.2,
        simulator_unreliability: 0.2,
        calibration_gap: 0.1
      },
      simulator_confidence: 0.7,
      predictor_error_rate: 0.1,
      predictor_bucket_reliability: 0.8,
      predictor_calibration_bucket: "high",
      world_model_mismatch_score: 0.1
    },
    action_signals: {
      tool_precondition_completeness: 0.4,
      schema_confidence: 0.45,
      side_effect_severity: 0.2,
      reversibility_score: 0.8,
      observability_after_action: 0.8,
      fallback_availability: 0.7
    },
    governance_signals: {
      policy_warning_density: 0,
      budget_pressure: 0.2,
      remaining_recovery_options: 0.7,
      need_for_human_accountability: 0.2
    },
    created_at: ts()
  };

  const assessment = await evaluator.evaluate({
    ctx: makeCtx(),
    workspace: makeWorkspace(),
    frame,
    fastAssessment: {
      assessment_id: "fast_tool",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "needs-deep-eval",
      provisional_confidence: 0.52,
      trigger_tags: ["tool_not_ready"],
      trigger_deep_eval: true,
      recommended_control_actions: ["invoke-verifier"],
      rationale: "tool not ready",
      created_at: ts()
    },
    actions: [
      {
        action_id: "act_tool",
        action_type: "call_tool",
        title: "Call tool",
        tool_name: "dangerous_tool",
        side_effect_level: "low"
      }
    ],
    predictions: [],
    policies: []
  });

  assert.equal(assessment.recommended_control_action, "replan");
  assert.ok(assessment.verification_trace?.verifier_runs.some((row) => row.verifier === "tool-verifier"));
});

test("DeepEvaluator recommends ask-human on unresolved high-risk safety path", async () => {
  const evaluator = new DeepEvaluator();
  const assessment = await evaluator.evaluate({
    ctx: makeCtx(),
    workspace: makeWorkspace(),
    frame: {
      frame_id: "frm_risk",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      task_signals: {
        task_novelty: 0.4,
        domain_familiarity: 0.4,
        historical_success_rate: 0.4,
        ood_score: 0.3,
        decomposition_depth: 1,
        goal_decomposition_depth: 1,
        unresolved_dependency_count: 0
      },
      evidence_signals: {
        retrieval_coverage: 0.7,
        evidence_freshness: 0.7,
        evidence_agreement_score: 0.7,
        source_reliability_prior: 0.7,
        missing_critical_evidence_flags: []
      },
      reasoning_signals: {
        candidate_reasoning_divergence: 0.2,
        step_consistency: 0.7,
        contradiction_score: 0.1,
        assumption_count: 1,
        unsupported_leap_count: 0,
        self_consistency_margin: 0.7
      },
      prediction_signals: {
        predicted_success_probability: 0.65,
        predicted_downside_severity: 0.75,
        uncertainty_decomposition: {
          epistemic: 0.3,
          aleatoric: 0.2,
          evidence_missing: 0.1,
          model_disagreement: 0.2,
          simulator_unreliability: 0.2,
          calibration_gap: 0.1
        },
        simulator_confidence: 0.7,
        predictor_error_rate: 0.1,
        predictor_bucket_reliability: 0.8,
        predictor_calibration_bucket: "high",
        world_model_mismatch_score: 0.1
      },
      action_signals: {
        tool_precondition_completeness: 0.8,
        schema_confidence: 0.8,
        side_effect_severity: 0.72,
        reversibility_score: 0.5,
        observability_after_action: 0.8,
        fallback_availability: 0.7
      },
      governance_signals: {
        policy_warning_density: 0.2,
        budget_pressure: 0.2,
        remaining_recovery_options: 0.4,
        need_for_human_accountability: 0.78
      },
      created_at: ts()
    },
    fastAssessment: {
      assessment_id: "fast_risk",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "high-risk",
      provisional_confidence: 0.5,
      trigger_tags: ["risk_high", "policy_warned"],
      trigger_deep_eval: true,
      recommended_control_actions: ["execute-with-approval"],
      rationale: "high risk",
      created_at: ts()
    },
    actions: [
      {
        action_id: "act_tool",
        action_type: "call_tool",
        title: "Delete resource",
        tool_name: "dangerous_tool",
        side_effect_level: "high"
      }
    ],
    predictions: [],
    policies: [
      {
        decision_id: "pol_1",
        policy_name: "warn-dangerous",
        level: "warn",
        target_type: "action",
        target_id: "act_tool",
        reason: "dangerous side effect"
      }
    ]
  });

  assert.equal(assessment.recommended_control_action, "ask-human");
  assert.ok(assessment.verification_trace?.verifier_runs.some((row) => row.verifier === "safety-verifier"));
});

test("DeepEvaluator survives verifier failure and returns partial verification trace", async () => {
  const failingVerifier = {
    name: "failing-verifier",
    mode: "logic",
    async verify() {
      throw new Error("boom");
    }
  };
  const evaluator = new DeepEvaluator({
    verifiers: [failingVerifier, {
      name: "evidence-verifier",
      mode: "evidence",
      async verify() {
        return {
          verifier: "evidence-verifier",
          mode: "evidence",
          verdict: "inconclusive",
          summary: "missing evidence",
          evidence_gaps: [{ key: "missing_web", severity: "high" }],
          issues: [{ key: "missing_web", severity: "high", summary: "missing web evidence" }]
        };
      }
    }],
    simulator: null
  });

  const assessment = await evaluator.evaluate({
    ctx: makeCtx(),
    workspace: makeWorkspace(),
    frame: {
      ...new MetaSignalBus().collect({
        ctx: makeCtx(),
        workspace: makeWorkspace(),
        actions: [{ action_id: "act_1", action_type: "respond", title: "Respond" }],
        predictions: [],
        policies: [],
        goals: makeCtx().goals
      })
    },
    fastAssessment: {
      assessment_id: "fast_fail",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "evidence-insufficient",
      provisional_confidence: 0.35,
      trigger_tags: ["evidence_gap", "reasoning_conflict"],
      trigger_deep_eval: true,
      recommended_control_actions: ["request-more-evidence"],
      rationale: "missing evidence",
      created_at: ts()
    },
    actions: [{ action_id: "act_1", action_type: "respond", title: "Respond" }],
    predictions: [],
    policies: []
  });

  assert.equal(assessment.verification_trace?.final_verdict, "inconclusive");
  assert.ok(assessment.verification_trace?.verifier_runs.some((row) => row.verifier === "failing-verifier" && row.status === "failed"));
  assert.ok(assessment.verification_trace?.verifier_runs.some((row) => row.verifier === "evidence-verifier" && row.status === "ok"));
  assert.ok(assessment.verification_trace?.evidence_gaps?.some((row) => row.key === "missing_web"));
});

test("ControlAllocator is the single control source for evidence-insufficient path", async () => {
  const allocator = new DefaultControlAllocator();
  const fastAssessment = {
    assessment_id: "fast_1",
    session_id: "ses_meta",
    cycle_id: "cyc_1",
    meta_state: "evidence-insufficient",
    provisional_confidence: 0.35,
    trigger_deep_eval: true,
    recommended_control_actions: ["request-more-evidence"],
    rationale: "missing evidence",
    created_at: ts()
  };
  const metaAssessment = {
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
  };
  const ctx = {
    ...makeCtx(),
    workspace: {
      ...makeWorkspace(),
      metacognitive_state: fastAssessment
    }
  };
  const actions = [
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
  ];
  const predictions = [
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
  ];

  const decisionV2 = await allocator.decide({
    ctx,
    actions,
    predictions,
    policies: [],
    workspace: ctx.workspace,
    budgetAssessment: ctx.workspace.budget_assessment,
    fastAssessment,
    metaAssessment,
    predictionErrorRate: 0.05
  });

  assert.equal(decisionV2.control_action, "request-more-evidence");
  assert.equal(decisionV2.selected_action_id, "act_ask");
  assert.equal(decisionV2.decision_source, "deep");

  const controller = new DefaultMetaController();
  const decision = await controller.evaluate(
    {
      ...ctx,
      runtime_state: {
        meta_decision_v2: decisionV2
      }
    },
    actions,
    predictions,
    [],
    0.05
  );

  assert.equal(decision.decision_type, "execute_action");
  assert.equal(decision.selected_action_id, "act_ask");
  assert.ok(decision.meta_actions.includes("request-more-evidence"));
});

test("ControlAllocator escalates high-risk actions through a single approval path", async () => {
  const allocator = new DefaultControlAllocator();
  const ctx = {
    ...makeCtx(),
    workspace: makeWorkspace()
  };

  const decisionV2 = await allocator.decide({
    ctx,
    actions: [
      {
        action_id: "act_tool",
        action_type: "call_tool",
        title: "Delete resource",
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
        success_probability: 0.7,
        uncertainty: 0.35,
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
        reason: "dangerous side effect"
      }
    ],
    workspace: ctx.workspace,
    budgetAssessment: ctx.workspace.budget_assessment,
    fastAssessment: {
      assessment_id: "fast_1",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "high-risk",
      provisional_confidence: 0.55,
      trigger_deep_eval: true,
      recommended_control_actions: ["execute-with-approval"],
      rationale: "high risk",
      created_at: ts()
    },
    metaAssessment: {
      assessment_id: "meta_1",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "high-risk",
      confidence: {
        answer_confidence: 0.55,
        process_confidence: 0.55,
        evidence_confidence: 0.7,
        simulation_confidence: 0.6,
        action_safety_confidence: 0.2,
        tool_readiness_confidence: 0.8,
        calibration_confidence: 0.6,
        overall_confidence: 0.57
      },
      calibrated_confidence: 0.48,
      uncertainty_decomposition: {
        epistemic: 0.3,
        aleatoric: 0.2,
        evidence_missing: 0.1,
        model_disagreement: 0.2,
        simulator_unreliability: 0.1,
        calibration_gap: 0.2
      },
      failure_modes: ["overconfidence"],
      recommended_control_action: "execute-with-approval",
      recommended_candidate_action_id: "act_tool",
      rationale: "requires approval",
      created_at: ts(),
      deep_evaluation_used: true
    }
  });

  assert.equal(decisionV2.control_action, "ask-human");
  assert.equal(decisionV2.requires_approval, true);
  assert.equal(decisionV2.selected_action_id, "act_tool");

  const decision = await new DefaultMetaController().evaluate(
    {
      ...ctx,
      runtime_state: {
        meta_decision_v2: decisionV2
      }
    },
    [
      {
        action_id: "act_tool",
        action_type: "call_tool",
        title: "Delete resource",
        tool_name: "dangerous_tool",
        side_effect_level: "high"
      }
    ],
    [],
    [],
    0
  );

  assert.equal(decision.decision_type, "request_approval");
  assert.equal(decision.requires_human_approval, true);
});

test("Calibrator makes repeated failed buckets more conservative", () => {
  const store = new InMemoryCalibrationStore();
  const calibrator = new Calibrator(store);
  const action = {
    action_id: "act_tool",
    action_type: "call_tool",
    title: "Mutate external system",
    tool_name: "dangerous_tool",
    side_effect_level: "high"
  };

  const query = calibrator.query({
    profile: makeProfile(),
    input: makeInput(),
    action,
    metaState: "high-risk"
  });

  for (let index = 0; index < 5; index += 1) {
    store.append({
      record_id: gid("cal"),
      task_bucket: query.descriptor.taskBucket,
      predicted_confidence: 0.9,
      calibrated_confidence: 0.35,
      observed_success: false,
      risk_level: "high",
      predictor_id: query.descriptor.predictorId,
      deep_eval_used: true,
      session_id: "ses_meta",
      cycle_id: `cyc_${index}`,
      action_id: action.action_id,
      meta_state: "high-risk",
      created_at: ts()
    });
  }

  const stats = calibrator.query({
    profile: makeProfile(),
    input: makeInput(),
    action,
    metaState: "high-risk"
  }).stats;
  const calibrated = calibrator.calibrate({
    rawConfidence: 0.82,
    bucketStats: stats,
    riskLevel: "high",
    strictness: 1
  });

  assert.ok(stats.sample_count >= 5);
  assert.ok(stats.bucket_reliability < 0.5);
  assert.ok(calibrated < 0.5);
});

test("ControlAllocator uses low calibrated confidence as a conservative control signal", async () => {
  const allocator = new DefaultControlAllocator();
  const ctx = {
    ...makeCtx(),
    workspace: makeWorkspace()
  };

  const decisionV2 = await allocator.decide({
    ctx,
    actions: [
      {
        action_id: "act_resp",
        action_type: "respond",
        title: "Respond from current context"
      },
      {
        action_id: "act_ask",
        action_type: "ask_user",
        title: "Ask for evidence"
      }
    ],
    predictions: [],
    policies: [],
    workspace: ctx.workspace,
    fastAssessment: {
      assessment_id: "fast_1",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "routine-safe",
      provisional_confidence: 0.78,
      trigger_deep_eval: false,
      recommended_control_actions: ["execute-now"],
      rationale: "routine path",
      created_at: ts()
    },
    metaAssessment: {
      assessment_id: "meta_1",
      session_id: "ses_meta",
      cycle_id: "cyc_1",
      meta_state: "routine-safe",
      confidence: {
        answer_confidence: 0.8,
        process_confidence: 0.8,
        evidence_confidence: 0.75,
        simulation_confidence: 0.7,
        action_safety_confidence: 0.8,
        tool_readiness_confidence: 0.8,
        calibration_confidence: 0.2,
        overall_confidence: 0.78
      },
      calibrated_confidence: 0.24,
      bucket_reliability: 0.22,
      uncertainty_decomposition: {
        epistemic: 0.4,
        aleatoric: 0.2,
        evidence_missing: 0.1,
        model_disagreement: 0.2,
        simulator_unreliability: 0.2,
        calibration_gap: 0.55
      },
      failure_modes: ["overconfidence"],
      recommended_control_action: "execute-now",
      rationale: "raw path would execute",
      created_at: ts(),
      deep_evaluation_used: false
    }
  });

  assert.equal(decisionV2.control_action, "request-more-evidence");
  assert.equal(decisionV2.selected_action_id, "act_ask");
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
  assert.ok(result.metaDecisionV2);
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
  assert.equal(result.decision.selected_action_id, result.metaDecisionV2.selected_action_id);
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
  assert.ok(records[0].meta_decision_v2);
  assert.ok(records[0].self_evaluation_report);
  assert.ok(records[0].calibration_record);
  assert.equal(records[0].calibration_record?.record_id, calibrationRecords[0].record_id);
});

test("Calibration records persist across runtime restart with sqlite state store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "neurocore-meta-calibration-"));
  const filename = join(dir, "runtime.sqlite");
  const stateStore = new SqliteRuntimeStateStore({ filename });
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

  try {
    const runtime1 = new AgentRuntime({ reasoner, stateStore });
    const profile = makeProfile();
    const session = runtime1.createSession(profile, {
      agent_id: profile.agent_id,
      tenant_id: "tenant_meta",
      initial_input: makeInput()
    });
    await runtime1.runOnce(profile, session.session_id, makeInput());

    const runtime2 = new AgentRuntime({
      reasoner,
      stateStore: new SqliteRuntimeStateStore({ filename })
    });

    const records = runtime2.listCalibrationRecords(session.session_id);
    assert.ok(records.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
