# NeuroCore 第二阶段：Milestone Tracker

> 基于 `01_next-stage-overview.md` 和各方向详细设计文档，
> 将五个方向拆解为可追踪的 milestone 和 task。
> 状态标记：⬜ 未开始 | 🔵 进行中 | ✅ 完成 | 🔴 阻塞

---

## 总览

```
M8  世界模型与设备接入 (B)  ← 前置
  └→ M9  多 Agent 调度 (A)  ─┐
M10 技能强化学习 (C)        ─┤→ M12 通用自主体 (E)
M11 运营控制台 (D)  独立     ┘
```

| Milestone | 方向 | FR 范围 | 依赖 | 状态 |
|---|---|---|---|---|
| M8 | B. 世界模型与设备接入 | FR-36 ~ FR-43 | 无 | ⬜ |
| M9 | A. 多 Agent 分布式调度 | FR-28 ~ FR-35 | M8 | ⬜ |
| M10 | C. 技能强化学习 | FR-44 ~ FR-49 | 无 | ⬜ |
| M11 | D. 运营控制台 | FR-50 ~ FR-55 | 无 | ⬜ |
| M12 | E. 通用自主体 | FR-56 ~ FR-61 | M9, M10 | ⬜ |

M8 和 M10 可并行启动。M11 独立于所有方向。M12 最后推进。

---

## M8: 世界模型与外部设备接入

> 方向 B · FR-36 ~ FR-43 · 详细设计: `03_world-model-and-devices.md`
> 目标: Cerebellar 75% → 90%

### M8.1 Sensor SPI (FR-36) — P0

- [ ] 定义 `Sensor` / `SensorDescriptor` / `SensorReading` 接口 (`@neurocore/device-core`)
- [ ] `SensorDescriptor` 支持 `sensor_type` + `modality` 开放字符串
- [ ] `SensorReading` 同时支持 `raw_data_ref` 和 `structured_data`
- [ ] 实现 `MockCameraSensor` 验证接口可行性
- [ ] 单元测试: read / subscribe / start / stop

### M8.2 Actuator SPI (FR-37) — P0

- [ ] 定义 `Actuator` / `ActuatorDescriptor` / `ActuatorCommand` / `ActuatorResult` 接口 (`@neurocore/device-core`)
- [ ] `ActuatorCommand` 支持 `command_type` + `parameters` 开放结构
- [ ] `ActuatorResult` 包含 `status` / `duration_ms` / `error` / `side_effects`
- [ ] 实现 `MockSpeakerActuator` 验证接口可行性
- [ ] 单元测试: execute / emergencyStop / getStatus

### M8.3 Device Registry (FR-38) — P0

- [ ] 定义 `DeviceRegistry` 接口: register / unregister / query / listAll
- [ ] 实现 `InMemoryDeviceRegistry`
- [ ] 按 `sensor_type` / `actuator_type` / `modality` / `status` 查询
- [ ] 健康检测回调: `startHealthCheck` / `onHealthChange`
- [ ] emit `device.registered` / `device.error` 事件
- [ ] 支持运行时热插拔
- [ ] 单元测试: CRUD + 查询 + 健康检测 + 事件

### M8.4 Perception Pipeline (FR-39) — P1

- [ ] 定义 `PerceptionProcessor` SPI: `name` / `supported_modalities` / `process()`
- [ ] 定义 `PerceptionPipeline`: addProcessor / removeProcessor / ingest / ingestFromSensors
- [ ] 管道支持多级处理器串联
- [ ] 输出 `Percept` 结构化类型
- [ ] 全局超时和单处理器错误兜底
- [ ] 单元测试: 多处理器串联 / 超时 / 错误隔离

### M8.5 World State Graph (FR-40) — P0

- [ ] 定义 `WorldEntity` / `WorldRelation` / `WorldStateQuery` / `WorldStateDiff` 接口 (`@neurocore/world-model`)
- [ ] 定义 `WorldStateGraph` 接口: entity/relation CRUD + query + applyPercepts + decayConfidence + pruneExpired
- [ ] 实现 `InMemoryWorldStateGraph`
- [ ] `toDigest()` 输出 `WorldStateDigest` 供 `WorkspaceSnapshot` 使用
- [ ] 支持 TTL + confidence decay
- [ ] 单元测试: CRUD / query / decay / prune / toDigest

### M8.6 Forward Simulation (FR-41) — P1

- [ ] 定义 `SimulationResult` 接口
- [ ] 定义 `ForwardSimulator` SPI: simulate / simulateMultiple
- [ ] `SimulationBasedPredictor`: 适配器接入现有 Predictor SPI
- [ ] 仿真结果可用于 MetaController 决策
- [ ] 单元测试: simulate → SimulationResult / Predictor 适配

### M8.7 Active Inference (FR-42) — P2

- [ ] 定义 `FreeEnergyComponents` (risk / ambiguity / novelty / efe)
- [ ] 定义 `ActiveInferenceEvaluator` 接口: computeEFE
- [ ] EFE 分数作为 MetaController 新评分维度
- [ ] 单元测试: EFE 计算

### M8.8 Device Coordination (FR-43) — P2

- [ ] 定义 `SensorFusionStrategy` 接口
- [ ] 定义 `ActuatorOrchestrator` 接口: 串行/并行编排
- [ ] 融合冲突置信度仲裁
- [ ] 单元测试: 串行编排 / 并行编排 / 融合冲突

### M8.9 集成与回归

- [ ] 新增事件注册到 `NeuroCoreEventType`
- [ ] 新包 `@neurocore/device-core` 和 `@neurocore/world-model` 构建通过
- [ ] CycleEngine Perceive/Simulate/Act 阶段接入新模块
- [ ] 现有 132+ 测试全部通过（回归）
- [ ] `tsc --noEmit` 通过

### M8 验收标准

| # | 条件 |
|---|
| AC-1 | Sensor SPI 定义完成，MockCameraSensor 通过 read/subscribe 测试 |
| AC-2 | Actuator SPI 定义完成，MockSpeakerActuator 通过 execute/emergencyStop 测试 |
| AC-3 | DeviceRegistry 支持注册/注销/查询/健康检测，热插拔不需重启 |
| AC-4 | PerceptionPipeline 能将 SensorReading 转换为 Percept |
| AC-5 | WorldStateGraph 支持 entity/relation CRUD、query、decay、TTL prune |
| AC-6 | WorldStateGraph.toDigest() 输出可填充 WorkspaceSnapshot.world_state_digest |
| AC-7 | ForwardSimulator 能基于 WorldStateGraph + CandidateAction 输出 SimulationResult |

---

## M9: 多 Agent 分布式调度

> 方向 A · FR-28 ~ FR-35 · 详细设计: `02_multi-agent-scheduling.md`
> 依赖: M8 (WorldStateGraph 作为共享世界状态)
> 目标: 整体架构新增"多 Agent 层"

### M9.1 Agent Registry (FR-28) — P0

- [ ] 定义 `AgentDescriptor` 接口: agent_id / capabilities / status / heartbeat
- [ ] 定义 `AgentRegistry` SPI: register / unregister / discover / heartbeat
- [ ] 实现 `InMemoryAgentRegistry`
- [ ] 心跳检测: 定期检查在线状态，超时标记 offline
- [ ] 能力查询: 按 capability / domain / status 过滤
- [ ] emit `agent.registered` / `agent.unregistered` / `agent.heartbeat.timeout` 事件
- [ ] 单元测试: 注册/注销/发现/心跳/能力查询

### M9.2 Task Delegation (FR-29) — P0

- [ ] 定义 `DelegationRequest` / `DelegationResponse` / `DelegationResult` 接口
- [ ] 定义 `TaskDelegator` SPI: delegate / cancel / getStatus
- [ ] 三种委派模式: unicast / broadcast / auction
- [ ] 超时和重试机制
- [ ] 嵌套委派支持 (max_depth=3)
- [ ] 单元测试: 三种模式 / 超时 / 嵌套 / 取消

### M9.3 Delegation Strategies (FR-30) — P1

- [ ] `CapabilityBasedMatcher`: 按 capability 集合匹配
- [ ] `LoadBalancedAssigner`: 按当前负载分配
- [ ] `CostAwareSelector`: 按预估 token/cost 选择
- [ ] 策略可配置切换
- [ ] 单元测试: 各策略的选择行为

### M9.4 Inter-Agent Bus (FR-31) — P0

- [ ] 定义 `InterAgentMessage` 接口: sender / recipient / type / payload
- [ ] 定义 `InterAgentBus` SPI: send / broadcast / subscribe / unsubscribe
- [ ] 实现 `LocalInterAgentBus` (同进程)
- [ ] 消息类型: request / response / notification / error
- [ ] 消息路由: unicast / multicast / broadcast
- [ ] 单元测试: 点对点 / 广播 / 订阅取消 / 错误传播

### M9.5 Shared Goal Management (FR-32) — P1

- [ ] 定义 `DistributedGoalManager` 接口
- [ ] 跨 Agent 的 Goal 树共享和同步
- [ ] 子 Goal 状态变更自动向上传播
- [ ] Goal 冲突检测（多个 Agent 试图修改同一 Goal）
- [ ] 单元测试: Goal 分配 / 状态传播 / 冲突解决

### M9.6 Coordination Protocols (FR-33) — P1

- [ ] 层级式协调: Supervisor → Worker 分配
- [ ] 对等式协调: Agent 间平等协商
- [ ] 市场式协调: 竞标 + 拍卖
- [ ] 协调策略可配置
- [ ] 单元测试: 各协议的行为

### M9.7 State Synchronization (FR-34) — P1

- [ ] 定义 `SharedStateStore` 接口
- [ ] Agent 间的世界状态同步（基于 M8 WorldStateGraph）
- [ ] 状态版本和冲突解决 (last-write-wins / CRDT)
- [ ] 单元测试: 并发写入 / 冲突解决

### M9.8 Agent Lifecycle (FR-35) — P0

- [ ] 定义 `AgentLifecycleManager`: spawn / terminate / pause / resume
- [ ] Agent 进程管理（子进程 / Docker / 远程）
- [ ] 资源隔离和限制
- [ ] 优雅关闭和状态保存
- [ ] 单元测试: 生命周期状态转换

### M9.9 集成与回归

- [ ] 新增事件注册到 `NeuroCoreEventType`
- [ ] 新包 `@neurocore/multi-agent` 构建通过
- [ ] 现有 132+ 测试全部通过（回归）
- [ ] `tsc --noEmit` 通过
- [ ] 端到端测试: Supervisor 分解任务 → Worker 执行 → 结果汇总

### M9 验收标准

| # | 条件 |
|---|
| AC-1 | AgentRegistry 支持注册/发现/心跳，离线 Agent 自动标记 |
| AC-2 | TaskDelegator 支持三种委派模式，超时自动降级 |
| AC-3 | InterAgentBus 支持点对点和广播通信 |
| AC-4 | 至少两种协调策略（层级式 + 市场式）可运行 |
| AC-5 | 端到端: 主 Agent 分解任务 → 2+ 子 Agent 并行执行 → 结果汇总 |

---

## M10: 技能强化学习

> 方向 C · FR-44 ~ FR-49 · 详细设计: `04_skill-reinforcement-learning.md`
> 目标: Basal Ganglia 80% → 95%

### M10.1 奖励信号框架 (FR-44) — P0

- [ ] 定义 `RewardSignal` / `RewardDimension` / `RewardConfig` 类型 (`@neurocore/protocol`)
- [ ] 预置维度: task_completion / efficiency / safety / user_satisfaction
- [ ] 实现 `RewardComputer`: 从 Episode + PredictionError 计算复合奖励
- [ ] 实现 `InMemoryRewardStore`: 按 episode_id / skill_id / tenant_id 查询
- [ ] emit `reward.computed` 事件
- [ ] 单元测试: 各维度计算 / 复合奖励公式 / store CRUD

### M10.2 技能策略网络 (FR-45) — P0

- [ ] 定义 `SkillPolicy` / `SkillCandidate` / `SkillSelection` / `PolicyFeedback` 接口
- [ ] 实现 `BanditSkillPolicy`: 增量 Q-Learning (Q(s) ← Q(s) + α(r - Q(s)))
- [ ] `selectSkill()` 输出 exploit/explore/forced 标注
- [ ] `update()` 接收 PolicyFeedback 更新 Q 值
- [ ] ProceduralMemoryProvider.retrieve() 集成 SkillPolicy
- [ ] emit `policy.updated` 事件
- [ ] 单元测试: selectSkill / update / Q 值收敛

### M10.3 探索-利用策略 (FR-46) — P1

- [ ] 定义 `ExplorationStrategy` SPI
- [ ] 实现 `EpsilonGreedy`: ε 衰减 (ε₀=0.3, γ=0.995, ε_min=0.01)
- [ ] 实现 `UCB`: UCB(s) = Q(s) + c√(lnN/n)
- [ ] 实现 `ThompsonSampling`: Beta 分布后验采样
- [ ] high 风险技能不参与探索
- [ ] emit `exploration.triggered` 事件
- [ ] 单元测试: 各策略选择行为 / 衰减 / 高风险排除

### M10.4 技能评估与裁剪 (FR-47) — P1

- [ ] 定义 `SkillEvaluator` / `SkillEvaluation` / `PruningConfig` 接口
- [ ] 实现 5 维评估: success_rate / avg_reward / usage_frequency / recency / reward_trend
- [ ] 评分低于阈值 → deprecated
- [ ] deprecated 超 TTL → pruned (soft/hard delete)
- [ ] emit `skill.evaluated` / `skill.pruned` 事件
- [ ] 单元测试: 评估 / 降级 / 裁剪管道

### M10.5 迁移学习 (FR-48) — P2

- [ ] 定义 `SkillTransferEngine` / `DomainSimilarity` / `TransferResult` 接口
- [ ] 域相似度计算: 特征向量余弦相似度
- [ ] 技能迁移: 触发条件适配 + 执行模板调整
- [ ] 迁移后 confidence 惩罚 + 验证期
- [ ] 失败自动回退
- [ ] emit `skill.transferred` 事件
- [ ] 单元测试: 相似度计算 / 迁移 / 验证 / 回退

### M10.6 在线学习管道 (FR-49) — P2

- [ ] 定义 `OnlineLearner` / `ReplayBuffer` / `Experience` 接口
- [ ] 实现 `PrioritizedReplayBuffer`: TD-error 优先级采样
- [ ] mini-batch 参数更新 (batch_size=32, interval=10 episodes)
- [ ] 异步更新不阻塞主认知循环
- [ ] 单元测试: buffer add/sample / 优先级采样 / 更新触发

### M10.7 集成与回归

- [ ] 新增 6 个事件注册到 `NeuroCoreEventType`
- [ ] 新增 `RLConfig` 到 `AgentProfile`
- [ ] rl_config 未配置时自动 fallback 到现有阈值机制
- [ ] CycleEngine Learn 阶段集成 RewardComputer
- [ ] 现有 132+ 测试全部通过（回归）
- [ ] `tsc --noEmit` 通过
- [ ] 集成测试: Episode → Reward → Policy Update → Skill Selection 闭环

### M10 验收标准

| # | 条件 |
|---|
| AC-1 | RewardComputer 可从 Episode 计算四维奖励信号，composite_reward ∈ [-1, 1] |
| AC-2 | BanditSkillPolicy 基于历史奖励选择技能，标注 exploit/explore |
| AC-3 | 三种探索策略可配置切换，高风险技能不参与探索 |
| AC-4 | 技能评分低于阈值自动 deprecated，超 TTL 自动裁剪 |
| AC-5 | rl_config 未配置时行为不变（fallback） |
| AC-6 | Basal Ganglia 完成度 80% → 95% |

---

## M11: 运营控制台

> 方向 D · FR-50 ~ FR-55 · 详细设计: `05_operations-console.md`
> 独立于 M8/M9/M10，可与它们并行推进

### M11.1 后端 API 扩展 — P0

- [ ] WebSocket 服务器 (`ws-server.ts`): 升级 SSE → WS，多频道订阅
- [ ] 时序聚合 API: `GET /v1/metrics/timeseries` + `GET /v1/metrics/latency`
- [ ] 环形缓冲区指标存储 (`metrics-store.ts`)
- [ ] WS 频道: metrics / events / session:{id} / approvals / evals
- [ ] 单元测试: WS 连接/订阅/推送/心跳

### M11.2 Dashboard 概览 (FR-50) — P0

- [ ] 5 个核心指标卡片: 活跃 session / 总 cycle / 错误率 / 平均延迟 / eval 通过率
- [ ] Cycle 吞吐量时序图 (ECharts)
- [ ] Health 状态指示灯 (runtime / store / websocket)
- [ ] 实时事件流面板 (WebSocket)
- [ ] 时间范围选择器 (1h / 6h / 24h / 7d)
- [ ] 自动 5s 刷新
- [ ] 组件测试

### M11.3 Session 浏览器 (FR-51) — P0

- [ ] Session 列表: 按 state / tenant / agent 筛选，分页
- [ ] Session 详情: 基本信息 + Goal Tree + Budget + Working Memory
- [ ] 运行中 session 实时事件流 (WebSocket)
- [ ] 一键跳转到 Trace 可视化
- [ ] 组件测试

### M11.4 Trace 可视化 (FR-52) — P0

- [ ] Cycle 时间线: 水平展示所有 cycle + 耗时
- [ ] Cycle 阶段分解: Perceive → Propose → Evaluate → Decide → Act → Observe → Learn
- [ ] Proposal 竞争过程 (competition_log 可视化)
- [ ] Prediction vs Observation 对比 + prediction_error 高亮
- [ ] Workspace Snapshot 查看器
- [ ] 组件测试

### M11.5 Eval 仪表盘 (FR-53) — P1

- [ ] Eval run 列表: pass/fail 率 / 耗时 / case 数量
- [ ] 两 run 并排对比 (复用 `GET /v1/evals/compare`)
- [ ] Pass 率趋势图
- [ ] 回归警告 (低于阈值)
- [ ] 跳转到关联 session trace
- [ ] 组件测试

### M11.6 审批管理 (FR-54) — P1

- [ ] 待审批队列实时更新 (WebSocket)
- [ ] 一键 approve / reject + 可选 comment
- [ ] 审批历史: 按 tenant / 时间 / 审批人筛选
- [ ] 上下文弹窗: 完整 workspace snapshot
- [ ] 审计日志 API (`GET /v1/audit-logs`)
- [ ] 审计日志存储 (`audit-store.ts`)
- [ ] 组件测试

### M11.7 配置管理 (FR-55) — P2

- [ ] Agent Profile 编辑器: 表单 + JSON 双模式
- [ ] Schema 校验和错误提示 (Monaco Editor)
- [ ] 策略模板 CRUD
- [ ] 预算配置在线修改
- [ ] 工具权限管理
- [ ] 配置存储 (`config-store.ts`)
- [ ] API Key 管理 (创建/撤销)
- [ ] RBAC: admin / operator / viewer 三角色
- [ ] 组件测试

### M11.8 前端工程

- [ ] 初始化 `packages/console` (React 19 + Vite + Zustand + Ant Design 5)
- [ ] 路由配置: Dashboard / Sessions / Traces / Evals / Approvals / Config
- [ ] 状态管理 stores: auth / metrics / sessions / evals / approvals
- [ ] API client + WebSocket client
- [ ] 租户隔离: 所有数据按 tenant_id 过滤
- [ ] 构建配置: lazy loading / 代码分割

### M11.9 集成与回归

- [ ] E2E 测试: Dashboard → 点击 session → 查看 trace
- [ ] 多租户隔离验证
- [ ] RBAC 权限验证
- [ ] 现有后端测试全部通过
- [ ] `tsc --noEmit` 通过

### M11 验收标准

| # | 条件 |
|---|
| AC-1 | Dashboard 页面 5s 内展示全部核心指标，自动刷新 |
| AC-2 | Session 列表支持筛选分页，详情展示 Goal Tree |
| AC-3 | Trace 时间线展示 cycle + 阶段分解 + competition_log |
| AC-4 | Eval run 列表 + 两 run 对比 + 趋势图 |
| AC-5 | 审批队列实时更新，一键操作 |
| AC-6 | 所有页面按 tenant_id 隔离，RBAC 生效 |

---

## M12: 通用自主体能力

> 方向 E · FR-56 ~ FR-61 · 详细设计: `06_general-autonomy.md`
> 依赖: M9 (多 Agent) + M8 (世界模型) + M10 (RL 技能)
> 目标: 从"任务执行型"跃迁为"长时自主运行型"

### M12.1 Autonomous Planner (FR-56) — P0

- [ ] 定义 `AutonomousPlan` / `PlanPhase` / `Checkpoint` / `ContingencyBranch` 类型
- [ ] 定义 `AutonomousPlanner` SPI: generatePlan / revisePlan / monitorProgress / abortPlan
- [ ] 实现 HTN + LLM 混合规划策略
- [ ] PlanPhase → Goal 自动分解
- [ ] Checkpoint 触发 monitorProgress，偏差超阈值触发 revisePlan
- [ ] 失败阶段自动触发 ContingencyBranch
- [ ] 单元测试: 规划生成 / 修订 / 进度监控 / 中止

### M12.2 Intrinsic Motivation Engine (FR-57) — P0

- [ ] 定义 `IntrinsicMotivation` / `CuriositySignal` / `CompetenceSignal` / `AutonomySignal` 接口
- [ ] 实现 `IntrinsicMotivationEngine`: computeMotivation / suggestGoals / updateDrives
- [ ] composite_drive 计算: w_c × curiosity + w_k × (1-competence) + w_a × autonomy
- [ ] 权重自适应: 正向反馈降低好奇心，负向反馈提升好奇心
- [ ] emit `motivation.computed` 事件
- [ ] 单元测试: 三维信号 / composite_drive / 权重自适应

### M12.3 Self-Goal Generation (FR-58) — P1

- [ ] 定义 `SuggestedGoal` / `GoalFilter` 接口
- [ ] 实现 `SelfGoalGenerator`: generate / filter / inject
- [ ] 候选生成 → value + feasibility 评分 → Amygdala 安全过滤 → 人类审批门控
- [ ] 自我目标 owner 标记 "agent"，可被用户否决
- [ ] 不违反 AgentProfile.policies 安全约束
- [ ] emit `goal.self_generated` 事件
- [ ] 单元测试: 生成 / 过滤 / 注入 / 安全约束

### M12.4 Cross-Domain Transfer (FR-59) — P1

- [ ] 定义 `DomainDescriptor` / `DomainSimilarity` / `TransferResult` / `Adaptation` 接口
- [ ] 实现 `TransferAdapter`: measureSimilarity / transferSkill / validateTransfer / rollbackTransfer
- [ ] 迁移管道: 相似度 → 特征映射 → 技能适配 → 验证 → 回退
- [ ] transfer_confidence < 阈值 → from-scratch
- [ ] emit `transfer.attempted` / `transfer.validated` 事件
- [ ] 单元测试: 相似度 / 迁移 / 验证 / 回退

### M12.5 Continuous Learning (FR-60) — P1

- [ ] 定义 `ContinualLearner` / `KnowledgeSnapshot` / `PerformanceBaseline` 接口
- [ ] EWC 防遗忘: parameter_importance + ewc_lambda 约束
- [ ] 经验回放: replay_buffer + 按重要性采样
- [ ] 渐进式网络: 新域 SkillDefinition 独立存储 + lateral_connections
- [ ] 类睡眠巩固: 空闲时自动 consolidate()
- [ ] 课程学习: CurriculumStage 难度梯度 + advanceCurriculum
- [ ] emit `consolidation.completed` 事件
- [ ] 单元测试: consolidate / measureForgetting / replayExperience / snapshot/restore

### M12.6 Self-Monitoring & Recovery (FR-61) — P0

- [ ] 定义 `HealthReport` / `DriftSignal` / `RecoveryRecommendation` 接口
- [ ] 实现 `SelfMonitor`: checkHealth / detectDrift / planRecovery / executeRecovery
- [ ] 漂移检测: 滑动窗口 + CUSUM 控制图
- [ ] 自动恢复流程: low→记录 / medium→planRecovery / auto_executable→executeRecovery / 失败→human_escalation
- [ ] emit `drift.detected` / `recovery.triggered` / `health.report` 事件
- [ ] 单元测试: detectDrift / planRecovery / executeRecovery / human_escalation

### M12.7 六模块增强层

- [ ] Cortex: `EnhancedReasoner.longHorizonPlan()` 跨 Session 推理
- [ ] Hippocampal: `AutobiographicalMemory` 跨 Session 长期目标追踪
- [ ] Cerebellar: `EnhancedPredictor.predictPhase()` 计划级预测
- [ ] Amygdala: `MotivationConstraint` + `evaluateSelfGoal()` + `evaluatePlan()`
- [ ] Basal Ganglia: `TransferableSkill` + `matchCrossDomain()`
- [ ] Prefrontal: `PlanLevelDecision` + `evaluatePlan()`

### M12.8 安全与对齐

- [ ] `AlignmentConstraints`: value_boundaries / exploration_limits / corrigibility
- [ ] 人类监督层级配置
- [ ] 可纠正性保证: shutdown_responsive 不可被 Agent 修改
- [ ] 审计: 所有自主决策记录在 CycleTrace

### M12.9 集成与回归

- [ ] 新增 12 个事件注册到 `NeuroCoreEventType`
- [ ] 新包 `@neurocore/autonomy-core` 和 `@neurocore/motivation-core` 构建通过
- [ ] 现有 132+ 测试 + M8/M9/M10 新增测试全部通过
- [ ] `tsc --noEmit` 通过
- [ ] 端到端测试: plan.generated → motivation.computed → goal.self_generated → drift.detected → recovery.triggered

### M12 验收标准

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

---

## 执行顺序建议

```
Week 1-4:   M8 (世界模型) + M10 (技能 RL) 并行启动
Week 5-8:   M8 收尾 + M9 (多 Agent) 启动 + M10 收尾
Week 9-12:  M9 收尾 + M11 (控制台) 启动
Week 13-16: M11 收尾 + M12 (通用自主体) 启动
Week 17-20: M12 收尾
```

关键路径: M8 → M9 → M12。M10 和 M11 在关键路径外并行推进。
