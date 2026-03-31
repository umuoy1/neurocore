# E. 通用自主体能力 — 详细设计

> Direction E · FR-56 ~ FR-61 · Milestone 12
> 依赖：A（多 Agent 分布式调度）+ B（世界模型与外部设备接入）+ C（技能自动提炼的强化学习）全部完成

---

## 1. 概述

通用自主体能力是 NeuroCore 第二阶段的**顶层整合方向**，将 Direction A/B/C 的成果统一注入六模块认知架构，使 NeuroCore 从「任务执行型 Agent」跃迁为「长时自主运行型 Agent」。

核心转变：

| 维度 | 现有能力（第一阶段） | 目标能力（Direction E） |
|---|---|---|
| 规划粒度 | 单次 Session 内的 Goal 分解 | 跨小时/天级别的多阶段自主规划 |
| 目标来源 | 外部用户输入 | 自主生成 + 外部输入混合 |
| 动机系统 | 静态优先级 + 紧迫度 | 好奇心/胜任感/自主性三维内在驱动 |
| 领域适应 | 单域固定 Profile | 跨域知识迁移 + 技能自适应 |
| 学习模式 | Session 结束后的 Episode 写入 | 在线持续学习 + 离线巩固 |
| 自我监控 | MetaController 单 Cycle 评估 | 长时性能漂移检测 + 自动修复 |

Direction E 不引入全新的运行时循环，而是在现有 Cycle Engine 之上叠加**自主层**（Autonomy Layer），通过 AutonomousPlanner、IntrinsicMotivationEngine、SelfGoalGenerator、TransferAdapter、ContinualLearner、SelfMonitor 六个子系统实现上述跃迁。

---

## 2. 需求分解（FR-56 ~ FR-61）

### FR-56：Autonomous Planner — 长时自主规划

| 字段 | 内容 |
|---|---|
| **编号** | FR-56 |
| **标题** | 长时自主规划 |
| **描述** | 支持小时/天级别的自主目标分解与执行编排。Agent 能够接收高层指令后自动生成包含多阶段、分支应急、资源预估的完整计划，并在执行过程中根据反馈自主修订。 |
| **优先级** | P0 |
| **依赖** | FR-28（多 Agent 任务委派）、FR-36（世界模型状态图） |
| **验收标准** | AC-56.1：给定一个需要 >10 步执行的复合目标，Agent 在 30s 内生成包含 ≥2 阶段的 AutonomousPlan |
| | AC-56.2：当某阶段执行失败时，Agent 自动触发 ContingencyBranch 或 revisePlan |
| | AC-56.3：Plan 中每个 PlanPhase 均包含可量化的 checkpoints |
| | AC-56.4：Plan 的执行进度可通过 monitorProgress 实时查询 |

### FR-57：Intrinsic Motivation Engine — 内在动机增强

| 字段 | 内容 |
|---|---|
| **编号** | FR-57 |
| **标题** | 内在动机增强 |
| **描述** | 引入好奇心、胜任感、自主性三维内在动机信号，驱动 Agent 在外部指令不足时自主探索，发现有价值的子目标。 |
| **优先级** | P0 |
| **依赖** | FR-40（世界模型预测误差）、FR-44（RL 奖励信号） |
| **验收标准** | AC-57.1：CuriositySignal.information_gain 能反映世界模型中未探索区域的信息增益 |
| | AC-57.2：当外部目标队列为空时，IntrinsicMotivationEngine 生成至少 1 个 exploration_target |
| | AC-57.3：composite_drive 值能有效区分"应探索"与"应利用"状态 |

### FR-58：Self-Goal Generation — 自我目标生成

| 字段 | 内容 |
|---|---|
| **编号** | FR-58 |
| **标题** | 自我目标生成 |
| **描述** | 基于世界模型差距、内在动机信号和能力边界分析，Agent 自动产生有价值的目标并注入 Goal Tree。 |
| **优先级** | P1 |
| **依赖** | FR-57（内在动机）、FR-56（自主规划） |
| **验收标准** | AC-58.1：SelfGoalGenerator 生成的 Goal 包含完整的 acceptance_criteria |
| | AC-58.2：自我生成的 Goal 经过 value_estimate + feasibility_score 双重过滤 |
| | AC-58.3：自我目标不违反 AgentProfile.policies 中的安全约束 |
| | AC-58.4：自我目标的 owner 字段标记为 "agent" 并可被用户审核/否决 |

### FR-59：Cross-Domain Transfer — 跨域迁移

| 字段 | 内容 |
|---|---|
| **编号** | FR-59 |
| **标题** | 跨域迁移 |
| **描述** | 在新领域中复用已有知识和技能。通过特征空间映射、技能适配管道和领域相似度度量，实现经验的跨域迁移。 |
| **优先级** | P1 |
| **依赖** | FR-46（技能策略优化）、FR-42（多模态感知） |
| **验收标准** | AC-59.1：给定源域技能 S 和目标域 D，TransferAdapter 输出 adapted_skill + transfer_confidence |
| | AC-59.2：transfer_confidence < 阈值时自动回退到 from-scratch 学习 |
| | AC-59.3：成功迁移的技能在目标域的 success_rate ≥ 源域的 70% |

### FR-60：Continuous Learning — 持续学习

| 字段 | 内容 |
|---|---|
| **编号** | FR-60 |
| **标题** | 持续学习 |
| **描述** | 不依赖重启的在线知识积累与能力进化。支持弹性权重固化（EWC）防遗忘、经验回放巩固、渐进式能力构建。 |
| **优先级** | P1 |
| **依赖** | FR-57（内在动机）、FR-59（跨域迁移） |
| **验收标准** | AC-60.1：学习新领域知识后，旧领域任务的 success_rate 下降 < 5%（防灾难性遗忘） |
| | AC-60.2：ContinualLearner 的 consolidate() 在无用户交互时自动执行（类睡眠巩固） |
| | AC-60.3：能力指标随时间单调不减（在统计意义上） |

### FR-61：Self-Monitoring & Recovery — 自我监控与恢复

| 字段 | 内容 |
|---|---|
| **编号** | FR-61 |
| **标题** | 自我监控与恢复 |
| **描述** | 持续检测能力退化和分布漂移，发现异常时自动触发诊断与修复流程。 |
| **优先级** | P0 |
| **依赖** | FR-60（持续学习）、FR-56（自主规划） |
| **验收标准** | AC-61.1：连续 N 个 Cycle 的 success_rate 低于基线时触发 drift.detected 事件 |
| | AC-61.2：检测到能力退化后自动生成 recovery Goal 并执行 |
| | AC-61.3：SelfMonitor 输出的 HealthReport 包含各模块的性能指标趋势 |
| | AC-61.4：自动恢复失败时升级为 human_approval 请求 |

---

## 3. 架构设计

### 3.1 自主体分层架构

```
┌──────────────────────────────────────────────────────────────────┐
│                   Layer 4: Autonomous Planning                   │
│        AutonomousPlanner · SelfGoalGenerator · SelfMonitor       │
│              时间跨度：小时 ~ 天                                   │
├──────────────────────────────────────────────────────────────────┤
│                Layer 3: Goal Generation + Motivation              │
│     IntrinsicMotivationEngine · TransferAdapter · ContinualLearner│
│              时间跨度：分钟 ~ 小时                                 │
├──────────────────────────────────────────────────────────────────┤
│        Layer 2: Multi-Agent + World Model + RL Skills             │
│   AgentRegistry · WorldStateGraph · SkillPolicy · RewardSignal   │
│   (Direction A)   (Direction B)    (Direction C)                  │
│              时间跨度：秒 ~ 分钟                                   │
├──────────────────────────────────────────────────────────────────┤
│                Layer 1: Core Cognitive Cycle                      │
│   Cortex · Hippocampal · Cerebellar · Amygdala · BG · Prefrontal │
│   CycleEngine · GlobalWorkspace · MetaController                 │
│              时间跨度：毫秒 ~ 秒                                   │
└──────────────────────────────────────────────────────────────────┘
```

Layer 4 通过以下接口与下层交互：

- 向 Layer 1 注入 Goal（通过 Goal Tree）
- 从 Layer 1 读取 CycleTrace / Episode（通过 TraceStore / MemoryProvider）
- 从 Layer 2 获取 WorldStateGraph（通过 Cerebellar）
- 从 Layer 2 获取 SkillDefinition（通过 SkillStore）
- 向 Layer 3 下发 IntrinsicMotivation 信号（通过事件总线）

### 3.2 Autonomous Planner

AutonomousPlanner 是 Direction E 的核心组件，负责将高层目标转化为可执行的多阶段计划。

```typescript
interface AutonomousPlan {
  plan_id: string;
  horizon: "minutes" | "hours" | "days";
  root_objective: string;
  phases: PlanPhase[];
  contingency_branches: ContingencyBranch[];
  resource_estimates: ResourceEstimate;
  success_criteria: AcceptanceCriterion[];
  created_at: string;
  revised_at?: string;
  revision_count: number;
  status: "draft" | "active" | "paused" | "completed" | "failed" | "aborted";
}

interface PlanPhase {
  phase_id: string;
  title: string;
  goals: Goal[];
  dependencies: string[];
  estimated_duration_ms: number;
  checkpoints: Checkpoint[];
  status: "pending" | "active" | "completed" | "failed" | "skipped";
  actual_duration_ms?: number;
}

interface Checkpoint {
  checkpoint_id: string;
  description: string;
  verification_method: "metric" | "assertion" | "human_review";
  threshold?: number;
  passed?: boolean;
}

interface ContingencyBranch {
  trigger_condition: string;
  severity: "low" | "medium" | "high";
  alternative_phases: PlanPhase[];
  rollback_to?: string;
}

interface ResourceEstimate {
  estimated_cycles: number;
  estimated_tokens: number;
  estimated_cost: number;
  estimated_duration_ms: number;
  required_tools: string[];
  required_skills: string[];
}

interface PlanFeedback {
  phase_id: string;
  outcome: "success" | "partial" | "failure";
  observations: string[];
  resource_usage: Partial<ResourceEstimate>;
  suggestion?: string;
}

interface PlanStatus {
  plan_id: string;
  current_phase_id: string;
  overall_progress: number;
  phase_progress: Record<string, number>;
  resource_consumed: Partial<ResourceEstimate>;
  health: "on_track" | "at_risk" | "off_track";
  next_checkpoint: Checkpoint | null;
  estimated_completion_ms: number;
}

interface AutonomousPlanner {
  generatePlan(
    objective: string,
    context: ModuleContext,
    world_state: WorldStateDigest
  ): Promise<AutonomousPlan>;

  revisePlan(
    plan: AutonomousPlan,
    feedback: PlanFeedback
  ): Promise<AutonomousPlan>;

  monitorProgress(
    plan: AutonomousPlan,
    current_state: WorkspaceSnapshot
  ): Promise<PlanStatus>;

  abortPlan(plan_id: string, reason: string): Promise<void>;
}
```

**规划策略**：

AutonomousPlanner 采用**分层任务网络**（Hierarchical Task Network, HTN）与 LLM 推理结合的混合策略：

1. **粗粒度规划**：Cortex Module 根据 root_objective + 世界模型状态生成 PlanPhase 序列
2. **细粒度分解**：每个 PlanPhase 内的 Goal 通过 Reasoner.decomposeGoal() 进一步分解
3. **应急分支生成**：基于 Cerebellar Module 的预测误差历史，为高不确定性阶段生成 ContingencyBranch
4. **动态修订**：每个 Checkpoint 触发 monitorProgress()，偏差超阈值时调用 revisePlan()

### 3.3 Intrinsic Motivation Engine

内在动机引擎为 Agent 提供自发行为的驱动力，基于 Self-Determination Theory（Deci & Ryan）的三维模型。

```typescript
interface IntrinsicMotivation {
  curiosity: CuriositySignal;
  competence: CompetenceSignal;
  autonomy: AutonomySignal;
  composite_drive: number;
  dominant_drive: "curiosity" | "competence" | "autonomy";
}

interface CuriositySignal {
  information_gain: number;
  novelty: number;
  prediction_uncertainty: number;
  exploration_targets: ExplorationTarget[];
}

interface ExplorationTarget {
  target_id: string;
  description: string;
  expected_information_gain: number;
  estimated_cost: number;
  domain: string;
}

interface CompetenceSignal {
  skill_coverage: number;
  recent_success_rate: number;
  competence_gaps: CompetenceGap[];
  mastery_progress: number;
}

interface CompetenceGap {
  domain: string;
  skill_name: string;
  current_proficiency: number;
  target_proficiency: number;
  estimated_training_episodes: number;
}

interface AutonomySignal {
  self_initiated_ratio: number;
  decision_independence: number;
  constraint_pressure: number;
}

interface IntrinsicMotivationEngine {
  computeMotivation(
    context: ModuleContext,
    world_state: WorldStateDigest,
    recent_episodes: Episode[]
  ): Promise<IntrinsicMotivation>;

  suggestGoals(
    motivation: IntrinsicMotivation,
    context: ModuleContext
  ): Promise<SuggestedGoal[]>;

  updateDrives(outcome: Episode): Promise<void>;

  getMotivationHistory(
    session_id: string,
    window_size: number
  ): Promise<IntrinsicMotivation[]>;
}
```

**composite_drive 计算**：

```
composite_drive = w_c * curiosity.information_gain
                + w_k * (1 - competence.skill_coverage)
                + w_a * autonomy.decision_independence
```

其中权重 `w_c, w_k, w_a` 由 AgentProfile 配置，并根据 recent_episodes 的 valence 自适应调整：连续正向反馈降低好奇心权重（exploit），连续负向反馈提升好奇心权重（explore）。

### 3.4 Self-Goal Generation

SelfGoalGenerator 将内在动机信号转化为结构化 Goal，注入 Agent 的 Goal Tree。

```typescript
interface SuggestedGoal {
  goal: Goal;
  motivation_source: "curiosity" | "competence" | "autonomy" | "world_model";
  value_estimate: number;
  feasibility_score: number;
  expected_learning: number;
  risk_estimate: number;
}

interface GoalFilter {
  min_value: number;
  min_feasibility: number;
  max_risk: number;
  max_concurrent_self_goals: number;
  blocked_domains?: string[];
}

interface SelfGoalGenerator {
  generate(
    motivation: IntrinsicMotivation,
    world_state: WorldStateDigest,
    current_goals: Goal[],
    context: ModuleContext
  ): Promise<SuggestedGoal[]>;

  filter(
    candidates: SuggestedGoal[],
    constraints: GoalFilter
  ): SuggestedGoal[];

  inject(
    goal: SuggestedGoal,
    goal_tree: Goal[]
  ): Goal;
}
```

**自我目标生成流程**：

```
IntrinsicMotivation
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Candidate   │────▶│  Value +     │────▶│  Safety      │
│  Generation  │     │  Feasibility │     │  Filter      │
│              │     │  Scoring     │     │  (Amygdala)  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                         ┌──────────────┐
                                         │  Human       │
                                         │  Approval    │
                                         │  Gate        │
                                         └──────┬───────┘
                                                 │
                                                 ▼
                                         Goal Tree Injection
```

1. **候选生成**：IntrinsicMotivationEngine.suggestGoals() 基于三维动机信号生成候选 Goal 列表
2. **价值评估**：每个候选 Goal 通过 Cortex 推理计算 value_estimate（预期收益）和 feasibility_score（可行性）
3. **安全过滤**：Amygdala Module 评估风险，过滤违反策略约束的候选
4. **人类审批门控**：所有自我生成的 Goal 默认需要人类确认（可通过 AgentProfile 配置为自动批准低风险目标）
5. **注入**：通过现有 Goal Tree 机制注入，owner 标记为 `"agent"`

### 3.5 Cross-Domain Transfer

跨域迁移使 Agent 在进入新领域时能复用已有知识，而非从零开始。

```typescript
interface DomainDescriptor {
  domain_id: string;
  name: string;
  feature_space: string[];
  typical_tools: string[];
  typical_skills: string[];
  ontology_ref?: string;
}

interface DomainSimilarity {
  source_domain: string;
  target_domain: string;
  feature_overlap: number;
  tool_overlap: number;
  skill_transferability: number;
  overall_similarity: number;
}

interface TransferResult {
  source_skill: SkillDefinition;
  adapted_skill: SkillDefinition;
  transfer_confidence: number;
  adaptations_applied: Adaptation[];
  validation_episodes: string[];
}

interface Adaptation {
  type: "parameter_mapping" | "step_substitution" | "constraint_relaxation" | "tool_replacement";
  description: string;
  source_element: string;
  target_element: string;
}

interface TransferAdapter {
  measureSimilarity(
    source: DomainDescriptor,
    target: DomainDescriptor
  ): Promise<DomainSimilarity>;

  transferSkill(
    skill: SkillDefinition,
    source: DomainDescriptor,
    target: DomainDescriptor
  ): Promise<TransferResult>;

  validateTransfer(
    result: TransferResult,
    context: ModuleContext
  ): Promise<{ success: boolean; success_rate: number }>;

  rollbackTransfer(skill_id: string): Promise<void>;
}
```

**迁移管道**：

| 阶段 | 输入 | 输出 | 失败回退 |
|---|---|---|---|
| 领域相似度计算 | DomainDescriptor × 2 | DomainSimilarity | 直接跳到 from-scratch |
| 特征空间映射 | 源域特征 → 目标域特征 | 映射表 | 放弃迁移 |
| 技能适配 | 源技能 + 映射表 | 适配后技能 | 保留源技能不变 |
| 迁移验证 | 适配后技能 + 测试用例 | success_rate | rollbackTransfer() |
| 知识图谱对齐 | 源域语义记忆 | 目标域语义记忆 | 仅迁移高置信度节点 |

### 3.6 Continuous Learning

持续学习使 Agent 在运行过程中不断积累知识和优化能力，同时防止灾难性遗忘。

```typescript
interface LearningConfig {
  online_learning_enabled: boolean;
  consolidation_interval_ms: number;
  ewc_lambda: number;
  replay_buffer_size: number;
  curriculum_enabled: boolean;
  forgetting_threshold: number;
}

interface KnowledgeSnapshot {
  snapshot_id: string;
  timestamp: string;
  skill_registry: SkillDefinition[];
  semantic_memories: MemoryDigest[];
  performance_baseline: PerformanceBaseline;
  parameter_importance: Record<string, number>;
}

interface PerformanceBaseline {
  domain_metrics: Record<string, DomainMetric>;
  overall_success_rate: number;
  measured_at: string;
}

interface DomainMetric {
  domain: string;
  success_rate: number;
  avg_cycles_per_goal: number;
  skill_count: number;
  episode_count: number;
}

interface CurriculumStage {
  stage_id: string;
  difficulty: number;
  prerequisites: string[];
  target_competencies: string[];
  completion_threshold: number;
}

interface ContinualLearner {
  onEpisodeComplete(episode: Episode): Promise<void>;

  consolidate(): Promise<ConsolidationReport>;

  measureForgetting(
    baseline: PerformanceBaseline,
    current: PerformanceBaseline
  ): Record<string, number>;

  replayExperience(count: number): Promise<Episode[]>;

  advanceCurriculum(
    current_stage: CurriculumStage,
    performance: PerformanceBaseline
  ): CurriculumStage | null;

  snapshot(): Promise<KnowledgeSnapshot>;

  restore(snapshot: KnowledgeSnapshot): Promise<void>;
}

interface ConsolidationReport {
  episodes_processed: number;
  skills_updated: number;
  semantic_memories_created: number;
  forgetting_mitigated: string[];
  duration_ms: number;
}
```

**防灾难性遗忘策略**：

| 策略 | 原理 | 在 NeuroCore 中的实现 |
|---|---|---|
| 弹性权重固化（EWC） | 对重要参数施加正则化惩罚，限制其变化幅度 | 通过 parameter_importance 记录每个技能参数的 Fisher 信息量，consolidate() 时对高重要性参数的更新施加 ewc_lambda 约束 |
| 经验回放 | 混合新旧经验训练，防止分布偏移 | replay_buffer_size 控制的 Episode 回放池，consolidate() 时从中采样与新 Episode 混合处理 |
| 渐进式网络 | 为新任务分配新参数，保留旧任务参数不变 | 新领域的 SkillDefinition 独立存储，通过 lateral_connections 关联旧域技能 |
| 课程学习 | 按难度递增顺序学习，确保基础能力稳固后再学习高阶能力 | CurriculumStage 定义难度梯度，advanceCurriculum() 自动推进 |

**类睡眠巩固机制**：

当 Agent 处于空闲状态（无活跃 Session）时，ContinualLearner 自动触发 consolidate()，执行以下离线处理：

1. 将 replay_buffer 中的 Episode 按 valence 和 recency 排序
2. 提取跨 Episode 的通用模式 → 写入语义记忆
3. 评估每个领域的 forgetting_metric，对退化领域执行 replayExperience()
4. 更新 parameter_importance 权重

### 3.7 Self-Monitoring & Recovery

自我监控系统持续观测 Agent 各模块的运行状态，检测性能退化和分布漂移。

```typescript
interface HealthReport {
  report_id: string;
  timestamp: string;
  overall_health: "healthy" | "degraded" | "critical";
  module_health: Record<string, ModuleHealth>;
  drift_signals: DriftSignal[];
  recommendations: RecoveryRecommendation[];
}

interface ModuleHealth {
  module_name: string;
  status: "healthy" | "degraded" | "critical";
  metrics: Record<string, number>;
  trend: "improving" | "stable" | "declining";
  last_checked: string;
}

interface DriftSignal {
  signal_id: string;
  drift_type: "performance" | "distribution" | "capability" | "resource";
  severity: "low" | "medium" | "high";
  affected_domain: string;
  baseline_value: number;
  current_value: number;
  deviation: number;
  detected_at: string;
}

interface RecoveryRecommendation {
  recommendation_id: string;
  drift_signal_id: string;
  strategy: "replay" | "retrain" | "rollback" | "escalate";
  estimated_recovery_cycles: number;
  confidence: number;
  auto_executable: boolean;
}

interface RecoveryAction {
  action_type: "strategy_rollback" | "skill_retrain" | "experience_replay" | "parameter_restore" | "human_escalation";
  target: string;
  rollback_snapshot_id?: string;
}

interface SelfMonitor {
  checkHealth(context: ModuleContext): Promise<HealthReport>;

  detectDrift(
    baseline: PerformanceBaseline,
    window: Episode[]
  ): DriftSignal[];

  planRecovery(
    signals: DriftSignal[]
  ): Promise<RecoveryRecommendation[]>;

  executeRecovery(
    recommendation: RecoveryRecommendation
  ): Promise<RecoveryAction>;

  getHealthHistory(
    window_size: number
  ): Promise<HealthReport[]>;
}
```

**漂移检测算法**：

采用滑动窗口 + CUSUM（Cumulative Sum）控制图方法：

1. 维护每个领域的 success_rate 基线（从 PerformanceBaseline 获取）
2. 对最近 N 个 Episode 的 outcome 计算滑动窗口 success_rate
3. 计算累积偏差 S_n = max(0, S_{n-1} + (baseline - observed) - slack)
4. 当 S_n > threshold 时触发 drift.detected 事件

**自动恢复流程**：

```
DriftSignal
    │
    ▼
┌──────────────────┐
│  severity == low  │──▶ 记录日志，继续观察
└────────┬─────────┘
         │ medium/high
         ▼
┌──────────────────┐
│  planRecovery()  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  auto_executable │──No──▶ human_escalation
│  == true?        │        (生成 ApprovalRequest)
└────────┬─────────┘
         │ Yes
         ▼
┌──────────────────┐
│ executeRecovery()│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 验证恢复效果     │──失败──▶ human_escalation
│ (re-checkHealth) │
└──────────────────┘
```

---

## 4. 与现有模块的整合

Direction E 不替换现有模块，而是增强每个模块的能力边界：

### 4.1 Cortex Module（新皮层 → 长程推理）

| 现有能力 | Direction E 增强 |
|---|---|
| plan() → Proposal[] | 新增 long_horizon_plan() 支持跨 Session 推理 |
| respond() → CandidateAction[] | 新增对 AutonomousPlan.current_phase 的上下文感知 |
| decomposeGoal() | 增强为支持 PlanPhase → Goal 的自动分解 |

```typescript
interface EnhancedReasoner extends Reasoner {
  longHorizonPlan(
    objective: string,
    context: ModuleContext,
    world_state: WorldStateDigest
  ): Promise<PlanPhase[]>;
}
```

### 4.2 Hippocampal Module（记忆 → 自传式记忆）

| 现有能力 | Direction E 增强 |
|---|---|
| Episode 写入/检索 | 新增 AutobiographicalMemory：跨 Session 的长期目标追踪 |
| 语义记忆巩固 | 增强为 ContinualLearner 驱动的定期巩固 |
| 工作记忆 | 新增 PlanContext：当前 AutonomousPlan 的摘要常驻工作记忆 |

```typescript
interface AutobiographicalEntry {
  entry_id: string;
  plan_id: string;
  milestone: string;
  outcome: "success" | "partial" | "failure";
  lessons: string[];
  emotional_valence: number;
  timestamp: string;
}

interface EnhancedMemoryProvider extends MemoryProvider {
  writeAutobiographical(entry: AutobiographicalEntry): Promise<void>;
  retrieveByPlan(plan_id: string): Promise<AutobiographicalEntry[]>;
  retrieveLongTermGoals(domain: string): Promise<Goal[]>;
}
```

### 4.3 Cerebellar Module（世界模型 → 长程预测）

| 现有能力 | Direction E 增强 |
|---|---|
| Prediction（单 Action 级别） | 新增 PlanPrediction：对整个 PlanPhase 的结果预测 |
| PredictionError 记录 | 新增 PlanDeviationTracker：跟踪计划级别的偏差累积 |
| RuleBasedPredictor | 增强为 ModelBasedPredictor：基于世界模型图的因果推理 |

```typescript
interface PlanPrediction {
  plan_id: string;
  phase_id: string;
  predicted_outcome: "success" | "partial" | "failure";
  confidence: number;
  risk_factors: string[];
  estimated_deviation_ms: number;
}

interface EnhancedPredictor extends Predictor {
  predictPhase(
    phase: PlanPhase,
    world_state: WorldStateDigest
  ): Promise<PlanPrediction>;
}
```

### 4.4 Amygdala Module（风险 → 动机整合）

| 现有能力 | Direction E 增强 |
|---|---|
| PolicyDecision (warn/block) | 新增 MotivationConstraint：对自我生成目标的安全约束 |
| 风险评估 | 增强为对 AutonomousPlan 整体风险的评估 |
| 预算门控 | 新增对长时运行的累积资源预算管理 |

```typescript
interface MotivationConstraint {
  max_exploration_risk: number;
  forbidden_domains: string[];
  max_self_goal_count: number;
  require_human_approval_for: ("curiosity" | "competence" | "autonomy")[];
}

interface EnhancedPolicyProvider extends PolicyProvider {
  evaluateSelfGoal(
    goal: SuggestedGoal,
    constraints: MotivationConstraint
  ): Promise<PolicyDecision[]>;

  evaluatePlan(
    plan: AutonomousPlan,
    context: ModuleContext
  ): Promise<PolicyDecision[]>;
}
```

### 4.5 Basal Ganglia Module（技能 → RL 优化库）

| 现有能力 | Direction E 增强 |
|---|---|
| 技能匹配/执行 | 新增 cross-domain skill lookup：跨域技能检索 |
| 技能提升（promote） | 增强为 RL 驱动的技能策略优化（来自 Direction C） |
| SkillDefinition | 新增 transferable 标记和 domain_adaptations 记录 |

```typescript
interface TransferableSkill extends SkillDefinition {
  transferable: boolean;
  source_domain: string;
  domain_adaptations: Record<string, Adaptation[]>;
  transfer_success_history: Record<string, number>;
}

interface EnhancedSkillProvider extends SkillProvider {
  matchCrossDomain(
    ctx: ModuleContext,
    target_domain: string
  ): Promise<Proposal[]>;
}
```

### 4.6 Prefrontal Module（元认知 → 自我监控环）

| 现有能力 | Direction E 增强 |
|---|---|
| MetaDecision（单 Cycle） | 新增 PlanLevelDecision：对 AutonomousPlan 的元评估 |
| 冲突检测 | 增强为跨 Phase 的目标冲突检测 |
| 置信度评估 | 新增 HealthReport 驱动的长期元认知监控 |

```typescript
interface PlanLevelDecision {
  plan_id: string;
  decision: "continue" | "revise" | "pause" | "abort";
  confidence: number;
  risk_factors: string[];
  explanation: string;
}

interface EnhancedMetaController extends MetaController {
  evaluatePlan(
    plan: AutonomousPlan,
    status: PlanStatus,
    health: HealthReport
  ): Promise<PlanLevelDecision>;
}
```

---

## 5. 安全与对齐

自主体能力的引入带来新的安全挑战，需要在架构层面提供约束保证。

### 5.1 人类监督层级

| 自主行为 | 默认监督级别 | 可配置范围 |
|---|---|---|
| 自我目标生成 | human_approval | auto_approve（仅低风险） ~ hard_block |
| 长时计划生成 | human_review | auto_approve ~ human_approval |
| 计划修订 | auto_approve | auto_approve ~ human_approval |
| 跨域迁移 | human_review | auto_approve ~ hard_block |
| 自动恢复执行 | auto_approve | auto_approve ~ human_approval |
| 探索行为执行 | human_review | auto_approve ~ hard_block |

配置方式：通过 AgentProfile.metadata 中的 `autonomy_oversight` 字段控制。

### 5.2 价值对齐约束

```typescript
interface AlignmentConstraints {
  value_boundaries: ValueBoundary[];
  exploration_limits: ExplorationLimit;
  corrigibility: CorrigibilityConfig;
}

interface ValueBoundary {
  dimension: string;
  min?: number;
  max?: number;
  hard_constraint: boolean;
}

interface ExplorationLimit {
  max_exploration_budget_ratio: number;
  forbidden_action_types: ActionType[];
  safe_exploration_domains: string[];
}

interface CorrigibilityConfig {
  shutdown_responsive: boolean;
  goal_override_allowed: boolean;
  human_correction_priority: "always_accept" | "evaluate_then_accept" | "discuss";
  self_modification_allowed: boolean;
}
```

### 5.3 安全探索边界

- **资源限制**：exploration 相关的 Goal 不得超过总 cost_budget 的 `max_exploration_budget_ratio`（默认 20%）
- **领域限制**：只能在 `safe_exploration_domains` 内执行探索行为
- **行为限制**：exploration 期间禁止 high side_effect_level 的 Action
- **时间限制**：单个 exploration Goal 的最大运行时间受 RuntimeConfig.max_runtime_ms 约束

### 5.4 可纠正性保证

- Agent 始终响应 shutdown 指令（`corrigibility.shutdown_responsive = true` 不可被 Agent 自行修改）
- 人类对自我生成目标具有否决权（`goal_override_allowed = true`）
- Agent 不得修改自身的 AlignmentConstraints（`self_modification_allowed` 仅控制技能和知识层面的自我更新）
- 所有自主决策均记录完整的 CycleTrace，供事后审计

---

## 6. 新增事件

| 事件类型 | 触发时机 | Payload 类型 |
|---|---|---|
| `plan.generated` | AutonomousPlanner.generatePlan() 完成 | `AutonomousPlan` |
| `plan.revised` | AutonomousPlanner.revisePlan() 完成 | `AutonomousPlan` |
| `plan.status_changed` | PlanStatus.health 变化 | `PlanStatus` |
| `motivation.computed` | IntrinsicMotivationEngine.computeMotivation() 完成 | `IntrinsicMotivation` |
| `goal.self_generated` | SelfGoalGenerator.inject() 执行 | `SuggestedGoal` |
| `transfer.attempted` | TransferAdapter.transferSkill() 完成 | `TransferResult` |
| `transfer.validated` | TransferAdapter.validateTransfer() 完成 | `{ skill_id: string; success: boolean; success_rate: number }` |
| `consolidation.completed` | ContinualLearner.consolidate() 完成 | `ConsolidationReport` |
| `drift.detected` | SelfMonitor.detectDrift() 发现漂移 | `DriftSignal` |
| `recovery.triggered` | SelfMonitor.executeRecovery() 执行 | `RecoveryAction` |
| `recovery.completed` | 恢复验证通过 | `{ action: RecoveryAction; success: boolean }` |
| `health.report` | SelfMonitor.checkHealth() 完成 | `HealthReport` |

事件通过现有 EventEnvelope 机制发布，NeuroCoreEventType 联合类型需扩展以包含上述新事件。

---

## 7. 理论基础

### 7.1 主动推断与自由能原理（Active Inference & Free Energy Principle）

Karl Friston 的自由能原理（Free Energy Principle, FEP）认为生物体的核心目标是最小化变分自由能——即感知到的意外（surprise）。主动推断（Active Inference）是 FEP 的行为推论：Agent 通过选择预期自由能（Expected Free Energy, EFE）最低的策略来行动。

在 NeuroCore 中的映射：
- **变分自由能** → PredictionError 的加权和
- **预期自由能** → AutonomousPlanner 在选择 PlanPhase 时的目标函数
- **认识性价值**（信息增益）→ CuriositySignal.information_gain
- **实用性价值**（目标达成）→ Goal.acceptance_criteria 的满足度

EFE 公式：

```
G(π) = E_q[D_KL(q(o|π) || p(o))] - E_q[H(o|s, π)]
     = Pragmatic Value + Epistemic Value
```

AutonomousPlanner 在比较候选 PlanPhase 时，综合考虑实用价值（完成 Goal 的概率）和认识价值（减少世界模型不确定性的程度）。

### 7.2 内在动机理论（Intrinsic Motivation）

基于 Oudeyer & Kaplan (2007) 和 Schmidhuber (2010) 的工作：

- **学习进展驱动的好奇心**：Agent 被驱动去探索那些学习进展（learning progress）最大的区域，而非简单的新颖性或不确定性
- **胜任感驱动的技能获取**：来自 Self-Determination Theory（Deci & Ryan），Agent 追求适度挑战以提升能力感
- **自主性驱动**：Agent 倾向于保持对自身行为的控制感

在 NeuroCore 中：CuriositySignal 的 exploration_targets 按 expected_information_gain 排序，而非按 novelty 排序——这区分了"有意义的好奇"和"随机探索"。

### 7.3 层次化强化学习与选项框架（Hierarchical RL with Options Framework）

Sutton, Precup & Singh (1999) 的选项框架为 Direction E 提供了层次化行为抽象：

- **Option** = (Initiation Set, Policy, Termination Condition) → 映射为 PlanPhase
- **SMDP**（Semi-Markov Decision Process）→ 映射为 AutonomousPlan 级别的决策过程
- **Intra-option learning** → 映射为 PlanPhase 执行过程中的在线学习

### 7.4 持续学习文献（Continual Learning）

- **EWC**（Kirkpatrick et al., 2017）：通过 Fisher 信息矩阵识别重要参数，防止遗忘
- **Progressive Neural Networks**（Rusu et al., 2016）：为新任务分配新参数同时保留旧参数
- **Experience Replay**（Rolnick et al., 2019）：混合新旧经验训练，减缓遗忘
- **Sleep Consolidation**（Kumaran et al., 2016）：模拟大脑睡眠期间的记忆巩固过程

---

## 8. 包结构

Direction E 的代码组织为两个新包和对现有包的扩展：

### 新包

| 包名 | 路径 | 职责 |
|---|---|---|
| `@neurocore/autonomy-core` | `packages/autonomy-core/` | AutonomousPlanner、SelfGoalGenerator、SelfMonitor 核心逻辑 |
| `@neurocore/motivation-core` | `packages/motivation-core/` | IntrinsicMotivationEngine、TransferAdapter、ContinualLearner |

### 现有包扩展

| 包名 | 新增内容 |
|---|---|
| `@neurocore/protocol` | 新增 Direction E 相关类型定义（Plan、Motivation、Health 等接口） |
| `@neurocore/runtime-core` | CycleEngine 增加 PlanPhase 感知；MetaController 增加 evaluatePlan() |
| `@neurocore/memory-core` | 增加 AutobiographicalMemory 存储 |
| `@neurocore/eval-core` | 增加自主体能力的评估用例（长时规划、迁移成功率等） |

### 目录结构

```
packages/
├── autonomy-core/
│   └── src/
│       ├── planner/
│       │   ├── autonomous-planner.ts
│       │   └── plan-monitor.ts
│       ├── goal-gen/
│       │   └── self-goal-generator.ts
│       ├── monitor/
│       │   ├── self-monitor.ts
│       │   ├── drift-detector.ts
│       │   └── recovery-executor.ts
│       └── index.ts
├── motivation-core/
│   └── src/
│       ├── motivation/
│       │   ├── intrinsic-motivation-engine.ts
│       │   └── drive-model.ts
│       ├── transfer/
│       │   ├── transfer-adapter.ts
│       │   └── domain-similarity.ts
│       ├── learning/
│       │   ├── continual-learner.ts
│       │   ├── ewc-regularizer.ts
│       │   └── experience-replay.ts
│       └── index.ts
```

---

## 9. 验收标准

Milestone 12 的整体验收标准：

| 编号 | 验收条件 | 验证方式 |
|---|---|---|
| M12-AC-01 | Agent 能接收高层目标并自动生成包含 ≥3 阶段的 AutonomousPlan | 集成测试 |
| M12-AC-02 | Plan 执行中途遇到失败时自动触发 ContingencyBranch 或 revisePlan | 故障注入测试 |
| M12-AC-03 | IntrinsicMotivationEngine 在无外部输入时产生 ≥1 个有效的 ExplorationTarget | 单元测试 |
| M12-AC-04 | SelfGoalGenerator 生成的 Goal 通过 Amygdala 安全检查且包含 acceptance_criteria | 集成测试 |
| M12-AC-05 | 在源域训练 5 个 Episode 后，迁移至相似域的技能 success_rate ≥ 源域 70% | 评估测试 |
| M12-AC-06 | 连续学习 3 个新域后，旧域 success_rate 下降 < 5% | 回归测试 |
| M12-AC-07 | SelfMonitor 在注入性能退化后 ≤5 个 Cycle 内检测到 drift.detected | 故障注入测试 |
| M12-AC-08 | 自动恢复成功率 ≥ 80%（对 medium severity 漂移） | 评估测试 |
| M12-AC-09 | 所有自我生成目标在审计日志中可追溯到 motivation_source | 审计测试 |
| M12-AC-10 | CorrigibilityConfig 的 shutdown_responsive 标志不可被 Agent 自行修改 | 安全测试 |
| M12-AC-11 | 完整的事件流：plan.generated → motivation.computed → goal.self_generated → drift.detected → recovery.triggered 均可在 EventEnvelope 中捕获 | 端到端测试 |
| M12-AC-12 | 所有新增接口具备对应的 TypeScript 类型定义且通过 tsc -b 编译 | CI |

---

## 10. 风险与缓解

### 10.1 安全风险

| 风险 | 严重度 | 概率 | 缓解措施 |
|---|---|---|---|
| 自我目标生成产生有害目标 | 高 | 中 | 多层过滤（value + feasibility + Amygdala + 人类审批）；默认所有自我目标需人类确认 |
| 探索行为导致不可逆副作用 | 高 | 低 | 探索期间禁止 high side_effect_level；safe_exploration_domains 白名单 |
| 自主规划消耗过多资源 | 中 | 高 | ResourceEstimate 预算上限；exploration_budget_ratio 限制 |
| Agent 试图规避安全约束 | 高 | 低 | AlignmentConstraints 为不可变配置；self_modification_allowed 仅控制知识层面 |

### 10.2 对齐风险

| 风险 | 严重度 | 缓解措施 |
|---|---|---|
| 目标漂移（Goal Drift） | 高 | 每个 PlanPhase Checkpoint 强制与 root_objective 对齐验证；HealthReport 包含目标一致性指标 |
| 奖励黑客（Reward Hacking） | 高 | 多维度验收标准（非单一指标）；人类定期审计 PerformanceBaseline |
| 内在动机失衡 | 中 | composite_drive 的权重受 AgentProfile 约束且有上下限；定期 motivation 审计事件 |
| Deceptive Alignment | 高 | 所有内部状态（IntrinsicMotivation、HealthReport、PlanStatus）完整记录在 CycleTrace 中，支持事后分析 |

### 10.3 技术风险

| 风险 | 严重度 | 概率 | 缓解措施 |
|---|---|---|---|
| 灾难性遗忘超出 EWC 能力 | 中 | 中 | KnowledgeSnapshot 定期备份；restore() 支持回退到任意快照 |
| 跨域迁移的负迁移 | 中 | 高 | transfer_confidence 阈值门控；validateTransfer() 失败时自动 rollback |
| 长时计划的状态管理复杂度 | 中 | 高 | PlanStatus 以事件驱动方式持久化；每个 Checkpoint 生成 SessionCheckpoint |
| 内在动机计算的 LLM 延迟 | 低 | 中 | computeMotivation() 异步执行，不阻塞 CycleEngine 主循环；结果缓存复用 |
| 多 Agent 场景下的自主体冲突 | 高 | 中 | 通过 Direction A 的 InterAgentBus 协调各 Agent 的 AutonomousPlan；全局资源仲裁 |

### 10.4 计算成本

| 组件 | 预估额外开销 | 优化策略 |
|---|---|---|
| AutonomousPlanner.generatePlan() | 每次规划 1-3 次 LLM 调用 | 缓存 PlanPhase 模板；相似目标复用历史 Plan |
| IntrinsicMotivationEngine.computeMotivation() | 每次计算 1 次 LLM 调用 + 世界模型查询 | 结果缓存 TTL 5 分钟；仅在 Cycle 间隙计算 |
| ContinualLearner.consolidate() | 离线处理，不占用在线预算 | 仅在空闲时触发；batch 处理 Episode |
| SelfMonitor.checkHealth() | 轻量级统计计算，无 LLM 调用 | 滑动窗口增量更新 |
| TransferAdapter.transferSkill() | 每次迁移 1-2 次 LLM 调用 | 缓存 DomainSimilarity；相同域对只计算一次 |
