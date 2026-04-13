# 控制分配、学习闭环与 Benchmark 设计

> 2026-04-14
> 上位输入：
> - [深层元认知与自评估系统设计](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md)
> - [元信号、评估状态与协议拆分](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/02_meta-signal-assessment-and-protocol.md)
> - [外部专家报告](/Users/sizz/Code/neurocore/neuro_core_元认知系统深层自评估升级设计.md)
>
> 2026-04-14 实现状态补充：
> - `@neurocore/eval-core` 已新增 `meta-benchmark.ts`
> - 已实现 `ECE / Brier / Overconfidence Failure Rate`
> - 已实现 `FastMonitor / DeepEvaluator / ControlAllocator / Risk Gating / Evidence Sensitivity / Learning Reflection` 六组 benchmark 指标
> - 已补 focused tests，当前仍缺真实 benchmark 数据集、online eval 管线与 `ReflectionLearner` 驱动的长期回归集

---

## 1. 控制分配器的核心问题

元认知最终不是一个评分器，而是一个 **控制资源分配器**。

它要回答的核心问题是：

```text
继续投入认知成本，值不值
```

这与神经科学里的 `control allocation` 高度对应，也决定了系统何时进入慢路径、何时升级审批、何时直接放弃。

---

## 2. MetaControlAction 动作空间

```ts
type MetaControlAction =
  | "execute-now"
  | "execute-with-approval"
  | "request-more-evidence"
  | "run-more-samples"
  | "invoke-verifier"
  | "replan"
  | "decompose-goal"
  | "switch-to-safe-response"
  | "ask-human"
  | "abort";
```

这里的关键变化是：

- 元动作不再只是“允许执行 / 不允许执行”
- 而是显式调度内部认知动作

这让系统可以选择：

- 先补信息
- 先做更慢的验证
- 先分解目标
- 先切到更安全的响应

而不是被迫在“盲走”和“停止”之间二选一。

---

## 3. 控制价值函数

建议引入简化版的 `Expected Value of Control`：

```text
Expected Value of Control
= expected performance gain
- inference cost
- latency cost
- added failure exposure
```

### 3.1 直觉解释

- 简单低风险任务，不值得开深层评估
- 高风险且可通过额外验证显著降低错误率的任务，值得投入更多认知计算
- 明显证据不足的任务，继续“思考”不如先“补信息”

### 3.2 五条核心策略

#### 策略 A：风险驱动升级

`side-effect`、不可逆性、对外部世界影响越高，越偏向慢思考和审批。

#### 策略 B：冲突驱动升级

候选方案分歧越大，越需要深度验证，而非直接取 top-1。

#### 策略 C：证据驱动升级

关键证据缺失时，不应加深 reasoning，而应优先检索。

#### 策略 D：熟悉度驱动降级

对高熟悉、低风险、历史校准良好的任务，允许使用快速通路。

#### 策略 E：校准驱动纠偏

如果某类任务上系统一直过度自信，就提高该任务桶的审慎度与审批概率。

---

## 4. 事后学习器

### 4.1 定位

NeuroCore 已经有记忆与 trace，但还没有真正的 **元认知学习器**。

它的目标是把每次执行结果转化为：

- confidence calibration 更新
- 反思文本
- 失败模式统计
- provider 可靠度画像
- future gating rules
- skill extraction signal

### 4.2 事后学习输入

- 最终 outcome
- prediction vs observation gap
- reasoning trace
- verifier trace
- tool execution result
- human correction / approval / rejection
- rollback / repair 成本

### 4.3 三类产物

#### A. Calibration Records

记录：

- 任务类型
- 初始 confidence
- calibrated confidence
- 实际 outcome
- 风险等级
- 是否使用 deep eval

#### B. Reflection Memory

沉淀成结构化反思，而不是只有自然语言总结。

示例：

- `pattern`: 用户要求实时事实 + 未检索
- `failure`: 过早回答
- `remedy`: 先调用 web / evidence retrieval 再行动
- `future_trigger`: 事实时效性高时强制补证据

#### C. Meta Policies

把高价值反思沉淀为可执行规则或轻量策略。

例如：

- 财务、医疗、法律、高风险外部操作上，若 `evidence_sufficiency < 0.7`，禁止直接执行
- 当 predictor 在某 domain 的近 50 次 calibration ECE 高于阈值时，关闭自动执行

---

## 5. 校准对象

### 5.1 CalibrationRecord

```ts
interface CalibrationRecord {
  record_id: string;
  task_bucket: string;
  predicted_confidence: number;
  calibrated_confidence: number;
  observed_success: boolean;
  risk_level: string;
  deep_eval_used: boolean;
  created_at: string;
}
```

### 5.2 ReflectionRule

```ts
interface ReflectionRule {
  rule_id: string;
  pattern: string;
  trigger_conditions: string[];
  recommended_control_action: MetaControlAction;
  strength: number;
  evidence_count: number;
}
```

### 5.3 长期要维护的画像

- `task bucket calibration`
- `provider reliability profile`
- `skill stability profile`
- `domain-specific overconfidence map`

---

## 6. Benchmark 设计

如果不做评估，元认知升级很容易沦为“看起来更复杂”。

### 6.1 校准指标

- `ECE`
- `Brier score`
- `reliability diagram by task bucket`
- `overconfidence rate on failed executions`

### 6.2 选择性执行指标

- 低 confidence 桶中拒答 / 升级 / 补证据是否有效降低事故率
- `risk-conditioned success rate`
- `selective risk curve`

### 6.3 深评估价值指标

- `deep eval invocation rate`
- `deep eval save rate`
- `deep eval wasted cost rate`

其中：

- `save rate` 指若无 deep eval 会错，有 deep eval 被纠正的比例
- `wasted cost rate` 指 deep eval 启动了但没有实质收益的比例

### 6.4 反思学习指标

- 相似失败模式的复发率
- `reflection-to-policy conversion rate`
- `reflection-triggered avoidance success rate`

### 6.5 人机协作指标

- 审批升级准确率
- 不必要人工打扰率
- 高风险错误漏检率

## 6.6 当前代码实现映射

当前代码落点在：

- [meta-benchmark.ts](/Users/sizz/Code/neurocore/packages/eval-core/src/meta-benchmark.ts)
- [meta-benchmark.test.mjs](/Users/sizz/Code/neurocore/tests/meta-benchmark.test.mjs)

当前已进入代码库的指标组：

- `calibration`
  - `ece`
  - `brier_score`
  - `overconfidence_failure_rate`
- `fast_monitor`
  - `primary_state_accuracy`
  - `trigger_tag_hit_rate`
  - `deep_eval_trigger_precision`
  - `deep_eval_trigger_recall`
  - `cheap_intervention_fit_rate`
- `selective_execution`
  - `selective_accuracy`
  - `coverage`
  - `high_risk_selective_accuracy`
- `deep_eval`
  - `invocation_rate`
  - `save_rate`
  - `waste_rate`
  - `conflict_resolution_gain`
  - `post_deep_confidence_quality`
  - `high_risk_correction_rate`
- `control_allocator`
  - `control_action_accuracy`
  - `action_regret`
  - `approval_overuse_rate`
  - `unsafe_under_escalation_rate`
- `risk_gating`
  - `high_risk_false_pass_rate`
  - `approval_escalation_precision`
  - `unsafe_execute_rate`
- `evidence_sensitivity`
  - `evidence_seeking_rate_when_needed`
  - `unsupported_answer_rate`
  - `evidence_closure_success_rate`
- `learning_reflection`
  - `failure_recurrence_rate`
  - `reflection_trigger_rate`
  - `reflection_to_policy_conversion_rate`
  - `post_reflection_avoidance_gain`

当前边界也要明确：

- 还没有官方 meta benchmark 数据集
- 还没有 `coverage vs accuracy curve` 和 `risk-conditioned selective curve` 的批量导出
- `action_regret` 目前仍是基于 `expected/hindsight control behavior` 的离散 regret，不是成本模型
- `ReflectionLearner` 还未真正落库，因此学习相关指标目前依赖外部构造 observation

---

## 7. Eval 套件映射

### `@neurocore/eval-core`

建议新增：

- `calibration eval`
- `selective prediction eval`
- `intervention efficiency eval`
- `reflection quality eval`
- `high-risk action gating eval`

### 与现有基准的关系

#### LongMemEval

用于检查：

- 记忆召回不足时是否能识别“证据不够”
- 是否能触发 `request-more-evidence`
- 是否能在不确定时选择 abstain / defer

#### baseline eval / tool replay

用于检查：

- tool failure
- stale state
- 目标分解错误
- 审批拒绝
- 长链失败恢复

#### Slow-path ROI

对比：

- 无 slow path
- 总是 slow path
- 自适应 slow path

比较：

- 成功率
- token 成本
- latency
- 人工升级率

---

## 8. 实施路线

### Phase 1：结构化 assessment

交付：

- `MetaAssessment`
- `FastMonitor`
- 兼容旧 `MetaController`

### Phase 2：深度评估触发器

交付：

- `DeepEvaluator`
- `VerificationTrace`
- `MetaControlAction` 扩展

### Phase 3：校准器

交付：

- `CalibrationRecord`
- `Calibrator`
- `provider reliability profile`

### Phase 4：反思学习器

交付：

- `ReflectionLearner`
- `ReflectionRule`
- `ReflectionMemory`

### Phase 5：控制价值分配

交付：

- `ControlAllocator`
- 成本-收益评估器
- 深评估预算调度器

---

## 9. 可继续演进的方向

外部专家报告里还有五条值得保留的脑暴方向：

### A. MetaController 多代理委员会

角色拆成：

- Critic Agent
- Verifier Agent
- Risk Agent
- Budget Agent
- Integrator Agent

### B. Process Reward Model

为步骤级验证引入独立过程评分器，尤其适用于：

- 代码
- 数学
- 多步工具调用
- 复杂规划

### C. 元认知世界模型

不仅建模外部世界，还建模“自己能力边界”：

- 擅长什么
- 容易在哪些任务上过度自信
- 哪些工具组合容易失败
- 哪些证据源最不可靠

### D. 与技能下放联动

- 深层评估成功多次的策略 -> 下放为快通路技能
- 快通路技能连续失败 -> 拉回前额叶慢通路重新审查

### E. 主动求知型元认知

不仅在“不确定”时刹车，也在“高价值未知”时主动探索。

---

## 10. 结论

这份拆分文档收敛出的核心判断是：

- 深层元认知的实现关键不在于再加一个 verifier
- 而在于把 verifier、校准、反思、预算、审批、恢复整合成一个统一的控制学习闭环

只有这样，NeuroCore 才会从：

- 有门控的 Agent Runtime

升级成：

- 有认知控制能力的 Agent Runtime
