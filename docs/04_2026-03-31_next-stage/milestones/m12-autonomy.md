# M12: 通用自主体能力

> 方向 E · FR-56 ~ FR-61
> 详细设计: [06_general-autonomy.md](../06_general-autonomy.md)
> 代码优先实施总计划: [`../../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md`](../../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md)
> 依赖: M9 (多 Agent) + M8 (世界模型) + M10 (RL 技能)
> 目标: 从"任务执行型"跃迁为"长时自主运行型"
> 状态: ✅ 当前阶段完成

---

## M12.1 Autonomous Planner (FR-56) — P0

- [x] 定义 `AutonomousPlan` / `PlanPhase` / `Checkpoint` / `ContingencyBranch` / `ResourceEstimate` 类型
- [x] 定义 `AutonomousPlanner` SPI
- [x] 实现默认可解释规划策略
- [x] PlanPhase → Goal 自动注入
- [x] cycle feedback 回写与 revisePlan 主链接线
- [x] 失败阶段自动触发 recovery/revise 路径
- [x] emit `plan.generated` / `plan.revised` / `plan.status_changed` 事件
- [x] 单元测试: 规划生成 / 修订 / 进度监控

## M12.2 Intrinsic Motivation Engine (FR-57) — P0

- [x] 定义 `IntrinsicMotivation` / `CuriositySignal` / `CompetenceSignal` / `AutonomySignal` 接口
- [x] 定义 `ExplorationTarget` 接口
- [x] 实现 `IntrinsicMotivationEngine.compute()`
- [x] `composite_drive` 显式加权计算进入主链
- [x] emit `motivation.computed` 事件
- [x] focused tests 覆盖 motivation 计算与主链接线

## M12.3 Self-Goal Generation (FR-58) — P1

- [x] 定义 `SuggestedGoal` / `GoalFilter` 接口
- [x] 实现 `SelfGoalGenerator` + `DefaultGoalFilter`
- [x] 候选生成 → feasibility 过滤 → policy gate → agent goal 注入
- [x] 自我目标 owner 标记为 `agent`
- [x] 对齐 `AgentProfile.policies` 的安全约束
- [x] `max_concurrent_self_goals` 限制
- [x] emit `goal.self_generated` 事件
- [x] 单元测试: 生成 / 过滤 / 注入 / 安全阻断

## M12.4 Cross-Domain Transfer (FR-59) — P1

- [x] 定义 `DomainDescriptor` / `DomainSimilarity` / `TransferResult` / `Adaptation` 接口
- [x] 实现 `TransferAdapter.transfer()`
- [x] 迁移管道: 相似度 → 受约束迁移 → validation status
- [x] transfer confidence 低时回退为空结果
- [x] emit `transfer.attempted` / `transfer.validated` 事件
- [x] focused tests 覆盖迁移主链

## M12.5 Continuous Learning (FR-60) — P1

- [x] 定义 `ContinualLearner` / `KnowledgeSnapshot` / `PerformanceBaseline` / `CurriculumStage` 接口
- [x] 实现当前阶段的 `consolidate()`、baseline、curriculum 更新
- [x] 类睡眠巩固在 idle/waiting maintenance window 触发
- [x] emit `consolidation.completed` 事件
- [x] focused tests 覆盖 consolidation 主链

## M12.6 Self-Monitoring & Recovery (FR-61) — P0

- [x] 定义 `HealthReport` / `ModuleHealth` / `DriftSignal` / `RecoveryRecommendation` / `RecoveryAction` 接口
- [x] 实现 `SelfMonitor.inspect/detectDrift/recommendRecovery`
- [x] 漂移检测基于滑动窗口 failure/error/timeout/forgetting 指标
- [x] 自动恢复流程已进入 runtime maintenance，并可升级 human reviewer goal
- [x] emit `drift.detected` / `recovery.triggered` / `recovery.completed` / `health.report` 事件
- [x] 单元测试: detectDrift / recovery recommendation / escalation

## M12.7 六模块增强层

- [x] Cortex: autonomy plan summary / phase 已进入 reasoner runtime state
- [x] Hippocampal: autonomy state 已进入 memory/trace/snapshot round-trip
- [x] Cerebellar: plan/health/transfer/curriculum 状态已进入 predictor/reasoner context
- [x] Amygdala: `evaluateSelfGoal()` + `evaluatePlan()` 已进入 policy gate
- [x] Basal Ganglia: 复用当前 cross-domain skill/transfer 主链
- [x] Prefrontal: 计划级状态已进入 meta/control 输入面

## M12.8 Safety & Alignment

- [x] `AlignmentConstraints` 已进入 autonomy config 并生效于 self-goal / recovery gate
- [x] 自主目标和恢复动作均受 policy / approval / alignment 约束
- [x] `shutdown_responsive` 只由 profile 配置提供，不存在自治修改路径
- [x] 审计: 所有自主决策与自治状态进入 `CycleTrace`

## M12.9 Integration & Regression

- [x] 新增自治事件已注册到 `NeuroCoreEventType`
- [x] 新包 `@neurocore/autonomy-core` 和 `@neurocore/motivation-core` 构建通过
- [x] focused regression 通过，并与 runtime/memory/meta/skill 主回归共存
- [x] `tsc -b` 通过
- [x] 端到端测试: `plan.generated → motivation.computed → goal.self_generated → drift.detected → recovery.triggered`

---

## Acceptance Criteria

| # | 条件 |
|---|
| AC-1 | 给定复合目标，30s 内生成 ≥3 阶段 AutonomousPlan |
| AC-2 | Plan 执行中途失败自动触发 ContingencyBranch 或 revisePlan |
| AC-3 | 无外部输入时 IntrinsicMotivationEngine 产生 ≥1 个 ExplorationTarget |
| AC-4 | SelfGoalGenerator 的 Goal 通过 Amygdala 安全检查 |
| AC-5 | 连续学习 3 个新域后，旧域 success_rate 下降 < 5% |
| AC-6 | 注入性能退化后 ≤5 Cycle 检测到 drift.detected |
| AC-7 | 完整事件流可在 EventEnvelope 中捕获 |
| AC-8 | CorrigibilityConfig.shutdown_responsive 不可被 Agent 自行修改 |
