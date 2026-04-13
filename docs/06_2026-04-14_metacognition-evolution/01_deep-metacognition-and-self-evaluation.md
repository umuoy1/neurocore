# 深层元认知与自评估系统设计

> 2026-04-14
> 来源输入：
> - 当前代码中的 `MetaController / Workspace / Prediction / Trace / Memory` 主链
> - 外部专家报告 [`neuro_core_元认知系统深层自评估升级设计.md`](/Users/sizz/Code/neurocore/neuro_core_元认知系统深层自评估升级设计.md)
>
> 本文档不直接复述外部报告，而是对其进行架构化拆分，形成 NeuroCore 可继续实现的正式设计输入。

---

## 0. 文档定位

本文档是 2026-04-14 这轮元认知升级的主设计稿，目标是把当前 `MetaController` 从：

- 轻量式启发仲裁器

升级为：

- 深层自评估与认知控制系统

它承担三种角色：

1. 对当前 Prefrontal / Meta 现状做严格诊断
2. 对外部专家报告做正式拆分与收敛
3. 为后续协议、实现和评测文档提供上位输入

配套拆分文档：

- [02_meta-signal-assessment-and-protocol.md](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/02_meta-signal-assessment-and-protocol.md)
- [03_control-allocation-learning-and-benchmark.md](/Users/sizz/Code/neurocore/docs/06_2026-04-14_metacognition-evolution/03_control-allocation-learning-and-benchmark.md)

---

## 1. 当前系统的问题诊断

当前前额叶模块已经做到了：

- 对候选行动按 success probability、uncertainty、policy warn/block、side-effect、prediction error rate 做排序
- 检测近似分数冲突
- 在风险高、存在 warn、side-effect 高或误差率高时触发审批
- 在预算超限时终止

这套设计的优点是：

- 简单
- 可解释
- 工程可落地
- 与现有 `Workspace / Policy / Prediction / Budget` 结构兼容

但它仍然不是“深层元认知”，而更像“规则化执行门控器”。

### 1.1 当前缺失的关键能力

#### A. 缺少多维置信度分解

当前系统基本把“置信度”压缩成一个单分数，无法回答：

- 是因为任务本身陌生而不自信
- 还是因为证据不足
- 还是因为多个候选方案彼此矛盾
- 还是因为工具调用前提条件不满足
- 还是因为预测器本身不可靠

#### B. 缺少过程级自评估

当前系统主要在“行动前”做一次仲裁，但没有系统性检查：

- 中间推理步骤是否自洽
- 计划的每一步是否真的支撑目标
- reasoning path 是否出现局部错误但最终偶然选对
- 是否应该在执行前追加验证步骤

#### C. 缺少元认知控制分配

真实元认知不是“是否执行”这么简单，而是“是否值得为这件事投入更多认知资源”。

当前系统缺少：

- 是否需要更多 sample
- 是否需要外部 verifier
- 是否需要额外 memory retrieval
- 是否需要世界模型前向模拟
- 是否需要拆解 goal
- 是否需要切换到慢思考模式

#### D. 缺少校准闭环

当前 confidence 基本是运行时即时分数，而不是经过长期校准的可信概率。

它无法系统回答：

- 过去相似任务上 0.8 confidence 到底有多靠谱
- 哪类任务最容易过度自信
- 哪个 reasoner / predictor / skill provider 的自评估最失真
- 哪个模型在高风险工具调用上校准最差

#### E. 缺少事后反思学习

当前失败会进记忆，但不会真正形成元认知层面的更新：

- 不会沉淀为“以后遇到这种模式先别急着执行”
- 不会提炼成“这类任务必须先验证 X 再做 Y”
- 不会形成“在哪些条件下应该扩大推理预算”的经验策略

### 1.2 结论

当前系统不是没有元认知，而是：

- 有门控
- 有风险意识
- 有最小冲突检测

但还没有：

- 分层元认知控制
- 过程级自评估
- 校准学习
- 反思记忆
- 控制价值分配

所以本次升级不应被视为“增强 MetaController”，而应被视为一次 **Prefrontal Control Stack** 重构。

---

## 2. 升级目标

目标不是做一个更复杂的 `if/else MetaController`，而是构建一个 **Meta-Cognitive Control Stack**。

新系统必须具备五类能力：

1. **监测自身状态**
   - 识别不确定性、冲突、证据不足、熟悉度不足、预测器失配、工具前提不足
2. **评估候选认知过程**
   - 不只评估最终 action，也评估 reasoning trace、subgoal decomposition、evidence chain、simulation quality
3. **控制认知资源分配**
   - 决定是否增加采样数、是否升级 verifier、是否检索更多记忆、是否拆目标、是否要求人工审批
4. **事后归因与学习**
   - 将成功/失败反馈变成 calibration 更新、reflection memory、policy refinement、skill extraction 信号
5. **校准自身置信度**
   - 使 confidence 逐渐变成“可被信任的概率”，而不是“看起来像概率的分数”

---

## 3. 设计原则

### 原则 1：自我报告不等于元认知

不能只问模型“你有多确定？”。

必须把以下信号一起纳入：

- 推理路径一致性
- 候选方案间分歧度
- 检索证据覆盖率
- 预测器不确定性
- 工具前置条件满足度
- 过往相似任务成功率
- 当前任务分布外程度

### 原则 2：元认知必须分层

元认知不该是单个函数，而该分成：

- 快速监测层
- 深度评估层
- 控制分配层
- 事后学习层

### 原则 3：元认知要关注过程，不只关注结果

要同时评估：

- 结论是否靠谱
- 推理过程是否靠谱
- 当前是否掌握足够信息
- 是否值得继续投入推理算力

### 原则 4：深层自评估必须闭环

必须形成：

```text
预测 -> 执行 -> 观察 -> 误差 -> 归因 -> 校准 -> 下次更好预测
```

### 原则 5：元认知是控制系统，不只是诊断系统

真正的价值不在“知道自己不确定”，而在“知道不确定后该怎么做”。

---

## 4. 总体方案：前额叶控制栈

建议将当前单体 `MetaController` 升级为五层系统：

```text
Layer 0  Meta Signal Bus         元信号总线
Layer 1  Fast Monitor            快速监测器
Layer 2  Deep Evaluator          深度评估器
Layer 3  Control Allocator       控制分配器
Layer 4  Post-Hoc Learner        事后学习器
```

### 4.1 Layer 0：Meta Signal Bus

职责：

- 统一采集各模块的元认知相关信号
- 让“关于认知本身的数据”成为第一等输入

输入信号分六类：

- 任务与分布信号
- 证据信号
- 推理信号
- 预测与模拟信号
- 行动与工具信号
- 治理信号

### 4.2 Layer 1：Fast Monitor

定位：

- System 1 式元认知
- 快、便宜、保守
- 适合每个 cycle 都运行

它不直接决定最终 action，而是输出：

- `provisional_confidence`
- `meta_state`
- `trigger_deep_eval`
- `recommended_control_actions[]`

典型 `MetaState`：

- `routine-safe`
- `routine-uncertain`
- `novel-but-manageable`
- `high-conflict`
- `evidence-insufficient`
- `simulation-unreliable`
- `high-risk`
- `needs-deep-eval`

### 4.3 Layer 2：Deep Evaluator

定位：

- System 2 式元认知
- 慢、成本高、只在必要时触发
- 关注 reasoning process，而不仅是 outcome

它由五个核心子能力构成：

- `Multi-Sample Deliberation`
- `Generator–Verifier Split`
- `Process Critic / Step Verifier`
- `Counterfactual Simulator`
- `Evidence Closure Checker`

其核心问题不再是：

```text
哪个 action 分数最高
```

而是：

```text
在当前证据、过程质量、模拟可靠性和风险约束下，
是否值得执行这个 action；
如果不值得，最优的认知动作是什么
```

### 4.4 Layer 3：Control Allocator

元认知最终不是一个评分器，而是一个 **控制资源分配器**。

它回答的核心问题是：

```text
继续投入认知成本，值不值
```

动作空间包括：

- `execute-now`
- `execute-with-approval`
- `request-more-evidence`
- `run-more-samples`
- `invoke-verifier`
- `replan`
- `decompose-goal`
- `switch-to-safe-response`
- `ask-human`
- `abort`

核心目标函数采用简化版控制价值：

```text
Expected Value of Control
= expected performance gain
- inference cost
- latency cost
- added failure exposure
```

### 4.5 Layer 4：Post-Hoc Learner

这是当前系统最缺的一层。

它的目标是把每次执行结果转化为：

- confidence calibration 更新
- 结构化 reflection
- 失败模式统计
- provider 可靠度画像
- future gating rules
- skill extraction signal

其三类核心产物：

- `Calibration Records`
- `Reflection Memory`
- `Meta Policies`

---

## 5. 关键升级：从单置信度到置信度向量

当前系统最需要改的，不是分数公式，而是表示方式。

建议将单一 confidence 改为：

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

这样才能区分：

- 结论像是对的，但证据不够
- 推理看似顺，但工具前提不成立
- 预测器很自信，但历史上该类任务经常错
- 操作可能成功，但副作用不可接受

---

## 6. 新的运行机制

当前主链大致是：

```text
Retrieve -> Predict -> Policy -> Meta score -> Execute/Abort/Approval
```

升级后主链变为：

```text
Perceive
  -> Retrieve
  -> Simulate
  -> Deliberate
  -> Meta Sense
  -> Fast Monitor
  -> Deep Evaluator
  -> Control Allocator
  -> Execute / Clarify / Escalate / Re-enter Cycle
  -> Observe
  -> Post-Hoc Learn
```

伪代码：

```ts
const signals = metaSignalBus.collect(ctx, workspace, candidates, predictions, policies);

const fast = fastMonitor.assess(signals);

let deep: DeepMetaAssessment | undefined;
if (fast.trigger_deep_eval) {
  deep = await deepEvaluator.evaluate(ctx, signals, candidates);
}

const metaDecision = controlAllocator.allocate({
  ctx,
  signals,
  fast,
  deep,
  budget: workspace.budget_assessment,
});

switch (metaDecision.action) {
  case "execute-now":
    return execute(selectedAction);
  case "request-more-evidence":
    return scheduleRetrieval();
  case "invoke-verifier":
    return runVerifier();
  case "decompose-goal":
    return decomposeGoal();
  case "ask-human":
    return requestApproval();
  case "abort":
    return abort();
}
```

---

## 7. 与六模块的重新分工

深层元认知虽然由 Prefrontal 主导，但并不意味着所有判断都在一个模块里完成：

- **Cortex**
  - 产出 reasoning candidate、自我解释、多样化路径
- **Hippocampal**
  - 提供历史成功率、反思规则、校准上下文
- **Cerebellar**
  - 提供反事实模拟、误差趋势、恢复成本估计
- **Amygdala**
  - 提供风险、紧迫性、损失厌恶信号
- **Basal Ganglia**
  - 提供技能快通路及其稳定性画像
- **Prefrontal**
  - 汇总状态、分配认知资源、决定快慢通路与升级策略

因此 Prefrontal 不再只是“执行前打分器”，而是全系统的认知控制器。

---

## 8. 与现代大模型、ML、神经科学的对齐

### 8.1 现代大模型

系统要从：

- 单一 reasoner

升级为：

- `reasoner + verifier`
- 多路径一致性
- 过程监督
- selective execution

### 8.2 机器学习

系统要明确引入：

- calibration
- ECE / Brier score
- uncertainty decomposition
- OOD / novelty 信号
- expected value of control

### 8.3 神经科学

推荐的功能映射：

- `ACC` -> conflict + error monitor
- `dlPFC` -> control allocation
- `anterior insula` -> multi-source uncertainty integration
- `OFC / vmPFC` -> risk / value integration

---

## 9. 实施路线

### Phase 1：把“分数”改成“结构化 assessment”

交付：

- `MetaAssessment`
- `FastMonitor`
- `MetaState`
- `ConfidenceVector`

### Phase 2：引入深度评估触发器

交付：

- `DeepEvaluator`
- `VerificationTrace`
- `MetaControlAction`

### Phase 3：引入校准器

交付：

- `CalibrationRecord`
- `Calibrator`
- `provider reliability profile`

### Phase 4：引入反思学习器

交付：

- `ReflectionLearner`
- `ReflectionRule`
- `ReflectionMemory`

### Phase 5：引入 expected value of control

交付：

- `ControlAllocator`
- 成本-收益评估器
- 深评估预算调度器

---

## 10. 结论

NeuroCore 当前的 Meta 能力已经具备门控价值，但还不具备“真正知道自己什么时候不知道、为什么不知道、该怎么补救”的深层能力。

本次 2026-04-14 的正式收敛结论是：

**应将 NeuroCore 的元认知系统升级为一个以元信号总线为输入、以快速监测与深度评估为双通路、以控制分配为核心、以校准与反思学习为闭环的前额叶控制栈。**

它不只是回答：

```text
我该执行哪个动作
```

而是回答：

```text
在当前能力、证据、风险、预算与历史校准条件下，
我是否应该执行、验证、补证据、重规划、升级审批，
还是暂时不做
```
