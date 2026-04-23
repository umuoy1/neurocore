# M12 通用自主体能力：代码优先实施总计划

> 日期：2026-04-24
> 范围：FR-56 ~ FR-61
> 基线设计：[`../04_2026-03-31_next-stage/06_general-autonomy.md`](../04_2026-03-31_next-stage/06_general-autonomy.md)
> Milestone 清单：[`../04_2026-03-31_next-stage/milestones/m12-autonomy.md`](../04_2026-03-31_next-stage/milestones/m12-autonomy.md)
> 目标：把 M12 从“完整蓝图”压成“可直接施工、可阶段验收、最终可全量实现”的总实施单

当前代码状态：

- `Phase 0` 已完成：协议冻结、自治状态面、自治事件、trace/checkpoint/runtime snapshot round-trip
- `Phase 1` 已完成：`@neurocore/autonomy-core`、`DefaultAutonomousPlanner`、plan registry、plan-owned goals 注入、轻量 `monitorProgress/revisePlan`
- `Phase 2` 已完成：`DefaultSelfMonitor`、health report、drift detection、recovery recommendation、recovery goal 注入
- `Phase 3` 已完成：`DefaultIntrinsicMotivationEngine`、`DefaultSelfGoalGenerator`、`DefaultGoalFilter`、治理下的 agent-owned goal 注入
- `Phase 4` 已完成：`DefaultTransferAdapter`、`DefaultContinualLearner`、transfer validation、knowledge snapshot、baseline/curriculum 更新
- `Phase 5` 已完成：自治状态已回灌 `CycleEngine` / `Reasoner` / `PolicyProvider` / 记忆上下文，形成六模块自治增强第一版
- `Phase 6` 已完成：alignment gate、自治 trace/audit、M12 focused regression、autonomy benchmark summary 全部进入代码库

---

## 1. 目标定义

M12 的目标不是新增一个孤立模块，而是把已有的：

- Goal Tree
- World Model
- Multi-Agent
- Skill RL
- Memory
- Meta / Control
- Policy / Approval / Budget

整合成一个可以长期运行、可以自发生成目标、可以监控自身退化并触发恢复的自主层。

M12 完整实现后的最小定义是：

1. Agent 能生成跨周期的 `AutonomousPlan`
2. Agent 能在没有显式用户输入时，基于动机与世界状态生成受约束的候选目标
3. Agent 能把自我生成目标安全注入现有 Goal Tree
4. Agent 能在新域上做受验证的迁移，而不是盲目复用
5. Agent 能进行持续学习与离线巩固，而不明显破坏旧能力
6. Agent 能检测性能漂移并自动生成恢复路径
7. 所有自主决策都可追踪、可回放、可审计、可被人类阻断

---

## 2. 实施原则

### 2.1 不重写 runtime

M12 不新增第二套执行循环。所有自主能力必须挂接到现有：

- `AgentRuntime`
- `CycleEngine`
- `GoalManager`
- `WorkspaceSnapshot`
- `TraceRecorder`
- `RuntimeStateStore`

### 2.2 先收口协议，再接主链

顺序固定为：

1. 协议与状态模型
2. store / persistence
3. runtime 注入点
4. planner / motivation / monitor 等核心逻辑
5. 安全治理
6. benchmark / regression

### 2.3 先做可解释版本，再做复杂学习

M12 第一版只接受：

- 可解释规划
- 可解释动机评分
- 规则/统计驱动的恢复判断
- 可回放的目标注入与计划修订

不把“神经化”“黑盒策略网络”当作第一阶段默认实现。

### 2.4 自主不绕过治理

所有自我生成目标、自主恢复动作、跨域迁移结果，都必须经过：

- Amygdala / Policy
- Approval policy
- Budget policy
- Trace / Audit

不能走隐藏通道。

---

## 3. 最终交付范围

M12 全量完成时，必须交付以下 8 组能力：

1. `AutonomousPlanner`
2. `IntrinsicMotivationEngine`
3. `SelfGoalGenerator`
4. `TransferAdapter`
5. `ContinualLearner`
6. `SelfMonitor`
7. 六模块自治增强层
8. Safety / Alignment / Audit / Regression

---

## 4. 包与模块规划

新增包：

- `packages/autonomy-core`
  - `plan`
  - `goal-generation`
  - `monitor`
  - `safety`
- `packages/motivation-core`
  - `motivation`
  - `transfer`
  - `continual-learning`

允许修改的主链包：

- `packages/protocol`
- `packages/runtime-core`
- `packages/sdk-core`
- `packages/eval-core`
- `packages/policy-core`
- `packages/world-model`
- `packages/multi-agent`

原则：

- `autonomy-core` 负责计划、自主目标、自监控
- `motivation-core` 负责动机、迁移、持续学习
- `runtime-core` 只负责注入、调度和持久化边界，不承载自治逻辑本体

---

## 5. Phase 划分

M12 拆成 7 个 Phase，必须按顺序推进。

### Phase 0：协议冻结与自治状态面

目标：

- 冻结 M12 所需的协议、事件、持久化边界
- 明确哪些状态进入 session snapshot / checkpoint / trace

交付：

- `AutonomousPlan`
- `PlanPhase`
- `Checkpoint`
- `ContingencyBranch`
- `ResourceEstimate`
- `PlanFeedback`
- `PlanStatus`
- `IntrinsicMotivation`
- `CuriositySignal / CompetenceSignal / AutonomySignal`
- `ExplorationTarget`
- `SuggestedGoal`
- `DomainDescriptor / DomainSimilarity / TransferResult / Adaptation`
- `KnowledgeSnapshot / PerformanceBaseline / CurriculumStage`
- `HealthReport / ModuleHealth / DriftSignal / RecoveryRecommendation / RecoveryAction`
- `AutonomyState`
- `AutonomyDecision`

协议接线：

- `WorkspaceSnapshot.autonomy_state`
- `CycleTraceRecord.autonomy`
- `NeuroCoreEventType` 新增自治事件
- `RuntimeSessionSnapshot.autonomy_state`
- `SessionCheckpoint.autonomy_state`

新增事件至少包括：

- `plan.generated`
- `plan.revised`
- `plan.status_changed`
- `motivation.computed`
- `goal.self_generated`
- `transfer.attempted`
- `transfer.validated`
- `consolidation.completed`
- `drift.detected`
- `recovery.triggered`
- `recovery.completed`
- `health.report`

验收：

- `protocol` 编译通过
- 所有新事件进入判别联合类型
- `runtime` / `sdk` / `eval` 都能消费新类型

### Phase 1：Autonomous Planner v1

目标：

- 先做“长时规划”最小可用闭环
- 不等待完整动机和持续学习

范围：

- `AutonomousPlanner` SPI
- 默认 `HTN + LLM` 混合规划器
- `PlanPhase -> Goal` 注入
- `monitorProgress()`
- `revisePlan()`
- `ContingencyBranch`

主链接线：

- `AgentRuntime` 维护 plan registry
- `GoalManager` 支持 plan-owned goals
- `CycleEngine` 在 cycle 完成后回写 `PlanFeedback`
- `WorkspaceSnapshot` 显示当前激活 phase / next checkpoint

新增文件建议：

- `packages/autonomy-core/src/plan/autonomous-planner.ts`
- `packages/autonomy-core/src/plan/default-autonomous-planner.ts`
- `packages/autonomy-core/src/plan/plan-store.ts`
- `packages/autonomy-core/src/plan/in-memory-plan-store.ts`
- `packages/autonomy-core/src/plan/sqlite-plan-store.ts`

需修改：

- `packages/protocol/src/types.ts`
- `packages/protocol/src/events.ts`
- `packages/runtime-core/src/runtime/agent-runtime.ts`
- `packages/runtime-core/src/cycle/cycle-engine.ts`
- `packages/runtime-core/src/goal/goal-manager.ts`
- `packages/runtime-core/src/trace/trace-recorder.ts`

验收：

- 给定高层目标，生成 >= 3 phase 计划
- phase 失败时可触发 fallback 或 revise
- 计划状态可查询、可恢复、可审计

### Phase 2：Self-Monitor v1

目标：

- 在没有完整 continual learning 的前提下，先完成自治监控与恢复触发

范围：

- `SelfMonitor` SPI
- `HealthReport`
- `DriftSignal`
- 基于滑动窗口和 baseline 的 drift detection
- recovery plan 生成
- human escalation

实现要求：

- 先基于现有 trace / reward / success_rate / error_rate / timeout rate 计算
- 不直接引入复杂统计学习模型

新增文件建议：

- `packages/autonomy-core/src/monitor/self-monitor.ts`
- `packages/autonomy-core/src/monitor/default-self-monitor.ts`
- `packages/autonomy-core/src/monitor/health-store.ts`
- `packages/autonomy-core/src/monitor/in-memory-health-store.ts`
- `packages/autonomy-core/src/monitor/sqlite-health-store.ts`

主链接线：

- `TraceRecorder` 产出 health sample
- `AgentRuntime` 在固定周期或 session idle 时触发 monitor
- 发现 drift 后生成 recovery goal 或 approval request

验收：

- 注入退化后，限定 cycle 内检测到 `drift.detected`
- 可生成 `recovery.triggered`
- 恢复失败时走 `human_approval`

### Phase 3：Intrinsic Motivation + Self-Goal Generation v1

目标：

- 让系统在没有显式用户输入时，能安全地产生候选目标

范围：

- `IntrinsicMotivationEngine`
- `SelfGoalGenerator`
- `GoalFilter`
- 自主目标注入、取消、否决

实现策略：

- curiosity 先由世界模型不确定性 / prediction error / 未探索实体导出
- competence 先由 task-bucket 成功率与 skill coverage 导出
- autonomy 先由可执行资源、可用工具、审批阻力导出
- `composite_drive` 用显式加权，不做黑盒模型

关键约束：

- 自我目标默认不是直接执行，而是先进候选池
- 必须经过：
  - value estimate
  - feasibility score
  - Amygdala 安全过滤
  - approval policy

新增文件建议：

- `packages/motivation-core/src/motivation/intrinsic-motivation-engine.ts`
- `packages/autonomy-core/src/goal-generation/self-goal-generator.ts`
- `packages/autonomy-core/src/goal-generation/goal-filter.ts`
- `packages/autonomy-core/src/goal-generation/goal-candidate-store.ts`

主链接线：

- `CycleEngine` 在“无外部输入 + 当前目标稀疏 + system idle”时查询 motivation
- `GoalManager` 接收 `owner=agent` 的 goal
- `PolicyProvider.evaluateSelfGoal()` 或扩展 Amygdala 接口

验收：

- 外部队列为空时能生成 >= 1 个候选探索目标
- 自主目标可被审计、可被用户否决
- 不会越过安全/审批约束直接进入高风险执行

### Phase 4：TransferAdapter + ContinualLearner v1

目标：

- 完成 M12 中“跨域迁移 + 持续学习”的工程化第一版

范围：

- `TransferAdapter`
- `ContinualLearner`
- consolidation scheduling
- forgetting monitor
- curriculum stage

实施边界：

- 优先复用 M10 已有 skill transfer / replay / reward store
- 不在这一阶段承诺真正神经网络级 EWC
- `EWC` 在 Phase 4 里先落成接口与统计近似版本，不做重量训练系统

建议实现：

- `measureSimilarity()`
- `transferSkill()`
- `validateTransfer()`
- `rollbackTransfer()`
- `consolidate()`
- `snapshot() / restore()`
- `measureForgetting()`

新增文件建议：

- `packages/motivation-core/src/transfer/transfer-adapter.ts`
- `packages/motivation-core/src/transfer/default-transfer-adapter.ts`
- `packages/motivation-core/src/continual/continual-learner.ts`
- `packages/motivation-core/src/continual/default-continual-learner.ts`
- `packages/motivation-core/src/continual/knowledge-store.ts`

主链接线：

- 复用 `BanditSkillPolicy`、`SkillTransferEngine`、`RewardStore`
- 在 runtime idle / maintenance window 触发 consolidation
- 在 `SelfMonitor` 中消费 forgetting 指标

验收：

- 相似域可迁移、可验证、可失败回退
- consolidation 可定时执行
- forgetting 指标进入 health report

### Phase 5：六模块自治增强

目标：

- 把 M12 真正嵌入六模块，而不是停在外围自治服务

必须增强的点：

- Cortex：`longHorizonPlan()`
- Hippocampal：`AutobiographicalMemory`
- Cerebellar：`predictPhase()`
- Amygdala：`evaluateSelfGoal()` / `evaluatePlan()`
- Basal Ganglia：`matchCrossDomain()`
- Prefrontal：`evaluatePlanLevelRisk()`

主链接线：

- 计划级预测进入 predictor
- 自主目标进入 policy gate
- 跨域 skill 匹配进入 skill retrieval
- 计划级风险评估进入 meta/control

验收：

- 六模块不再只是被 M12 消费，而是开始反向提供自治能力输入

### Phase 6：Safety / Alignment / Regression / Benchmark

目标：

- 完成 M12 的最后闭环：可治理、可审计、可压测、可阻断

范围：

- `AlignmentConstraints`
- corrigibility
- shutdown invariants
- autonomous audit trail
- M12 eval bundle
- failure injection suite

必须保证：

- `shutdown_responsive` 不可由 agent 自改
- 所有自主决策都进入 `CycleTrace`
- 所有自主目标都能追溯到 motivation source
- 高风险恢复动作可升级到人工审批

新增测试：

- autonomy protocol tests
- autonomy planner tests
- self-monitor fault injection tests
- self-goal safety tests
- transfer/continual regression tests
- full e2e: `plan.generated -> motivation.computed -> goal.self_generated -> drift.detected -> recovery.triggered`

---

## 6. 施工顺序与依赖

严格顺序：

1. Phase 0 协议冻结
2. Phase 1 Autonomous Planner
3. Phase 2 Self-Monitor
4. Phase 3 Motivation + SelfGoal
5. Phase 4 Transfer + Continual
6. Phase 5 六模块自治增强
7. Phase 6 Safety / Regression / Benchmark

禁止跳步：

- 不先做 `SelfGoalGenerator`，再补 planner
- 不先做 continual learning，再补 self-monitor
- 不先做黑盒学习，再补安全治理

---

## 7. 当前阶段的非目标

以下内容不进入 M12 第一轮施工主线：

- 去中心化自治集群
- 真正分布式 bus / gossip / DHT
- 大规模图数据库后端
- 全神经化 motivation / policy 网络
- 重量级参数训练基础设施

这些属于 M12 后的扩展，不属于当前 M12 的必要闭环。

---

## 8. 验收分层

### 8.1 Phase 验收

每个 Phase 必须有：

- 协议验收
- 单元测试
- 集成测试
- trace/audit 可观测性验收

### 8.2 M12 总验收

必须全部满足：

1. 复合目标可生成多阶段 `AutonomousPlan`
2. 计划失败可自动修订或切换 contingency
3. 无显式输入时可产生受治理的探索目标
4. 自主目标可安全注入、可审计、可否决
5. 跨域迁移可验证、可回退
6. 持续学习可巩固、可监控忘却
7. 性能漂移可检测、可恢复、可升级人工
8. 全事件流与 trace 完整
9. `tsc --noEmit`、focused tests、fault injection、M12 e2e 全过

---

## 9. 建议的 PR 切分

按 PR 切，不按 FR 切。

### PR-1

- protocol + events + snapshot/checkpoint autonomy state

### PR-2

- autonomy-core / plan + runtime plan registry + trace wiring

### PR-3

- autonomy-core / self-monitor + drift/recovery wiring

### PR-4

- motivation-core / intrinsic motivation + self-goal generation

### PR-5

- motivation-core / transfer + continual learner v1

### PR-6

- six-module autonomy hooks

### PR-7

- safety/alignment + benchmark + e2e + docs closeout

---

## 10. 与现有文档的关系

本文档不替代：

- [`../04_2026-03-31_next-stage/06_general-autonomy.md`](../04_2026-03-31_next-stage/06_general-autonomy.md)
- [`../04_2026-03-31_next-stage/milestones/m12-autonomy.md`](../04_2026-03-31_next-stage/milestones/m12-autonomy.md)

而是把它们从：

- 目标设计稿
- 功能清单

压缩成：

- 可直接施工的总实施单
- 可验收的分阶段计划
- 可回归的代码改造顺序

---

## 11. 结论

M12 现在的关键不是“再补更多设计”，而是：

- 把顶层蓝图收敛成顺序明确的工程计划
- 把研究性目标降级成当前阶段可交付版本
- 把自主能力完全纳入现有治理、追踪与恢复体系

按这份计划推进，M12 才能做到“全面实现”，而不是停留在概念堆叠。
