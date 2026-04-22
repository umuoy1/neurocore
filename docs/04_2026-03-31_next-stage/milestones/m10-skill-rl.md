# M10: 技能强化学习

> 方向 C · FR-44 ~ FR-49
> 详细设计: [04_skill-reinforcement-learning.md](../04_skill-reinforcement-learning.md)
> 依赖: 无
> 目标: Basal Ganglia 80% → 95%
> 状态: ✅
> 2026-04-23 最终校准：M10 当前阶段已 100% 收口。当前实现已补齐 reward `metrics / baseline_metrics` 持久化、基于历史 reward 的相对效率基线、`exact -> operational -> family -> global` 分层上下文 bandit，以及结构化 RL 事件载荷。

---

## M10.1 奖励信号框架 (FR-44) — P0

- [x] 定义 `RewardSignal` / `RewardDimension` / `RewardConfig` 类型 (`@neurocore/protocol`)
- [x] 预置维度: task_completion / efficiency / safety / user_satisfaction
- [x] 实现 `RewardComputer`: 从 Episode + PredictionError 计算复合奖励
- [x] 实现 `InMemoryRewardStore`: 按 episode_id / skill_id / tenant_id 查询
- [x] 持久化 reward `metrics / baseline_metrics` 供后续效率基线查询
- [x] emit `reward.computed` 事件
- [x] 单元测试: 各维度计算 / 复合奖励公式 / store CRUD

## M10.2 技能策略网络 (FR-45) — P0

- [x] 定义 `SkillPolicy` / `SkillCandidate` / `SkillSelection` / `PolicyFeedback` 接口
- [x] 实现 `BanditSkillPolicy`: 增量 Q-Learning (Q(s) ← Q(s) + α(r - Q(s)))
- [x] 分层上下文策略：`exact -> operational -> family -> global`
- [x] `selectSkill()` 输出 exploit/explore/forced 标注
- [x] `update()` 接收 PolicyFeedback 更新 Q 值
- [x] ProceduralMemoryProvider.retrieve() 集成 SkillPolicy
- [x] emit `policy.updated` 事件
- [x] 单元测试: selectSkill / update / Q 值收敛

## M10.3 探索-利用策略 (FR-46) — P1

- [x] 定义 `ExplorationStrategy` SPI
- [x] 实现 `EpsilonGreedy`: ε 衰减 (ε₀=0.3, γ=0.995, ε_min=0.01)
- [x] 实现 `UCB`: UCB(s) = Q(s) + c√(lnN/n)
- [x] 实现 `ThompsonSampling`: Beta 分布后验采样
- [x] high 风险技能不参与探索
- [x] emit `exploration.triggered` 事件
- [x] 单元测试: 各策略选择行为 / 衰减 / 高风险排除

## M10.4 技能评估与裁剪 (FR-47) — P1

- [x] 定义 `SkillEvaluator` / `SkillEvaluation` / `PruningConfig` 接口
- [x] 实现 5 维评估: success_rate / avg_reward / usage_frequency / recency / reward_trend
- [x] 评分低于阈值 → deprecated
- [x] deprecated 超 TTL → pruned (soft/hard delete)
- [x] emit `skill.evaluated` / `skill.pruned` 事件
- [x] 单元测试: 评估 / 降级 / 裁剪管道

## M10.5 迁移学习 (FR-48) — P2

- [x] 定义 `SkillTransferEngine` / `DomainSimilarity` / `TransferResult` 接口
- [x] 域相似度计算: 特征向量余弦相似度
- [x] 技能迁移: 触发条件适配 + 执行模板调整
- [x] 迁移后 confidence 惩罚 + 验证期
- [x] 失败自动回退
- [x] emit `skill.transferred` 事件
- [x] 单元测试: 相似度计算 / 迁移 / 验证 / 回退

## M10.6 在线学习管道 (FR-49) — P2

- [x] 定义 `OnlineLearner` / `ReplayBuffer` / `Experience` 接口
- [x] 实现 `PrioritizedReplayBuffer`: TD-error 优先级采样
- [x] mini-batch 参数更新 (batch_size=32, interval=10 episodes)
- [x] 异步更新不阻塞主认知循环
- [x] 单元测试: buffer add/sample / 优先级采样 / 更新触发

## M10.7 Integration & Regression

- [x] 新增 6 个事件注册到 `NeuroCoreEventType`
- [x] `policy.updated / exploration.triggered / skill.transferred / skill.pruned` 使用结构化 RL 事件载荷
- [x] 新增 `RLConfig` 到 `AgentProfile`
- [x] rl_config 未配置时自动 fallback 到现有阈值机制
- [x] CycleEngine Learn 阶段集成 RewardComputer
- [x] Focused regression 全通过（`tests/skill-rl.test.mjs`、`tests/skill-system.test.mjs`、`tests/runtime.test.mjs`、`tests/memory-provider-config.test.mjs`）
- [x] `tsc --noEmit` 通过
- [x] 集成测试: Episode → Reward → Policy Update → Skill Selection 闭环

---

## Acceptance Criteria

| # | 条件 |
|---|
| AC-1 | 已满足：RewardComputer 可从 Episode 计算四维奖励信号，composite_reward ∈ [-1, 1] |
| AC-2 | 已满足：BanditSkillPolicy 基于历史奖励选择技能，标注 exploit/explore |
| AC-3 | 已满足：三种探索策略可配置切换，高风险技能不参与探索 |
| AC-4 | 已满足：技能评分低于阈值自动 deprecated，超 TTL 自动裁剪 |
| AC-5 | 已满足：rl_config 未配置时行为不变（fallback） |
| AC-6 | 已满足：Basal Ganglia 完成度 80% → 95% |
| AC-7 | 已满足：M10 当前阶段 100% 收口，后续仅保留训练运营与更强训练基础设施 |
