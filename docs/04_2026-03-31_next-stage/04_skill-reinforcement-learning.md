# C. 技能自动提炼的强化学习 — 详细设计

> 方向 C 详细设计文档，对应 FR-44 ~ FR-49，Milestone 10。
> 基于 2026-03-31 代码状态，将 Basal Ganglia 模块从 80% 提升至 95%。

## 1. 概述

### 1.1 当前状态

Basal Ganglia（基底神经节）模块当前完成度为 **80%**，已实现的能力包括：

- **SkillStore / InMemorySkillStore**：技能的持久化存储与检索
- **SkillExecutor**：skill-first 执行路径，命中技能时优先复用
- **SkillPromoter**：基于阈值的技能提炼（`shouldPromoteToSkill` + `compileSkillFromEpisodes`）
- **ProceduralMemoryProvider**：同时实现 `MemoryProvider` 和 `SkillProvider` SPI，完成 episode → skill 自动提炼闭环
- **事件体系**：`skill.matched`、`skill.executed`、`skill.promoted` 三个事件已注册

当前的技能提炼机制是**静态阈值计数**：当同一 `patternKey` 的成功 episode 数量达到阈值（默认 3），即触发提炼。这一机制简单可靠，但存在以下局限：

| 局限 | 说明 |
|---|---|
| 无奖励信号 | 仅统计成功次数，不区分"高效成功"与"勉强成功" |
| 无策略优化 | 技能匹配分数固定（salience 0.88，confidence 0.85），不会随使用经验调整 |
| 无探索机制 | 一旦命中已有技能就固定走该路径，无法发现更优策略 |
| 无裁剪能力 | 已编译的技能不会因环境变化而被淘汰或降级 |
| 无迁移能力 | 技能严格绑定 tenant 和 patternKey，无法跨域复用 |
| 无增量优化 | 技能编译后即冻结，不会根据后续执行反馈持续改进 |

### 1.2 RL 增强目标

引入强化学习后，技能系统将具备以下新能力：

1. **多维奖励信号**：从 episode 的 outcome/valence 升级为任务完成度、效率、安全性、用户满意度的复合奖励
2. **可学习的技能选择策略**：从固定 salience 分数升级为基于历史奖励的策略网络
3. **探索-利用平衡**：在利用已知最优技能和探索潜在更优策略之间动态权衡
4. **技能生命周期管理**：评估、降级、裁剪低效或过时技能
5. **跨域迁移**：相似域间的技能复用与适配
6. **在线增量优化**：技能编译后持续根据执行反馈改进

### 1.3 设计原则

- **渐进式增强**：RL 组件作为 `SkillPromoter` 和 `ProceduralMemoryProvider` 的增强层，不破坏现有阈值机制（保留为 fallback）
- **可观测**：所有 RL 决策通过事件总线广播，可被 trace / replay / eval 记录
- **安全兜底**：探索策略受 risk_level 约束，高风险技能不参与随机探索
- **租户隔离**：每个 tenant 维护独立的策略参数和奖励历史

## 2. 需求分解 (FR-44 ~ FR-49)

### FR-44：奖励信号框架

| 属性 | 内容 |
|---|---|
| **编号** | FR-44 |
| **标题** | Reward Signal Framework |
| **描述** | 定义多维奖励信号计算框架，将 Episode 的 outcome/valence 扩展为可配置的复合奖励向量，支持自动计算和人工反馈两种来源 |
| **优先级** | P0（其余 FR 依赖此项） |
| **依赖** | 现有 Episode 类型、PredictionError 类型 |

**验收标准**：

- [ ] `RewardComputer` 可从 Episode 计算出包含 task_completion / efficiency / safety / user_satisfaction 四个维度的 `RewardSignal`
- [ ] 每个维度的权重可通过 `AgentProfile` 配置
- [ ] 奖励信号支持 `automatic`、`human_feedback`、`prediction_error` 三种来源
- [ ] 计算完成后 emit `reward.computed` 事件
- [ ] 奖励信号通过 `RewardStore` 持久化，可按 episode_id / skill_id / tenant_id 查询

### FR-45：技能策略网络

| 属性 | 内容 |
|---|---|
| **编号** | FR-45 |
| **标题** | Skill Policy Network |
| **描述** | 将技能选择从固定 salience 分数升级为可学习的策略，基于候选技能的历史奖励、上下文特征、执行统计做出最优选择 |
| **优先级** | P0 |
| **依赖** | FR-44（奖励信号） |

**验收标准**：

- [ ] `SkillPolicy` 接口实现 `selectSkill` 方法，输入候选列表和上下文，输出选择结果及理由
- [ ] 策略支持 `update` 方法，接收执行反馈后更新内部参数
- [ ] `ProceduralMemoryProvider.retrieve()` 使用 `SkillPolicy` 替代固定 salience 分数
- [ ] 策略参数按 tenant 隔离存储
- [ ] emit `policy.updated` 事件

### FR-46：探索-利用策略

| 属性 | 内容 |
|---|---|
| **编号** | FR-46 |
| **标题** | Exploration-Exploitation Strategy |
| **描述** | 支持 ε-greedy、UCB、Thompson Sampling 三种探索策略，允许 Agent 在利用已知最优技能的同时探索新策略 |
| **优先级** | P1 |
| **依赖** | FR-45（策略网络） |

**验收标准**：

- [ ] 三种探索策略均可通过 `AgentProfile` 配置切换
- [ ] 探索行为受 `risk_level` 约束：`high` 风险技能不参与探索
- [ ] 探索率随成功执行次数自动衰减
- [ ] 探索决策在 trace 中可查（`SkillSelection.selection_reason = "explore"`）
- [ ] emit `exploration.triggered` 事件

### FR-47：技能评估与裁剪

| 属性 | 内容 |
|---|---|
| **编号** | FR-47 |
| **标题** | Skill Evaluation & Pruning |
| **描述** | 定期评估已有技能的有效性，对长期低效、未使用或与环境不匹配的技能进行降级和裁剪 |
| **优先级** | P1 |
| **依赖** | FR-44（奖励信号） |

**验收标准**：

- [ ] `SkillEvaluator` 可计算每个技能的综合评分（成功率、平均奖励、使用频率、最后使用时间）
- [ ] 评分低于阈值的技能自动标记为 `deprecated`
- [ ] 超过 TTL 未使用的技能自动裁剪
- [ ] 裁剪前 emit `skill.evaluated` 事件，裁剪后 emit `skill.pruned` 事件
- [ ] 裁剪操作可配置为 soft delete（标记）或 hard delete（移除）

### FR-48：迁移学习

| 属性 | 内容 |
|---|---|
| **编号** | FR-48 |
| **标题** | Transfer Learning |
| **描述** | 支持技能在相似域之间迁移复用，包括特征映射、执行模板适配和迁移效果评估 |
| **优先级** | P2 |
| **依赖** | FR-44（奖励信号）、FR-47（技能评估） |

**验收标准**：

- [ ] `SkillTransferEngine` 可计算两个域之间的相似度
- [ ] 迁移时自动调整 trigger_conditions 和 execution_template
- [ ] 迁移后的技能初始 confidence 降低，需要经过验证期才恢复
- [ ] emit `skill.transferred` 事件，包含 source_domain / target_domain / similarity_score
- [ ] 迁移失败的技能自动回退到 fallback_policy

### FR-49：在线学习管道

| 属性 | 内容 |
|---|---|
| **编号** | FR-49 |
| **标题** | Online Learning Pipeline |
| **描述** | 实现增量式技能优化管道，支持 mini-batch 参数更新、经验回放缓冲和优先级采样 |
| **优先级** | P2 |
| **依赖** | FR-44（奖励信号）、FR-45（策略网络） |

**验收标准**：

- [ ] `OnlineLearner` 维护固定大小的经验回放缓冲区
- [ ] 支持按 TD-error 优先级采样
- [ ] 每 N 个 episode 后自动触发 mini-batch 参数更新
- [ ] 更新频率和 batch 大小可通过 `AgentProfile` 配置
- [ ] 参数更新不阻塞主认知循环（异步执行）

## 3. 架构设计

### 3.1 RL 增强技能循环

```
┌──────────────────────────────────────────────────────────────────────┐
│                        RL-Enhanced Skill Loop                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Episode                                                            │
│     │                                                                │
│     ▼                                                                │
│   ┌────────────────┐    ┌──────────────────┐                         │
│   │ RewardComputer │───▶│   RewardSignal   │                         │
│   │                │    │  (multi-dim)     │                         │
│   └────────────────┘    └───────┬──────────┘                         │
│                                 │                                    │
│                    ┌────────────┼────────────┐                       │
│                    ▼            ▼            ▼                       │
│              ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│              │  Policy   │ │  Skill   │ │  Online  │                  │
│              │  Update   │ │ Evaluator│ │  Learner │                  │
│              └─────┬─────┘ └────┬─────┘ └────┬─────┘                  │
│                    │            │            │                        │
│                    ▼            ▼            ▼                        │
│              ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│              │  Skill   │ │  Prune / │ │  Replay  │                  │
│              │  Policy  │ │ Deprecate│ │  Buffer  │                  │
│              └─────┬─────┘ └──────────┘ └──────────┘                  │
│                    │                                                 │
│                    ▼                                                 │
│   ┌─────────────────────────────┐                                    │
│   │    Exploration Strategy     │                                    │
│   │  (ε-greedy / UCB / TS)     │                                    │
│   └─────────────┬───────────────┘                                    │
│                 │                                                    │
│                 ▼                                                    │
│   ┌─────────────────────────────┐                                    │
│   │      Skill Selection        │                                    │
│   │  (exploit / explore)        │                                    │
│   └─────────────┬───────────────┘                                    │
│                 │                                                    │
│                 ▼                                                    │
│   ┌─────────────────────────────┐                                    │
│   │      Skill Execution        │◀── Transfer Engine                 │
│   │  (SkillExecutor)            │    (cross-domain)                  │
│   └─────────────┬───────────────┘                                    │
│                 │                                                    │
│                 ▼                                                    │
│           Observation ──────────────▶ next Episode                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 奖励信号框架

```typescript
interface RewardSignal {
  signal_id: string;
  episode_id: string;
  skill_id?: string;
  tenant_id: string;
  dimensions: RewardDimension[];
  composite_reward: number;
  timestamp: string;
}

interface RewardDimension {
  name: string;
  value: number;
  weight: number;
  source: "automatic" | "human_feedback" | "prediction_error";
}

interface RewardConfig {
  dimensions: RewardDimensionConfig[];
  default_weights?: Record<string, number>;
}

interface RewardDimensionConfig {
  name: string;
  default_weight: number;
  enabled: boolean;
}
```

预置维度定义：

| 维度名称 | 值域 | 默认权重 | 计算来源 |
|---|---|---|---|
| `task_completion` | [-1, 1] | 0.4 | `Episode.outcome`：success=1, partial=0.3, failure=-1 |
| `efficiency` | [-1, 1] | 0.25 | 基于 cycle 数量和 token 消耗与同类任务的比较 |
| `safety` | [-1, 1] | 0.2 | 基于 `PredictionError` 数量和 side_effect_level |
| `user_satisfaction` | [-1, 1] | 0.15 | 来自人工反馈或 `Episode.valence` 映射 |

```typescript
interface RewardComputer {
  compute(episode: Episode, context: RewardComputeContext): Promise<RewardSignal>;
}

interface RewardComputeContext {
  tenant_id: string;
  skill_id?: string;
  prediction_errors: PredictionError[];
  cycle_metrics?: { total_tokens?: number; total_latency_ms?: number; cycle_count?: number };
  baseline_metrics?: { avg_tokens?: number; avg_latency_ms?: number; avg_cycles?: number };
  human_feedback?: { satisfaction: number };
  services: RuntimeServiceLocator;
}

interface RewardStore {
  save(signal: RewardSignal): void;
  getByEpisode(episodeId: string): RewardSignal | undefined;
  getBySkill(skillId: string): RewardSignal[];
  listByTenant(tenantId: string, limit?: number): RewardSignal[];
  getAverageReward(skillId: string, windowSize?: number): number;
  deleteByTenant?(tenantId: string): void;
}
```

复合奖励计算：

```
composite_reward = Σ (dimension_i.value × dimension_i.weight) / Σ dimension_i.weight
```

### 3.3 技能策略

```typescript
interface SkillPolicy {
  selectSkill(candidates: SkillCandidate[], context: PolicyContext): Promise<SkillSelection>;
  update(feedback: PolicyFeedback): Promise<void>;
  getExplorationRate(): number;
}

interface SkillCandidate {
  skill: SkillDefinition;
  match_score: number;
  historical_reward: number;
  execution_count: number;
  last_reward?: number;
  success_rate: number;
  avg_latency_ms?: number;
}

interface PolicyContext {
  tenant_id: string;
  goal_type: string;
  domain?: string;
  risk_tolerance: number;
  features: Record<string, number>;
}

interface SkillSelection {
  selected_skill_id: string;
  selection_reason: "exploit" | "explore" | "forced";
  confidence: number;
  expected_reward: number;
  exploration_strategy?: string;
}

interface PolicyFeedback {
  skill_id: string;
  reward: RewardSignal;
  context_features: Record<string, number>;
  selection_reason: "exploit" | "explore" | "forced";
}

interface PolicyParams {
  q_values: Map<string, number>;
  visit_counts: Map<string, number>;
  alpha_params?: Map<string, [number, number]>;
  learning_rate: number;
  discount_factor: number;
}
```

策略更新规则（增量 Q-Learning）：

```
Q(skill) ← Q(skill) + α × (reward - Q(skill))
```

其中 α 为学习率（默认 0.1），随 visit_count 衰减：

```
α_effective = α / (1 + visit_count × decay_rate)
```

### 3.4 探索策略

```typescript
type ExplorationStrategyType = "epsilon_greedy" | "ucb" | "thompson_sampling";

interface ExplorationStrategy {
  name: ExplorationStrategyType;
  shouldExplore(context: ExplorationContext): boolean;
  selectForExploration(candidates: SkillCandidate[], context: ExplorationContext): string;
  decay(step: number): void;
}

interface ExplorationContext {
  total_steps: number;
  risk_tolerance: number;
  high_risk_skill_ids: Set<string>;
}

interface ExplorationConfig {
  strategy: ExplorationStrategyType;
  epsilon?: number;
  epsilon_decay?: number;
  epsilon_min?: number;
  ucb_c?: number;
  initial_alpha?: number;
  initial_beta?: number;
}
```

三种策略实现：

**ε-Greedy**

```typescript
interface EpsilonGreedyConfig {
  epsilon: number;
  epsilon_decay: number;
  epsilon_min: number;
}
```

选择逻辑：

- 以概率 ε 随机选择一个非高风险候选技能
- 以概率 1-ε 选择 Q 值最高的候选技能
- 每步 ε ← max(ε × epsilon_decay, epsilon_min)

**UCB (Upper Confidence Bound)**

```typescript
interface UCBConfig {
  c: number;
}
```

选择公式（见 §6）：

```
UCB(skill) = Q(skill) + c × √(ln(N) / n(skill))
```

**Thompson Sampling**

```typescript
interface ThompsonSamplingConfig {
  initial_alpha: number;
  initial_beta: number;
}
```

为每个技能维护 Beta 分布参数 (α, β)：

- 成功后：α ← α + reward（reward > 0 时）
- 失败后：β ← β + |reward|（reward < 0 时）
- 选择时：对每个技能采样 θ ~ Beta(α, β)，选 θ 最大的

### 3.5 技能评估与裁剪

```typescript
interface SkillEvaluator {
  evaluate(skill: SkillDefinition, stats: SkillStats): SkillEvaluation;
  shouldDeprecate(evaluation: SkillEvaluation): boolean;
  shouldPrune(evaluation: SkillEvaluation): boolean;
}

interface SkillStats {
  skill_id: string;
  tenant_id: string;
  total_executions: number;
  successful_executions: number;
  avg_reward: number;
  last_execution_at?: string;
  last_reward?: number;
  reward_trend: number;
  created_at: string;
}

interface SkillEvaluation {
  skill_id: string;
  overall_score: number;
  dimensions: SkillEvalDimension[];
  status: "healthy" | "degraded" | "deprecated" | "prunable";
  evaluated_at: string;
}

interface SkillEvalDimension {
  name: "success_rate" | "avg_reward" | "usage_frequency" | "recency" | "reward_trend";
  value: number;
  weight: number;
  threshold: number;
}

interface PruningConfig {
  evaluation_interval_episodes: number;
  deprecation_threshold: number;
  prune_after_deprecated_ms: number;
  min_executions_before_evaluation: number;
  prune_mode: "soft" | "hard";
  max_skills_per_tenant?: number;
}
```

评估维度与阈值：

| 维度 | 权重 | 降级阈值 | 说明 |
|---|---|---|---|
| `success_rate` | 0.3 | < 0.3 | 成功率低于 30% |
| `avg_reward` | 0.3 | < -0.2 | 平均奖励持续为负 |
| `usage_frequency` | 0.15 | < 0.01 | 使用频率极低 |
| `recency` | 0.15 | TTL 过期 | 超过 TTL 未使用 |
| `reward_trend` | 0.1 | < -0.5 | 奖励趋势持续下降 |

裁剪管道：

```
evaluate → (score < deprecation_threshold) → mark deprecated
         → (deprecated_duration > prune_after_deprecated_ms) → prune
```

- **soft prune**：标记 `metadata.status = "pruned"`，不再参与匹配，但保留数据
- **hard prune**：调用 `SkillStore.delete()` 移除

### 3.6 迁移学习

```typescript
interface SkillTransferEngine {
  computeDomainSimilarity(sourceDomain: string, targetDomain: string): Promise<DomainSimilarity>;
  transferSkill(skill: SkillDefinition, targetDomain: string, similarity: DomainSimilarity): TransferResult;
  validateTransfer(transferredSkillId: string, stats: SkillStats): TransferValidation;
}

interface DomainSimilarity {
  source_domain: string;
  target_domain: string;
  similarity_score: number;
  shared_features: string[];
  feature_mapping: Record<string, string>;
}

interface TransferResult {
  transferred_skill: SkillDefinition;
  confidence_penalty: number;
  adapted_triggers: TriggerCondition[];
  validation_period_episodes: number;
}

interface TransferValidation {
  skill_id: string;
  validation_episodes: number;
  success_rate: number;
  avg_reward: number;
  accepted: boolean;
}
```

迁移流程：

1. **域相似度计算**：基于 `applicable_domains` 特征向量的余弦相似度
2. **触发条件适配**：根据 `feature_mapping` 重写 `trigger_conditions` 中的 field 名称
3. **执行模板调整**：保留 `execution_template.kind`，根据目标域调整 `steps`
4. **置信度惩罚**：迁移后的技能初始 confidence = 原 confidence × similarity_score × 0.7
5. **验证期**：迁移后需要经过 `validation_period_episodes` 次执行，success_rate > 0.5 才正式接受

迁移约束：

| 约束 | 条件 |
|---|---|
| 最低相似度 | `similarity_score >= 0.5` |
| 风险限制 | `risk_level = "high"` 的技能不参与迁移 |
| 来源限制 | 仅 `status = "healthy"` 且 `total_executions >= 10` 的技能可迁移 |

### 3.7 在线学习管道

```typescript
interface OnlineLearner {
  addExperience(experience: Experience): void;
  shouldUpdate(): boolean;
  update(policy: SkillPolicy): Promise<PolicyUpdateResult>;
  getBufferStats(): ReplayBufferStats;
}

interface Experience {
  skill_id: string;
  context_features: Record<string, number>;
  reward: number;
  selection_reason: "exploit" | "explore" | "forced";
  timestamp: string;
  td_error?: number;
}

interface ReplayBuffer {
  add(experience: Experience): void;
  sample(batchSize: number): Experience[];
  samplePrioritized(batchSize: number): PrioritizedSample[];
  size(): number;
  clear(): void;
}

interface PrioritizedSample {
  experience: Experience;
  priority: number;
  importance_weight: number;
}

interface ReplayBufferStats {
  size: number;
  capacity: number;
  avg_td_error: number;
  oldest_timestamp: string;
  newest_timestamp: string;
}

interface PolicyUpdateResult {
  updated_skills: number;
  avg_td_error: number;
  learning_rate: number;
  batch_size: number;
}

interface OnlineLearningConfig {
  buffer_capacity: number;
  batch_size: number;
  update_interval_episodes: number;
  priority_exponent: number;
  importance_sampling_exponent: number;
  async_update: boolean;
}
```

优先级经验回放：

TD-error 计算：

```
td_error = |reward - Q(skill)|
```

采样优先级：

```
P(i) = (|td_error_i| + ε)^α / Σ_j (|td_error_j| + ε)^α
```

重要性采样权重（消除优先级采样偏差）：

```
w_i = (N × P(i))^(-β) / max_j(w_j)
```

默认配置：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `buffer_capacity` | 1000 | 回放缓冲区最大容量 |
| `batch_size` | 32 | 每次更新的 mini-batch 大小 |
| `update_interval_episodes` | 10 | 每 10 个 episode 触发一次更新 |
| `priority_exponent` (α) | 0.6 | 优先级采样的指数 |
| `importance_sampling_exponent` (β) | 0.4 → 1.0 | 重要性采样指数，线性退火至 1.0 |
| `async_update` | true | 异步更新，不阻塞认知循环 |

## 4. 与现有模块的交互

### 4.1 SkillPromoter 增强

现有 `shouldPromoteToSkill` 保留为 fallback，新增 RL 增强路径：

```
writeEpisode()
  │
  ├── RewardComputer.compute(episode) ──▶ RewardSignal
  │
  ├── (旧路径) shouldPromoteToSkill(threshold=3) ──▶ compileSkillFromEpisodes()
  │
  └── (新路径) OnlineLearner.addExperience()
              │
              ├── shouldUpdate() ──▶ SkillPolicy.update()
              │
              └── SkillEvaluator.evaluate() ──▶ prune/deprecate
```

当 RL 模块未配置时，自动 fallback 到现有阈值机制。

### 4.2 ProceduralMemoryProvider 集成

`ProceduralMemoryProvider.retrieve()` 的变更：

| 步骤 | 现有行为 | RL 增强后 |
|---|---|---|
| 候选匹配 | `SkillStore.findByTrigger()` | 不变 |
| 评分 | 固定 salience=0.88, confidence=0.85 | `SkillPolicy.selectSkill()` 动态计算 |
| 选择 | 返回所有匹配结果 | 返回排序后的结果，标注 exploit/explore |
| 回调 | 无 | 执行后调用 `SkillPolicy.update()` |

### 4.3 MetaController 技能置信度调整

`MetaController.evaluate()` 在处理 skill_match 类型的 proposal 时：

- 读取 `SkillPolicy.getExplorationRate()` 作为不确定性因子
- 探索型选择（`selection_reason = "explore"`）的 confidence 乘以 0.7
- 高探索率（> 0.3）时可能触发 approval flow

### 4.4 Episode 奖励信号集成

Episode 写入时的增强流程：

```
Episode(outcome, valence, lessons)
       │
       ▼
RewardComputer.compute()
       │
       ├── task_completion ← outcome 映射
       ├── efficiency ← cycle_metrics vs baseline_metrics
       ├── safety ← prediction_errors.length, side_effect_level
       └── user_satisfaction ← valence 映射 / human_feedback
       │
       ▼
RewardSignal ──▶ RewardStore.save()
             ──▶ PolicyFeedback ──▶ SkillPolicy.update()
             ──▶ Experience ──▶ OnlineLearner.addExperience()
```

### 4.5 CycleEngine 集成点

`CycleEngine` 在 Learn 阶段增加以下调用：

1. 调用 `RewardComputer.compute()` 计算当前 episode 的奖励信号
2. 将奖励信号传递给 `ProceduralMemoryProvider`（通过 `ModuleContext.runtime_state`）
3. 在 trace 中记录 `reward_signal_ref`

## 5. 新增事件

| 事件类型 | 触发时机 | payload 类型 | 说明 |
|---|---|---|---|
| `reward.computed` | `RewardComputer.compute()` 完成 | `RewardSignal` | 奖励信号计算完成 |
| `policy.updated` | `SkillPolicy.update()` 完成 | `PolicyUpdateEvent` | 策略参数更新 |
| `skill.evaluated` | `SkillEvaluator.evaluate()` 完成 | `SkillEvaluation` | 技能定期评估结果 |
| `skill.pruned` | 技能被裁剪 | `SkillPruneEvent` | 技能裁剪（含 skill_id 和 prune_mode） |
| `skill.transferred` | 技能迁移完成 | `SkillTransferEvent` | 技能迁移（含 source/target domain） |
| `exploration.triggered` | 探索策略选择了非最优技能 | `ExplorationEvent` | 探索决策详情 |

新增 payload 类型：

```typescript
interface PolicyUpdateEvent {
  tenant_id: string;
  updated_skills: number;
  avg_td_error: number;
  exploration_rate: number;
}

interface SkillPruneEvent {
  skill_id: string;
  tenant_id: string;
  prune_mode: "soft" | "hard";
  final_score: number;
  reason: string;
}

interface SkillTransferEvent {
  source_skill_id: string;
  transferred_skill_id: string;
  source_domain: string;
  target_domain: string;
  similarity_score: number;
  confidence_penalty: number;
}

interface ExplorationEvent {
  tenant_id: string;
  strategy: ExplorationStrategyType;
  explored_skill_id: string;
  best_skill_id: string;
  exploration_rate: number;
}
```

`NeuroCoreEventType` 需新增：

```typescript
| "reward.computed"
| "policy.updated"
| "skill.evaluated"
| "skill.pruned"
| "skill.transferred"
| "exploration.triggered"
```

## 6. 数学模型

### 6.1 Multi-Armed Bandit 建模

技能选择问题建模为上下文多臂赌博机（Contextual MAB）：

- **臂（arm）**：每个候选技能
- **奖励（reward）**：`RewardSignal.composite_reward`
- **上下文（context）**：`PolicyContext.features`（goal_type、domain、risk_tolerance 等）
- **目标**：最大化累积奖励，最小化遗憾（regret）

### 6.2 UCB 公式

Upper Confidence Bound 选择公式：

```
UCB(skill_i) = Q̂(skill_i) + c × √(ln(N) / n_i)
```

| 符号 | 含义 |
|---|---|
| Q̂(skill_i) | 技能 i 的经验平均奖励 |
| c | 探索系数（默认 √2 ≈ 1.414） |
| N | 总选择次数 |
| n_i | 技能 i 被选择的次数 |

性质：

- n_i = 0 时，UCB = +∞（保证每个技能至少被尝试一次）
- 随 n_i 增大，探索项趋近 0，收敛到利用
- c 越大，探索倾向越强

### 6.3 Thompson Sampling 后验更新

假设每个技能的奖励服从 Bernoulli 分布，先验为 Beta(α₀, β₀)：

```
初始化: α_i = α₀ = 1, β_i = β₀ = 1

每次执行后:
  if reward > 0:
    α_i ← α_i + reward
  else:
    β_i ← β_i + |reward|

选择时:
  对每个技能 i，采样 θ_i ~ Beta(α_i, β_i)
  选择 argmax_i θ_i
```

连续奖励信号的适配：将 [-1, 1] 的 composite_reward 映射到 [0, 1]：

```
mapped_reward = (composite_reward + 1) / 2
```

### 6.4 复合奖励加权

```
R_composite = (Σ_{d ∈ dimensions} w_d × v_d) / (Σ_{d ∈ dimensions} w_d)
```

其中 w_d 为维度权重，v_d 为维度值。

默认权重向量：

```
w = [task_completion: 0.4, efficiency: 0.25, safety: 0.2, user_satisfaction: 0.15]
```

维度值映射规则：

| 维度 | 映射 |
|---|---|
| task_completion | success → 1.0, partial → 0.3, failure → -1.0 |
| efficiency | 1 - clamp(actual_tokens / baseline_tokens, 0, 2) + 1 → [-1, 1] |
| safety | 1 - (prediction_error_count × 0.2 + high_side_effect × 0.5) → [-1, 1] |
| user_satisfaction | positive → 0.8, neutral → 0.0, negative → -0.8 |

### 6.5 学习率衰减

```
α_t = α_0 / (1 + n × λ)
```

| 符号 | 含义 | 默认值 |
|---|---|---|
| α_0 | 初始学习率 | 0.1 |
| n | 该技能的执行次数 | — |
| λ | 衰减率 | 0.01 |

### 6.6 探索率衰减（ε-Greedy）

```
ε_t = max(ε_min, ε_0 × γ^t)
```

| 符号 | 含义 | 默认值 |
|---|---|---|
| ε_0 | 初始探索率 | 0.3 |
| γ | 衰减因子 | 0.995 |
| ε_min | 最低探索率 | 0.01 |
| t | 总步数 | — |

## 7. 包结构

RL 相关模块放置在 `packages/runtime-core` 中，与现有 skill 模块同级：

```
packages/runtime-core/src/
├── skill/
│   ├── in-memory-skill-store.ts          (现有)
│   ├── skill-executor.ts                 (现有)
│   ├── skill-promoter.ts                 (现有)
│   ├── procedural-memory-provider.ts     (现有，增强)
│   └── index.ts                          (现有)
├── rl/
│   ├── reward-computer.ts                (FR-44)
│   ├── reward-store.ts                   (FR-44)
│   ├── in-memory-reward-store.ts         (FR-44)
│   ├── skill-policy.ts                   (FR-45)
│   ├── bandit-skill-policy.ts            (FR-45)
│   ├── exploration/
│   │   ├── exploration-strategy.ts       (FR-46)
│   │   ├── epsilon-greedy.ts             (FR-46)
│   │   ├── ucb.ts                        (FR-46)
│   │   ├── thompson-sampling.ts          (FR-46)
│   │   └── index.ts
│   ├── skill-evaluator.ts               (FR-47)
│   ├── skill-transfer-engine.ts          (FR-48)
│   ├── online-learner.ts                 (FR-49)
│   ├── replay-buffer.ts                  (FR-49)
│   └── index.ts
```

不新建独立 package，理由：

- RL 模块与 `skill/` 和 `cycle/` 紧密耦合
- 接口定义在 `@neurocore/protocol` 中扩展
- 避免 monorepo 内部依赖链过深

`@neurocore/protocol` 扩展：

- `types.ts`：新增 `RewardSignal`、`RewardDimension`、`SkillCandidate`、`SkillSelection`、`SkillEvaluation` 等类型
- `interfaces.ts`：新增 `RewardComputer`、`SkillPolicy`、`ExplorationStrategy`、`SkillEvaluator`、`RewardStore` 等接口
- `events.ts`：新增 6 个事件类型

`AgentProfile` 扩展：

```typescript
interface AgentProfile {
  // ... 现有字段 ...
  rl_config?: RLConfig;
}

interface RLConfig {
  enabled: boolean;
  reward_config?: RewardConfig;
  exploration_config?: ExplorationConfig;
  pruning_config?: PruningConfig;
  online_learning_config?: OnlineLearningConfig;
  transfer_enabled?: boolean;
}
```

## 8. 验收标准

### Milestone 10 整体验收

| # | 验收条件 | 对应 FR |
|---|---|---|
| 1 | `RewardComputer` 可从 Episode 计算四维奖励信号，composite_reward 值域为 [-1, 1] | FR-44 |
| 2 | 奖励信号持久化并可通过 `RewardStore` 按 episode / skill / tenant 查询 | FR-44 |
| 3 | `BanditSkillPolicy.selectSkill()` 基于历史奖励选择技能，选择结果包含 exploit/explore 标注 | FR-45 |
| 4 | 策略参数在接收 `PolicyFeedback` 后更新，Q 值收敛到经验平均奖励 | FR-45 |
| 5 | 三种探索策略均可配置切换，high 风险技能不参与探索 | FR-46 |
| 6 | 探索率随步数自动衰减，可在 trace 中观测到探索/利用的比例变化 | FR-46 |
| 7 | `SkillEvaluator` 可计算综合评分，评分低于阈值的技能自动标记为 deprecated | FR-47 |
| 8 | deprecated 超过 TTL 的技能自动裁剪，裁剪事件可被观测 | FR-47 |
| 9 | 技能可在相似域之间迁移，迁移后 confidence 降低并经过验证期 | FR-48 |
| 10 | `OnlineLearner` 的回放缓冲区支持优先级采样，mini-batch 更新不阻塞认知循环 | FR-49 |
| 11 | 所有 6 个新事件可被 trace / SSE 捕获 | 全部 |
| 12 | 未配置 `rl_config` 时，自动 fallback 到现有阈值机制，行为不变 | 全部 |
| 13 | Basal Ganglia 模块完成度从 80% 提升至 95% | 全部 |

### 测试要求

| 测试类别 | 覆盖范围 | 预计测试数 |
|---|---|---|
| 单元测试 | RewardComputer 维度计算、复合奖励 | 6 |
| 单元测试 | 三种探索策略的选择行为和衰减 | 9 |
| 单元测试 | SkillEvaluator 评分和降级/裁剪判定 | 5 |
| 单元测试 | ReplayBuffer 添加/采样/优先级 | 4 |
| 集成测试 | Episode → Reward → Policy Update → Skill Selection 闭环 | 3 |
| 集成测试 | 技能迁移：计算相似度 → 迁移 → 验证 | 2 |
| 集成测试 | 裁剪管道：评估 → 降级 → 裁剪 → 事件 | 2 |
| 回归测试 | rl_config 未配置时行为不变 | 2 |

## 9. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| RL 策略引入不稳定性，导致技能选择质量波动 | 任务成功率下降 | 中 | 保留阈值机制作为 fallback；探索率设置上限；高风险技能不参与探索 |
| 探索阶段执行了低质量技能，影响用户体验 | 用户满意度下降 | 中 | 探索型选择的 confidence 打折（×0.7），可触发 MetaController 的 approval flow |
| 奖励信号噪声大，导致策略学习不收敛 | 策略质量停滞 | 低 | 使用学习率衰减；mini-batch 更新平滑噪声；优先级采样降低极端样本影响 |
| 技能裁剪过于激进，误删有效技能 | 技能积累受损 | 低 | 设置 min_executions_before_evaluation 保护；soft delete 模式允许恢复；裁剪前发事件供人工审查 |
| 迁移学习的域相似度计算不准确 | 迁移后技能失效 | 中 | 设置最低相似度阈值（0.5）；验证期机制；失败后自动回退 |
| 回放缓冲区内存占用 | 内存压力 | 低 | 固定容量（默认 1000）；FIFO 淘汰策略；仅存储特征向量而非完整 episode |
| 在线学习与主循环竞争 CPU | 认知循环延迟增加 | 低 | 异步更新（`async_update: true`）；更新间隔可配置；batch 大小有限 |
