# M12: 通用自主体能力

> 方向 E · FR-56 ~ FR-61
> 详细设计: [06_general-autonomy.md](../06_general-autonomy.md)
> 依赖: M9 (多 Agent) + M8 (世界模型) + M10 (RL 技能)
> 目标: 从"任务执行型"跃迁为"长时自主运行型"
> 状态: ⬜

---

## M12.1 Autonomous Planner (FR-56) — P0

- [ ] 定义 `AutonomousPlan` / `PlanPhase` / `Checkpoint` / `ContingencyBranch` / `ResourceEstimate` 类型
- [ ] 定义 `AutonomousPlanner` SPI: generatePlan / revisePlan / monitorProgress / abortPlan
- [ ] 实现 HTN + LLM 混合规划策略
- [ ] PlanPhase → Goal 自动分解
- [ ] Checkpoint 触发 monitorProgress，偏差超阈值触发 revisePlan
- [ ] 失败阶段自动触发 ContingencyBranch
- [ ] emit `plan.generated` / `plan.revised` / `plan.status_changed` 事件
- [ ] 单元测试: 规划生成 / 修订 / 进度监控 / 中止

## M12.2 Intrinsic Motivation Engine (FR-57) — P0

- [ ] 定义 `IntrinsicMotivation` / `CuriositySignal` / `CompetenceSignal` / `AutonomySignal` 接口
- [ ] 定义 `ExplorationTarget` / `CompetenceGap` 接口
- [ ] 实现 `IntrinsicMotivationEngine`: computeMotivation / suggestGoals / updateDrives
- [ ] composite_drive 计算: w_c × curiosity + w_k × (1-competence) + w_a × autonomy
- [ ] 权重自适应: 正向反馈降低好奇心，负向反馈提升好奇心
- [ ] emit `motivation.computed` 事件
- [ ] 单元测试: 三维信号 / composite_drive / 权重自适应

## M12.3 Self-Goal Generation (FR-58) — P1

- [ ] 定义 `SuggestedGoal` / `GoalFilter` 接口
- [ ] 实现 `SelfGoalGenerator`: generate / filter / inject
- [ ] 候选生成 → value + feasibility 评分 → Amygdala 安全过滤 → 人类审批门控
- [ ] 自我目标 owner 标记 "agent"，可被用户否决
- [ ] 不违反 AgentProfile.policies 安全约束
- [ ] max_concurrent_self_goals 限制
- [ ] emit `goal.self_generated` 事件
- [ ] 单元测试: 生成 / 过滤 / 注入 / 安全约束

## M12.4 Cross-Domain Transfer (FR-59) — P1

- [ ] 定义 `DomainDescriptor` / `DomainSimilarity` / `TransferResult` / `Adaptation` 接口
- [ ] 实现 `TransferAdapter`: measureSimilarity / transferSkill / validateTransfer / rollbackTransfer
- [ ] 迁移管道: 相似度 → 特征映射 → 技能适配 → 验证 → 回退
- [ ] transfer_confidence < 阈值 → from-scratch
- [ ] 成功迁移 skill success_rate ≥ 源域 70%
- [ ] emit `transfer.attempted` / `transfer.validated` 事件
- [ ] 单元测试: 相似度 / 迁移 / 验证 / 回退

## M12.5 Continuous Learning (FR-60) — P1

- [ ] 定义 `ContinualLearner` / `KnowledgeSnapshot` / `PerformanceBaseline` / `CurriculumStage` 接口
- [ ] EWC 防遗忘: parameter_importance + ewc_lambda 约束
- [ ] 经验回放: replay_buffer + 按重要性采样
- [ ] 渐进式网络: 新域 SkillDefinition 独立存储 + lateral_connections
- [ ] 类睡眠巩固: 空闲时自动 consolidate()
- [ ] 课程学习: CurriculumStage 难度梯度 + advanceCurriculum
- [ ] emit `consolidation.completed` 事件
- [ ] 单元测试: consolidate / measureForgetting / replayExperience / snapshot/restore

## M12.6 Self-Monitoring & Recovery (FR-61) — P0

- [ ] 定义 `HealthReport` / `ModuleHealth` / `DriftSignal` / `RecoveryRecommendation` / `RecoveryAction` 接口
- [ ] 实现 `SelfMonitor`: checkHealth / detectDrift / planRecovery / executeRecovery / getHealthHistory
- [ ] 漂移检测: 滑动窗口 + CUSUM 控制图
- [ ] 自动恢复流程: low→记录 / medium→planRecovery / auto_executable→executeRecovery / 失败→human_escalation
- [ ] emit `drift.detected` / `recovery.triggered` / `recovery.completed` / `health.report` 事件
- [ ] 单元测试: detectDrift / planRecovery / executeRecovery / human_escalation

## M12.7 六模块增强层

- [ ] Cortex: `EnhancedReasoner.longHorizonPlan()` 跨 Session 推理
- [ ] Hippocampal: `AutobiographicalMemory` 跨 Session 长期目标追踪
- [ ] Cerebellar: `EnhancedPredictor.predictPhase()` 计划级预测
- [ ] Amygdala: `MotivationConstraint` + `evaluateSelfGoal()` + `evaluatePlan()`
- [ ] Basal Ganglia: `TransferableSkill` + `matchCrossDomain()`
- [ ] Prefrontal: `PlanLevelDecision` + `evaluatePlan()`

## M12.8 Safety & Alignment

- [ ] `AlignmentConstraints`: value_boundaries / exploration_limits / corrigibility
- [ ] 人类监督层级配置 (auto_approve / human_review / human_approval / hard_block)
- [ ] 可纠正性保证: shutdown_responsive 不可被 Agent 修改
- [ ] 审计: 所有自主决策记录在 CycleTrace

## M12.9 Integration & Regression

- [ ] 新增 12 个事件注册到 `NeuroCoreEventType`
- [ ] 新包 `@neurocore/autonomy-core` 和 `@neurocore/motivation-core` 构建通过
- [ ] 现有 132+ 测试 + M8/M9/M10 新增测试全部通过
- [ ] `tsc --noEmit` 通过
- [ ] 端到端测试: plan.generated → motivation.computed → goal.self_generated → drift.detected → recovery.triggered

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
