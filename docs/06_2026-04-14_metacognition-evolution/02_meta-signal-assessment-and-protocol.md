# 元信号、评估状态与协议拆分

> 2026-04-14
> 上位输入：
> - [深层元认知与自评估系统设计](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md)
> - [外部专家报告](/Users/sizz/Code/neurocore/neuro_core_元认知系统深层自评估升级设计.md)
>
> 2026-04-16 实现状态补充：
> - `MetaSignalBus` 已完成 family-provider 第一版
> - `task / evidence / reasoning / prediction / action / governance` 六类 `Heuristic*Provider` 已进入代码库
> - `MetaSignalBus` 现在只负责 provider 调度、family merge、missing-field conservative fallback 与 provenance 汇总
> - provider 失败或缺失时，frame 仍可生成，并带 `ok / missing / degraded / fallback` 状态
> - `prediction` family 缺失时会触发保守 fallback，下游 `FastMonitor` 不再继续判成 `routine-safe`

---

## 1. 拆分目标

外部报告里最强的一部分，不是“深思考”本身，而是它把元认知输入、状态、评估和学习对象都结构化了。  
本文件把这些内容拆成协议与状态模型，供 `@neurocore/protocol` 和 `runtime-core/meta` 后续实现使用。

---

## 2. Layer 0：Meta Signal Bus

### 2.1 MetaSignalFrame

```ts
interface MetaSignalFrame {
  frame_id: string;
  session_id: string;
  cycle_id: string;
  goal_id?: string;
  task_signals: TaskMetaSignals;
  evidence_signals: EvidenceMetaSignals;
  reasoning_signals: ReasoningMetaSignals;
  prediction_signals: PredictionMetaSignals;
  action_signals: ActionMetaSignals;
  governance_signals: GovernanceMetaSignals;
  provenance?: MetaSignalProvenance[];
  created_at: string;
}
```

### 2.2 信号分类

#### A. TaskMetaSignals

- `task_novelty`
- `domain_familiarity`
- `historical_success_rate`
- `ood_score`
- `goal_decomposition_depth`
- `decomposition_depth`
- `unresolved_dependency_count`

#### B. EvidenceMetaSignals

- `retrieval_coverage`
- `evidence_freshness`
- `evidence_agreement_score`
- `source_reliability_prior`
- `missing_critical_evidence_flags`

#### C. ReasoningMetaSignals

- `candidate_reasoning_divergence`
- `step_consistency`
- `contradiction_score`
- `assumption_count`
- `unsupported_leap_count`
- `self_consistency_margin`

#### D. PredictionMetaSignals

- `predicted_success_probability`
- `predicted_downside_severity`
- `uncertainty_decomposition`
- `simulator_confidence`
- `predictor_error_rate`
- `predictor_bucket_reliability`
- `predictor_calibration_bucket`
- `world_model_mismatch_score`

#### E. ActionMetaSignals

- `tool_precondition_completeness`
- `schema_confidence`
- `side_effect_severity`
- `reversibility_score`
- `observability_after_action`
- `fallback_availability`

#### F. GovernanceMetaSignals

- `policy_warning_density`
- `budget_pressure`
- `remaining_recovery_options`
- `need_for_human_accountability`

### 2.3 Provenance

```ts
interface MetaSignalProvenance {
  family: string;
  field: string;
  provider: string;
  status: "ok" | "missing" | "degraded" | "fallback";
  timestamp: string;
  note?: string;
}
```

---

## 3. Layer 1：Fast Monitor 输出

### 3.1 MetaState

```ts
type MetaState =
  | "routine-safe"
  | "routine-uncertain"
  | "high-conflict"
  | "evidence-insufficient"
  | "simulation-unreliable"
  | "high-risk"
  | "needs-deep-eval";
```

### 3.2 MetaTriggerTag

```ts
type MetaTriggerTag =
  | "risk_high"
  | "evidence_gap"
  | "reasoning_conflict"
  | "simulation_unreliable"
  | "task_novel"
  | "ood_detected"
  | "calibration_weak"
  | "tool_not_ready"
  | "budget_tight"
  | "policy_warned";
```

### 3.3 FastMetaAssessment

```ts
interface FastMetaAssessment {
  assessment_id: string;
  session_id: string;
  cycle_id: string;
  meta_state: MetaState;
  provisional_confidence: number;
  confidence?: ConfidenceVector;
  trigger_tags?: MetaTriggerTag[];
  trigger_deep_eval: boolean;
  recommended_control_actions: MetaControlAction[];
  rationale: string;
  created_at: string;
}
```

---

## 4. Layer 2：Deep Evaluator 输出

### 4.1 ConfidenceVector

```ts
interface ConfidenceVector {
  answer_confidence: number;
  process_confidence: number;
  evidence_confidence: number;
  simulation_confidence: number;
  action_safety_confidence: number;
  tool_readiness_confidence: number;
  calibration_confidence: number;
  overall_confidence: number;
}
```

### 4.2 UncertaintyDecomposition

```ts
interface UncertaintyDecomposition {
  epistemic: number;
  aleatoric: number;
  evidence_missing: number;
  model_disagreement: number;
  simulator_unreliability: number;
  calibration_gap: number;
}
```

### 4.3 FailureMode

```ts
type FailureMode =
  | "insufficient_evidence"
  | "wrong_assumption"
  | "retrieval_miss"
  | "stale_memory"
  | "bad_plan"
  | "prediction_drift"
  | "tool_failure"
  | "policy_block"
  | "overconfidence"
  | "underconfidence";
```

### 4.4 DeepMetaAssessment

```ts
interface DeepMetaAssessment {
  overall_confidence: number;
  calibrated_confidence?: number;
  process_reliability: number;
  evidence_sufficiency: number;
  simulation_reliability: number;
  tool_readiness: number;
  conflict_index: number;
  controllability_score: number;
  recommended_action: MetaControlAction;
  failure_modes: FailureMode[];
  critique_summary: string;
  verification_trace?: VerificationTrace;
}
```

---

## 5. 过程级验证协议

### 5.1 VerificationTrace

```ts
interface VerificationTrace {
  verifier_runs: VerifierRun[];
  contested_steps: ContestedStep[];
  evidence_gaps: EvidenceGap[];
  counterfactual_checks: CounterfactualCheck[];
  final_verdict: "pass" | "weak-pass" | "fail" | "inconclusive";
}
```

### 5.2 Step 标签

对过程级监督，建议统一支持：

- `valid`
- `unsupported`
- `contradictory`
- `unverifiable`
- `dangerous`

这意味着 Deep Evaluator 不是只判最终对错，而是对高影响中间步骤逐步标注。

---

## 6. 汇总评估对象

### 6.1 MetaAssessment

```ts
interface MetaAssessment {
  assessment_id: string;
  session_id: string;
  cycle_id: string;
  meta_state: MetaState;
  confidence: ConfidenceVector;
  uncertainty_decomposition: UncertaintyDecomposition;
  failure_modes: FailureMode[];
  recommended_control_action: MetaControlAction;
  recommended_candidate_action_id?: string;
  rationale: string;
  created_at: string;
}
```

### 6.2 SelfEvaluationReport

```ts
interface SelfEvaluationReport {
  report_id: string;
  session_id: string;
  cycle_id: string;
  stage_scores: {
    retrieval_quality?: number;
    evidence_sufficiency?: number;
    plan_coherence?: number;
    execution_readiness?: number;
    recovery_readiness?: number;
  };
  contradictions: ContradictionRecord[];
  missing_evidence: MissingEvidenceItem[];
  failure_diagnosis?: FailureDiagnosis;
  selected_control_mode: string;
  selected_meta_actions: MetaControlAction[];
  explanation: string;
  created_at: string;
}
```

### 6.3 为什么需要两层对象

- `MetaAssessment`
  - 面向 runtime 决策
  - 结构更紧凑
- `SelfEvaluationReport`
  - 面向 trace / replay / console / 审计
  - 更强调解释与过程记录

---

## 7. 与现有协议的衔接建议

### 7.1 `WorkspaceSnapshot`

建议追加：

- `metacognitive_state?: MetacognitiveStateSnapshot`
- `meta_assessment_ref?: string`
- `self_evaluation_report_ref?: string`

### 7.2 `MetaDecision`

当前只有：

- `execute_action`
- `request_approval`
- `abort`

建议扩展为支持 `MetaControlAction`，或者新增 `meta_actions` 字段：

- `request-more-evidence`
- `run-more-samples`
- `invoke-verifier`
- `replan`
- `decompose-goal`
- `switch-to-safe-response`
- `ask-human`

### 7.3 `CycleTrace`

建议记录：

- `meta_signal_frame`
- `fast_meta_assessment`
- `deep_meta_assessment`
- `self_evaluation_report`

否则后续校准和 replay 会失去关键上下文。

---

## 8. 包结构映射

### `@neurocore/protocol`

新增：

- `MetaSignalFrame`
- `MetaAssessment`
- `ConfidenceVector`
- `UncertaintyDecomposition`
- `VerificationTrace`
- `MetaControlAction`
- `MetaState`

### `@neurocore/runtime-core`

建议新增：

```text
src/meta/
  signal-bus.ts
  fast-monitor.ts
  deep-evaluator.ts
  verifier.ts
  control-allocator.ts
  calibrator.ts
  reflection-learner.ts
  meta-controller-v2.ts
```

### `@neurocore/memory-core`

建议新增：

- `reflection-memory`
- `calibration-store`
- `provider-reliability-store`

---

## 9. 结论

外部专家报告里最应该保留的，不是某一条规则，而是这套协议观：

- 元认知输入必须结构化
- 评估状态必须多维化
- confidence 必须向量化
- 过程验证必须可回放
- runtime 决策与 trace 审计必须解耦但可关联

这也是 NeuroCore 进入深层自评估之后，协议层最核心的一次升级。
