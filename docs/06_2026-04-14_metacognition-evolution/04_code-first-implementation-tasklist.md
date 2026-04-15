# 深层元认知系统代码实施单

> 2026-04-14
> 作用：把 4.14 元认知设计直接压到“下一步可写代码”的粒度
> 上位输入：
> - [01_deep-metacognition-and-self-evaluation.md](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md)
> - [02_meta-signal-assessment-and-protocol.md](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/02_meta-signal-assessment-and-protocol.md)
> - [03_control-allocation-learning-and-benchmark.md](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/03_control-allocation-learning-and-benchmark.md)
>
> 2026-04-14 实施状态：
> - WP-1 协议升级：已完成
> - WP-2 Meta Signal Bus：已完成
> - WP-3 Fast Monitor：已完成
> - WP-4 CycleEngine 接线：已完成
> - WP-5 Workspace / Trace 接线：已完成
> - WP-6 Focused tests：已完成
> - WP-7 DeepEvaluator：已完成
> - WP-8 `MetaControlAction` 的安全 runtime 消费：部分完成
> - WP-9 最小 Calibrator：已完成
> - 2026-04-14 子稿一增强：已完成 `FastMonitor V2` 标签化诊断、显式权重、预算抑制与 `DeepEvaluator` 子检查器路由
> - 2026-04-14 子稿二增强：已完成 `MetaSignalBus` 的 `goal_id / provenance / predictor reliability / budget pressure` 接线与聚合规则收紧
> - 2026-04-14 子稿三增强：已完成 `@neurocore/eval-core` 的 `meta-benchmark.ts` 基础实现，已覆盖 calibration、fast monitor、deep eval、control allocator、risk gating、evidence sensitivity、learning reflection 七组评分输出
> - 2026-04-15 收口方向更新：下一阶段不再横向扩概念模块，转为 `控制平面收口 -> calibration 单一路径 -> DeepEvaluator SPI -> Signal Bus provider 化 -> meta eval 数据集与 online 管线`
> - 2026-04-15 Phase 1 / 2 代码状态：`ControlAllocator` 已成为最终控制动作的单真源，`DefaultMetaController` 已退化为 adapter；`Calibrator` 已升级为 `query + calibrate + record` 单一路径，`DeepEvaluator` 私有校准已移除，`SqliteCalibrationStore`、task bucket、决策前查询与决策后写回均已进入代码库
> - 2026-04-15 Phase 3 代码状态：`DeepEvaluator` 已切为 `Verifier SPI` 编排层，默认 `logic / evidence / tool / safety / process` verifiers 与可选 `CounterfactualSimulator SPI` 已进入主链，支持并发执行、部分失败降级与 budget-aware 选择
> - 2026-04-16 Phase 4 代码状态：`MetaSignalBus` 已完成 family-provider 第一版，`task / evidence / reasoning / prediction / action / governance` 六类 `Heuristic*Provider`、provider registry、family merge rules、degraded/fallback provenance 与关键缺失值保守化已进入主链；provider 失败时总线仍可产出 frame，缺失 prediction family 时下游不会继续判成 `routine-safe`
> - 后续批次：真实 benchmark 数据集与 CI/online meta eval、`ReflectionLearner`

---

## 1. 目标

下一步代码实现不追求一次性把完整的五层前额叶控制栈全部落完，而是先做一个 **可闭环、可回放、可继续迭代** 的 Phase 1 主线：

```text
Meta Signal Bus
  + Fast Monitor
  + 结构化 MetaAssessment / SelfEvaluationReport
  + Workspace / Trace 接线
  + 兼容旧 MetaController 的决策输出
```

也就是说，第一批代码的目标不是马上引入完整 `DeepEvaluator / Calibrator / ReflectionLearner`，而是先把：

- 元认知输入结构化
- 元认知状态显式化
- 元认知报告写进 trace
- runtime 主链能消费这些新状态

这四件事打通。

---

## 2. 当前真实代码边界

下一步代码必须以当前仓库真实实现为准，不按理想接口空写。

### 2.1 当前协议事实

当前关键类型位于：

- [types.ts](/Users/sizz/Code/neurocore/packages/protocol/src/types.ts)
- [interfaces.ts](/Users/sizz/Code/neurocore/packages/protocol/src/interfaces.ts)

当前真实边界：

- `WorkspaceSnapshot` 只有：
  - `risk_assessment`
  - `confidence_assessment`
  - `competition_log`
- `MetaDecision` 主要输出：
  - `continue_internal`
  - `ask_user`
  - `execute_action`
  - `request_approval`
  - `escalate`
  - `complete`
  - `abort`
- `CycleTraceRecord` 目前能带：
  - `workspace`
  - `predictions`
  - `policy_decisions`
  - `selected_action`
  - `action_execution`
  - `observation`

它还没有：

- `MetaSignalFrame`
- `MetaAssessment`
- `SelfEvaluationReport`
- `ConfidenceVector`
- `UncertaintyDecomposition`

### 2.2 当前 runtime 事实

当前元认知入口在：

- [meta-controller.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/meta/meta-controller.ts)
- [cycle-engine.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/cycle/cycle-engine.ts)

当前 `DefaultMetaController` 是：

- 基于 action 排序的门控器
- 直接吃 `actions / predictions / policies / predictionErrorRate`
- 直接输出最终 `MetaDecision`

所以 Phase 1 的策略必须是：

- 不先推翻它
- 而是在它前面补一层结构化 `FastMonitor`
- 再让 `DefaultMetaController` 逐步退化为兼容层

### 2.3 当前 trace 事实

当前 trace 记录在：

- [trace-recorder.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/trace/trace-recorder.ts)
- [types.ts](/Users/sizz/Code/neurocore/packages/protocol/src/types.ts)

这意味着如果 Phase 1 不把元认知对象写进 `CycleTraceRecord`，后面所有校准、replay、console 都会缺输入。

---

## 3. 实施范围

## 3.1 本批必须完成

1. 协议层新增元认知对象
2. runtime-core 新增 `MetaSignalBus` 和 `FastMonitor`
3. `CycleEngine` 在 meta decision 前生成 `MetaSignalFrame + FastMetaAssessment`
4. `WorkspaceSnapshot` 接入元认知状态
5. `CycleTraceRecord` 接入元认知报告
6. 补齐 focused tests

## 3.2 本批明确不做

1. 完整 `DeepEvaluator`
2. 多 sample consistency
3. generator-verifier split
4. counterfactual simulator 新 SPI
5. online calibrator
6. reflection learner
7. provider reliability store
8. Console 页面实现

也就是说，这一批是 **深层元认知的 Phase 1 工程底座**，不是全部能力一次交付。

---

## 4. 实施拆分

## 4.1 WP-1：协议升级

### 目标

先把结构化元认知对象放进 `@neurocore/protocol`，否则 runtime 只能继续传散乱字段。

### 文件

- [types.ts](/Users/sizz/Code/neurocore/packages/protocol/src/types.ts)
- [interfaces.ts](/Users/sizz/Code/neurocore/packages/protocol/src/interfaces.ts)

### 新增类型

- `MetaState`
- `MetaControlAction`
- `MetaSignalFrame`
- `TaskMetaSignals`
- `EvidenceMetaSignals`
- `ReasoningMetaSignals`
- `PredictionMetaSignals`
- `ActionMetaSignals`
- `GovernanceMetaSignals`
- `ConfidenceVector`
- `UncertaintyDecomposition`
- `FastMetaAssessment`
- `MetaAssessment`
- `SelfEvaluationReport`

### 现有类型增量字段

`WorkspaceSnapshot` 增加：

- `metacognitive_state?: FastMetaAssessment`
- `meta_signal_frame_ref?: string`
- `meta_assessment_ref?: string`
- `self_evaluation_report_ref?: string`

`CycleTraceRecord` 增加：

- `meta_signal_frame?: MetaSignalFrame`
- `fast_meta_assessment?: FastMetaAssessment`
- `meta_assessment?: MetaAssessment`
- `self_evaluation_report?: SelfEvaluationReport`

`MetaDecision` 增加：

- `meta_actions?: MetaControlAction[]`
- `meta_state?: MetaState`

### 验收标准

- protocol 编译通过
- 新增字段全部是向后兼容的 optional 字段
- 不破坏现有 `MetaController` 接口调用

---

## 4.2 WP-2：Meta Signal Bus

### 目标

把当前分散在 workspace、prediction、policy、goal、action 上的元认知信号收束成一个 frame。

### 文件

- 新增 [signal-bus.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/meta/signal-bus.ts)
- 更新 [index.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/index.ts)

### 最小实现要求

`MetaSignalBus.collect(...)` 先只吃当前已存在数据：

- `WorkspaceSnapshot`
- `CandidateAction[]`
- `Prediction[]`
- `PolicyDecision[]`
- `predictionErrorRate`
- `Goal[]`
- `ModuleContext.runtime_state`

### 第一批必须产出的信号

`task_signals`

- `task_novelty`
- `goal_decomposition_depth`
- `unresolved_dependency_count`

`evidence_signals`

- `retrieval_coverage`
- `missing_critical_evidence`

`reasoning_signals`

- `candidate_reasoning_divergence`
- `contradiction_score`

`prediction_signals`

- `predicted_success_probability`
- `simulator_confidence`
- `uncertainty_decomposition`

`action_signals`

- `tool_precondition_completeness`
- `side_effect_severity`
- `reversibility_score`

`governance_signals`

- `policy_warning_density`
- `budget_pressure`
- `need_for_human_accountability`

### 工程约束

- 允许用启发式计算
- 不引入新 model 调用
- 不依赖未实现的 world-model 深模拟

### 验收标准

- 每个 cycle 都能生成 `MetaSignalFrame`
- 无数据时也能给出保守默认值
- 不影响当前 action 执行主链

---

## 4.3 WP-3：Fast Monitor

### 目标

把当前“隐含在 `DefaultMetaController` 打分公式里的前额叶逻辑”显式化成结构化快速监测器。

### 文件

- 新增 [fast-monitor.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/meta/fast-monitor.ts)
- 轻改 [meta-controller.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/meta/meta-controller.ts)

### 输出对象

- `FastMetaAssessment`
- `MetaState`
- `recommended_control_actions`

### 第一批 `MetaState` 规则

- `routine-safe`
- `routine-uncertain`
- `high-conflict`
- `evidence-insufficient`
- `high-risk`
- `needs-deep-eval`

先不要一次上全量状态。

### 触发逻辑

至少基于：

- 候选 action 分差
- prediction uncertainty
- policy warn density
- prediction error rate
- side effect level
- evidence coverage
- budget pressure

### 与旧 `DefaultMetaController` 的关系

Phase 1 处理方式：

- `FastMonitor` 先产出结构化状态
- `DefaultMetaController` 继续负责最终 `MetaDecision`
- 但 `DefaultMetaController` 开始消费 `FastMetaAssessment`

不要在这一步就硬切到全新 `MetaControllerV2`。

### 验收标准

- 现有 `MetaDecision` 语义不变
- 新增 `meta_state` 和 `meta_actions`
- 高冲突、证据不足、高风险三类输入可稳定产出不同状态

---

## 4.4 WP-4：CycleEngine 接线

### 目标

把 Phase 1 的元认知主链接到 runtime 真正运行的 cycle 里。

### 文件

- [cycle-engine.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/cycle/cycle-engine.ts)

### 接线顺序

当前大致是：

```text
collect memory/skill
-> reason / respond
-> predictions
-> policies
-> metaController.evaluate
```

改成：

```text
collect memory/skill
-> reason / respond
-> predictions
-> policies
-> metaSignalBus.collect
-> fastMonitor.assess
-> workspace annotate metacognition
-> metaController.evaluate
```

### 最小改动原则

- 不调整主循环拓扑
- 不引入新的重入 cycle
- 只把状态接进现有 gate 前

### 验收标准

- 每个 cycle 返回结构化 meta artifacts
- 旧路径测试不回归

---

## 4.5 WP-5：Workspace 与 Trace 接线

### 目标

把元认知对象真正持久化到 runtime 可回放资产里。

### 文件

- [trace-recorder.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/trace/trace-recorder.ts)
- [types.ts](/Users/sizz/Code/neurocore/packages/protocol/src/types.ts)
- 可能涉及 [agent-runtime.ts](/Users/sizz/Code/neurocore/packages/runtime-core/src/runtime/agent-runtime.ts)

### 本批要求

`WorkspaceSnapshot` 至少带：

- `metacognitive_state`

`CycleTraceRecord` 至少带：

- `meta_signal_frame`
- `fast_meta_assessment`
- `meta_assessment`

`SelfEvaluationReport` 可以先做最小版：

- `stage_scores`
- `selected_control_mode`
- `selected_meta_actions`
- `explanation`

### 为什么这一批必须做

如果不把这些写进 trace：

- 后续 replay 无法看元认知状态
- calibration eval 无法回算
- console 无法做观察

### 验收标准

- `TraceRecorder` 能保存这些对象
- `ReplayRunner` 不报错
- session replay 结果里能看到 meta artifacts

---

## 4.6 WP-6：测试与验收

### 新增测试建议

- `tests/meta-fast-monitor.test.mjs`
- `tests/meta-signal-bus.test.mjs`
- `tests/meta-trace-integration.test.mjs`

### 扩展现有测试

- [memory-provider-config.test.mjs](/Users/sizz/Code/neurocore/tests/memory-provider-config.test.mjs)
  - 验证新字段不会破坏 snapshot/restore
- [skill-system.test.mjs](/Users/sizz/Code/neurocore/tests/skill-system.test.mjs)
  - 验证 procedural path 下元认知字段仍能生成
- 现有 runtime / cycle 相关测试
  - 验证 `MetaDecision` 新字段兼容

### 必须覆盖的场景

1. 低风险、低冲突
   - 输出 `routine-safe`
2. 高 side-effect + policy warn
   - 输出 `high-risk`
3. prediction uncertainty 高 + 候选分差小
   - 输出 `high-conflict` 或 `needs-deep-eval`
4. evidence coverage 低
   - 输出 `evidence-insufficient`
5. trace record
   - meta artifacts 已写入

### 验收命令

Phase 1 至少要跑：

```bash
npm run build
node --test tests/meta-fast-monitor.test.mjs tests/meta-signal-bus.test.mjs tests/meta-trace-integration.test.mjs
```

如果相关现有测试受影响，再加：

```bash
node --test tests/memory-provider-config.test.mjs tests/skill-system.test.mjs
```

---

## 5. 推荐 PR 切分

### PR-1：协议升级

范围：

- `@neurocore/protocol`

目标：

- 新类型与向后兼容字段

### PR-2：Meta Signal Bus + Fast Monitor

范围：

- `runtime-core/src/meta/*`

目标：

- 结构化输入与结构化快速元认知状态

### PR-3：Cycle / Workspace / Trace 接线

范围：

- `cycle-engine`
- `trace-recorder`
- `agent-runtime`

目标：

- 真正进入运行闭环与 replay 资产

### PR-4：测试与文档回归

范围：

- `tests/*`
- `docs/README.md`
- 本目录后续阶段状态更新

---

## 6. 风险与回退策略

### 风险 1：协议字段膨胀，影响现有调用方

缓解：

- 新字段全部 optional
- 不改变现有 `MetaController.evaluate(...)` 签名

### 风险 2：Fast Monitor 与 DefaultMetaController 逻辑重复

缓解：

- Phase 1 接受短期重复
- 先稳定结构，再在 Phase 2 合并/退化旧逻辑

### 风险 3：trace 数据体积上升

缓解：

- `SelfEvaluationReport` 先做最小版
- 不在 Phase 1 写入巨量 verifier trace

### 风险 4：设计过重，影响现有性能

缓解：

- Phase 1 禁止额外 model 调用
- 只做启发式信号计算

---

## 7. 当前下一步

当前 `M8.5 Phase 1 ~ 4` 已经进入代码库，下一步不再是继续扩协议或补 provider，而是严格转向：

1. 真实 meta benchmark case bundle
2. benchmark summary / persistence
3. CI 中独立 meta test group
4. online meta eval pipeline
5. 最后再进入 `ReflectionLearner`

不要跳回去重做：

- `ControlAllocator`
- `Calibrator`
- `DeepEvaluator SPI`
- `MetaSignalBus provider registry`

否则只会把已经收口的主链重新打散。

---

## 8. 一句话结论

当前最合理的切入点，不是继续横向扩元认知概念，而是：

**把已经成形的控制栈做成可持续评估、可回归比较、可进入 CI 的稳定工程系统。**
