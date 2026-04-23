# NeuroCore 下一代记忆系统架构规格

> 版本：1.0
> 日期：2026-04-24
> 状态：正式架构规格

---

## 1. 目标

本规格定义 NeuroCore 下一代记忆系统的正式架构边界、核心数据模型、运行时流程、治理语义、评测标准与实施顺序。

本规格的目标不是描述“所有可能的记忆技术”，而是定义一条可落地、可治理、可评测、可与现有 runtime 主链闭环的记忆架构。

本规格优先满足以下要求：

1. 记忆必须进入平台主链，而不是产品层外挂。
2. 记忆必须支持跨 session、跨重启、跨 checkpoint 持续存在。
3. 记忆必须区分事实真相、行为倾向、程序技能三种不同语义。
4. 记忆必须可删除、可回滚、可审计、可观测。
5. 记忆读取必须预算化，不能每轮无条件全量召回。
6. 记忆系统必须先形成完整工程闭环，再考虑更激进的参数化扩展。

---

## 2. 设计结论

下一代记忆系统采用以下正式结论：

1. **SQL-first 是核心架构，不是过渡方案。**
   长期事实记忆的真相源必须是规范化持久存储，而不是 fat snapshot、纯向量库、或纯参数记忆。
2. **核心系统采用四层主链。**
   Working / Episodic / Semantic / Procedural 是正式主链。
3. **瞬时适应不是核心层。**
   `micro-LoRA`、在线反向传播、短时参数偏移属于未来增强，不进入当前正式架构。
4. **参数记忆不是正式真相源。**
   `Soft Prompt`、`LoRA Adapter` 只作为可选增益层存在，不承担平台治理语义。
5. **检索必须先 Gate，再渐进展开。**
   记忆读取是预算化激活，不是每轮固定多路 provider 全开。
6. **巩固必须先符号化，再参数化。**
   先生成可读、可治理的 semantic card / skill spec，再决定是否训练参数增益层。
7. **训练必须后台化，推理优先。**
   任何巩固或训练都不能阻塞认知主路径。

---

## 3. 非目标

以下内容明确不属于当前正式架构范围：

- 把小模型作为唯一长期记忆体
- 把所有记忆直接 merge 进基座权重
- 以 `Soft Prompt / LoRA` 取代 SQL 记忆库
- 在线 `micro-LoRA` 训练作为默认路径
- KV Cache 持久化作为工作记忆主实现
- token 级 `kNN-LM` 插值作为基础推理路径
- 依赖 Redis、Kafka、图数据库或分布式锁作为前置条件

这些方向可以保留为后续实验，但不进入本规格的必选实现范围。

---

## 4. 为什么这样收敛

以下能力被判断为“有价值且闭环”：

- Runtime state 与长期记忆分离
- Episodic 事实真相层
- Semantic / Procedural 双层抽象
- Memory Gate
- Progressive disclosure
- 检索副作用驱动的激活统计
- LongMemEval retrieval-first 评测主线
- 官方 evaluator 桥接
- 训练后台化与推理优先

以下能力被判断为“华而不实或当前不闭环”，因此降级或推迟：

1. **瞬时适应层**
   `micro-LoRA` 需要推理期反向传播、训练信号定义、回滚策略、资源隔离，当前未形成闭环。
2. **把小模型当主记忆体**
   不可删改、不可审计、不可精确回滚，不适合作为平台主真相源。
3. **直接相变到参数记忆**
   如果没有中间的符号化对象，就无法被 Console、Meta、治理层和删除传播机制稳定消费。
4. **KV Cache 持久化**
   工程收益尚未证明足以覆盖复杂度，且与当前 checkpoint/restore 主链未闭环。
5. **过早引入复杂训练机制**
   在 retrieval discipline、治理语义、评测体系未稳定前，重训练系统会放大复杂度而不是解决根问题。

---

## 5. 术语

| 术语 | 定义 |
|---|---|
| Runtime State | 当前运行态，包括 session、goal、plan、approvals、trace 引用和 working memory 当前态 |
| Durable Memory | 跨 session 的持久记忆，包括 episodic / semantic / procedural 与其 artifact |
| Episode | 一条结构化经历记录，描述情境、决策、结果和证据 |
| Semantic Card | 一条可读、可治理的行为倾向对象 |
| Skill Spec | 一条可执行、可治理的程序技能对象 |
| Memory Gate | 每轮决定是否检索、检索哪层、预算多少的规划器 |
| Recall Bundle | 一次检索返回的标准化结果包 |
| Consolidation | 从 episode 聚合为 semantic/procedural 抽象的过程 |
| Parametric Unit | 绑定到 card/spec 的可选参数增益层，如 soft prompt 或 LoRA |

---

## 6. 总体架构

### 6.1 三个平面

记忆系统由三个平面组成：

| 平面 | 作用 | 真相级别 |
|---|---|---|
| Runtime State Plane | 当前认知连续性与恢复 | 当前运行真相 |
| Durable Memory Plane | 长期事实、抽象和技能 | 长期真相 |
| Parametric Extension Plane | 参数化增益层 | 非真相源 |

### 6.2 四层主链

| 层 | 主要载体 | 作用 | 真相级别 |
|---|---|---|---|
| Working | Runtime state | 当前在做什么 | 当前运行真相 |
| Episodic | SQL episodes + evidence/artifacts | 发生过什么 | 长期真相 |
| Semantic | semantic cards | 稳定行为倾向 | 长期真相 |
| Procedural | skill specs | 自动化技能 | 长期真相 |

### 6.3 可选增益层

| 增益层 | 绑定对象 | 用途 | 是否必需 |
|---|---|---|---|
| Soft Prompt | Semantic Card | 降低延迟、增加行为偏置 | 否 |
| LoRA Adapter | Skill Spec | 提升程序性模式生成偏置 | 否 |

---

## 7. Runtime / Durable 边界

### 7.1 RuntimeStateStore 负责什么

`RuntimeStateStore` 只负责恢复运行态，不承担长期记忆主存储职责。

它负责：

- session
- goals
- approvals / pending approvals
- trace records
- checkpoint 引用
- working memory 的轻量当前态

### 7.2 Durable Memory Plane 负责什么

长期记忆本体进入独立持久层：

- episodic SQL tables
- semantic cards
- procedural skill specs
- evidence / artifacts
- 可选 parametric unit 元数据

### 7.3 fat snapshot 的地位

fat snapshot 不是正式长期记忆格式。

它只允许承担两种角色：

1. 历史兼容迁移输入
2. 显式 checkpoint 资产中的兼容表示

运行时不应继续把 fat snapshot 当成长期记忆主存储。

---

## 8. Working Memory 规格

### 8.1 职责

Working Memory 表示当前认知快照，不是聊天历史，不是日志，不是长期存储。

它必须服务于：

- 当前目标维持
- 决策链连续性
- 未决问题跟踪
- 证据句柄留存
- 下一轮上下文装配

### 8.2 数据结构

```text
WorkingMemoryState
  current_goal
  active_plan
  decision_chain
  active_observations
  unresolved_questions
  risk_state
  strategy_bias
  memory_hints
  evidence_refs
```

### 8.3 约束

- 每个 cycle 重写，不做无限追加
- 必须受 token budget 约束
- 必须支持 slim snapshot / checkpoint 恢复
- 不允许把 working memory 当长期知识库

### 8.4 可选增强

KV cache heavy hitters 可作为未来优化，但不属于当前正式主路径。

---

## 9. Episodic Memory 规格

### 9.1 职责

Episodic Memory 是长期事实真相层。

它负责保存：

- 什么情境下发生了什么
- 选择了什么策略 / 动作
- 产生了什么结果
- 哪些证据和 artifact 支撑该结果
- 该 episode 后续被怎样回忆、引用、淘汰

### 9.2 Episode 数据结构

```text
Episode
  episode_id
  tenant_id
  session_id
  cycle_id
  timestamp

  trigger_summary
  context_digest
  context_embedding
  goal_refs
  plan_refs

  selected_strategy
  selected_action
  tool_name
  action_params

  observation_summary
  evidence_refs
  artifact_refs

  outcome
  outcome_summary
  reward_signal
  valence
  lessons

  entity_refs
  temporal_refs
  causal_links

  activation_trace
  consolidation_pressure
  lifecycle_state
  schema_version
```

### 9.3 必需字段说明

- `evidence_refs`
  - 指向支撑结论的证据对象
- `artifact_refs`
  - 指向文件、网页、tool output、diff、trace segment 等
- `temporal_refs`
  - 支持时间演化和有效性判断
- `causal_links`
  - 支持“为什么会这样”的追问
- `activation_trace`
  - 支持回忆统计、巩固和自然遗忘

### 9.4 存储要求

Episodic Memory 必须以 SQL 规范化表为核心存储。

至少支持：

- 结构化过滤
- 向量检索
- FTS
- tenant / session / time / tool / lifecycle 索引

### 9.5 生命周期

每条 episode 必须处于以下状态之一：

- `live`
- `dormant`
- `archived`
- `tombstoned`

含义如下：

- `live`：默认可被热路径检索
- `dormant`：仍可召回，但排序下沉
- `archived`：默认不进热路径，保留可追溯性
- `tombstoned`：进入删除传播与治理链

### 9.6 真相原则

如果 semantic/procedural/parametric 结果与 episode 真相冲突，以 episode 及其证据为准。

### 9.7 特殊保留规则

高 `|valence|` 的单次事件默认保留在 episodic 层，不优先抽象化。

理由：

- 影响高但样本少
- 需要保留情境细节
- 常用于治理、回滚、审计

### 9.8 自然遗忘

Episodic 层采用“认知下沉 + 物理治理”双机制：

- 认知层面：少激活 -> 排序下沉 -> 更少命中 -> 继续下沉
- 物理层面：archive / retention / tombstone / wipe

不把“定时 TTL 删除”当成唯一遗忘机制。

---

## 10. Semantic Memory 规格

### 10.1 职责

Semantic Memory 保存稳定行为倾向，不保存原始事实知识。

典型内容：

- 用户偏好
- 租户风格
- 风险偏好
- 常见任务中的倾向性策略
- 需要避免的失败模式

### 10.2 正式对象：Semantic Card

```text
SemanticMemoryCard
  unit_id
  label
  summary
  rule_type
  scope
  confidence
  source_episode_ids
  counter_examples
  freshness
  activation_score
  decay_policy
  optional_parametric_ref
```

### 10.3 为什么必须先有 Card

Semantic Memory 必须先以 card 形式存在，因为 card：

- 可展示
- 可审计
- 可删除
- 可被 Meta 和 Console 消费
- 可在无参数增益层时独立工作

### 10.4 可选参数增益层

在 card 稳定后，可绑定：

```text
SemanticParametricUnit
  unit_id
  type = soft_prompt
  tokens_ref
  base_model_id
  train_recipe
  source_card_id
```

该层是优化项，不是必需项。

### 10.5 生成条件

只有在以下条件同时满足时，episode 群组才能生成 semantic card：

- context 或 domain 稳定
- strategy consistency 高
- 来源数量达到下限
- 反例比例不超过阈值

如果结果稳定为“避免某种策略”，也允许生成负向语义记忆。

---

## 11. Procedural Memory 规格

### 11.1 职责

Procedural Memory 保存自动化技能，而不是事实知识或短期偏好。

它必须与现有 skill 主链、RewardSignal、BanditSkillPolicy、SkillTransferEngine 保持兼容。

### 11.2 正式对象：Skill Spec

```text
ProceduralSkillSpec
  skill_id
  name
  kind
  description
  trigger_conditions
  required_inputs
  execution_template
  success_metrics
  risk_level
  source_episode_ids
  source_semantic_ids
  policy_stats
  optional_adapter_ref
```

### 11.3 为什么 Skill Spec 是主对象

Skill Spec 是平台级正式对象，因为它：

- 可执行
- 可审计
- 可回滚
- 可参与 policy / approval / RL
- 可迁移
- 可进入 Console

### 11.4 可选参数增益层

在 skill spec 稳定后，可绑定：

```text
ProceduralAdapterUnit
  adapter_id
  type = lora
  base_model_id
  rank
  target_modules
  weights_ref
  fisher_diag_ref
  source_skill_id
```

LoRA adapter 只负责增强默认策略偏置和多步程序性模式，不替代 skill spec。

### 11.5 程序记忆的正式闭环

程序记忆必须形成以下闭环：

Episode  
-> RewardSignal  
-> SkillSpec 更新  
-> Policy 选择  
-> Skill 执行  
-> Observation  
-> 新 Episode

如果某个能力无法进入这条闭环，就不应被定义为程序记忆核心能力。

---

## 12. Memory Gate 与 Recall Bundle

### 12.1 Memory Gate 职责

每轮记忆检索前必须先经过 `Memory Gate`。

它负责：

- 是否需要记忆
- 需要哪一层
- top-k 预算
- token 预算
- freshness 要求
- 是否要求客观证据
- 是否要求因果链
- 缺失时是否应 abstain

### 12.2 数据结构

```text
MemoryRetrievalPlan
  should_retrieve
  target_layers
  top_k_budget
  token_budget
  freshness_requirement
  need_objective_evidence
  need_causal_path
  abstain_if_missing
```

### 12.3 Progressive Disclosure

检索必须按以下阶段展开：

1. 摘要层
   - semantic cards
   - skill specs
   - memory summaries
2. 经验层
   - top-k episode digests
3. 证据层
   - evidence / artifacts
4. 参数层
   - soft prompt / LoRA

只有上一层不足以支持当前任务时，才进入下一层。

### 12.4 Recall Bundle

```text
MemoryRecallBundle
  summary_items
  episode_items
  evidence_items
  skill_items
  semantic_items
  parametric_activations
  confidence
  staleness_flags
```

记忆系统对 Workspace、Meta、Reasoner 的标准输出必须是 Recall Bundle，而不是若干不统一的 provider 返回值。

---

## 13. 并行执行与主路径约束

### 13.1 并行原则

记忆 proposal 与主推理并行执行。

标准流程：

```text
输入
  -> Runtime state update
  -> Memory Gate
  -> [并行] 主推理
  -> [并行] 记忆检索 / 记忆增益层
  -> Workspace competition
  -> 输出
```

### 13.2 约束

- 主推理不得等待记忆 proposal 才能继续
- 记忆 proposal 超时后必须可独立降级
- 记忆 proposal 的评分重点是：
  - relevance
  - information gain
  - evidence quality
  - freshness
  - confidence

记忆 proposal 的价值不在于“推理更强”，而在于“提供主模型本来没有的经验、证据和偏置”。

---

## 14. 写入、激活与巩固

### 14.1 写入分类

写入分三类：

1. `always-write`
   - action / observation 原子事实
2. `salient-write`
   - 高风险、高 reward、强失败、用户显式纠正
3. `compact-write`
   - session / plan / reflection 摘要

### 14.2 激活痕迹

每个 episode 至少维护：

- `total_activations`
- `co_activation_map`
- `activation_contexts`
- `last_activation`
- `consolidation_pressure`
- `activation_outcome_alignment`
- `evidence_hit_rate`
- `staleness_incidents`

### 14.3 巩固顺序

正式巩固顺序如下：

1. episode 群组形成
2. 先生成 semantic card 或 skill spec
3. 在线评估 card/spec 是否带来真实增益
4. 达到阈值后再训练 soft prompt 或 LoRA

任何参数化训练都不得绕过 card/spec 直接发生。

### 14.4 相变方向判定

当一组 episode 的 `consolidation_pressure` 越过阈值时，按以下规则决定目标层：

- `strategy_consistency` 高，且结果以成功为主
  - 生成程序记忆
- `strategy_consistency` 高，但结果混合或以失败为主
  - 生成语义记忆
- context 相似但策略不稳定
  - 暂不相变，继续保留在 episodic 层

程序记忆的门槛必须高于语义记忆。

### 14.5 为什么这么定义

这样做的收益是：

- 可审查
- 可回滚
- 可比较训练收益
- 可接入 skill / meta / console
- 可支持删除传播

---

## 15. 训练与调度

### 15.1 总原则

训练和巩固是后台增强，不是主路径前提。

### 15.2 调度约束

- 推理优先
- 训练不阻塞认知主循环
- 训练优先在 idle / maintenance window 执行
- 在线训练仅限轻量更新
- 参数训练失败不影响事实真相层

### 15.3 参数化扩展的进入条件

只有在以下条件成立时，才允许启用 parametric extension：

- retrieval discipline 已稳定
- SQL truth layer 已稳定
- delete / rollback / suspect 传播已稳定
- evaluation 能证明参数层带来明确增益

如果上述条件不满足，系统应只运行符号化主链。

---

## 16. 删除、回滚与治理

### 16.1 物理治理动作

系统必须支持：

- archive
- retention cleanup
- delete request
- tenant wipe
- contaminated memory rollback

### 16.2 删除传播

当 episode 被 `tombstoned` 时，必须执行：

1. 标记所有派生 semantic/procedural 对象受影响
2. 将其状态改为 `suspect`
3. 下次加载前强制重新验证
4. 必要时停用 parametric unit 或重训

### 16.3 不能省略的治理语义

如果某种记忆表示不能被 tombstone、suspect、rollback 这三种语义覆盖，它就不能进入核心主链。

---

## 17. 集成要求

### 17.1 与 Global Workspace

记忆系统必须输出以下 proposal 类型：

- `memory_recall`
- `semantic_bias`
- `skill_match`
- `memory_warning`

### 17.2 与 Meta / Prefrontal

Meta 必须消费：

- retrieval coverage
- staleness flags
- evidence freshness
- memory confidence
- causal completeness

Meta 至少可触发：

- `request_more_memory`
- `require_objective_evidence`
- `suppress_stale_memory`
- `abstain_due_to_memory_gap`

### 17.3 与 Skill RL

记忆系统必须兼容：

- Reward 回写 episode / skill spec
- Policy 选择程序记忆
- Transfer / replay / evaluation

### 17.4 与 Autonomy

以下轨迹必须进入 episodic 层，而不能只留在 trace：

- agenda 变化
- 自生成目标
- 恢复动作
- failure / recovery pattern
- reflection summary

### 17.5 与 Console

Console 必须可直接展示：

- retrieval plan
- recall bundle
- episode activation trace
- semantic cards
- skill specs
- suspect / tombstone / archived 状态
- parametric provenance

否则系统不可运营。

---

## 18. 评测规格

### 18.1 评测分层

评测必须覆盖四层：

1. Retrieval
   - LongMemEval
   - NeuroCore session / turn retrieval
2. Causality / Objective Trace
   - AMA-Bench 风格问题
   - tool artifact 问题
3. Task Utility
   - 成功率
   - 人工纠正率
   - token / cycle 节省
4. Governance
   - delete correctness
   - stale memory suppression
   - suspect rollback

### 18.2 正式基准主线

LongMemEval 是 retrieval 基准主线。

评测顺序必须是：

1. 先稳定 retrieval benchmark
2. 再做 retrieval -> answer generation
3. 再接入外部 judge 的 QA correctness

### 18.3 官方桥接要求

系统必须保留以下桥接能力：

- official retrieval log 导出
- official hypothesis `jsonl` 导出
- official evaluator wrapper

原因：内部回归、外部复现、公开 benchmark 口径必须一致。

### 18.4 指标

| 类别 | 指标 |
|---|---|
| Recall | recall@k, MRR, evidence hit rate |
| Utility | task success delta, human correction delta, token saved |
| Quality | staleness rate, contradiction rate, abstention correctness |
| Governance | delete propagation accuracy, suspect rollback latency |

---

## 19. 实施顺序

### Phase A：固化 Episodic 真相层

目标：

- 完整 episode schema
- SQL persistence
- evidence / artifact / causal 字段闭环
- Runtime / Durable 边界稳定

### Phase B：Memory Gate 与 Progressive Disclosure

目标：

- 预算化检索
- Recall Bundle 标准化
- Meta / Workspace 消费闭环

### Phase C：Semantic / Procedural 正式对象化

目标：

- semantic card 成为正式对象
- skill spec 成为正式对象
- 与 RL / Console / Governance 接线

### Phase D：可选参数增益层

目标：

- soft prompt / LoRA 绑定到正式对象
- provenance、suspect、停用、重训链路打通

### Phase E：未来实验项

仅在前四阶段稳定后，才考虑：

- transient adaptation
- KV cache persistence
- 更复杂的训练系统
- 更激进的小模型记忆体方案

---

## 20. 最终结论

NeuroCore 下一代记忆系统的正式架构，不是“更大的 RAG”，也不是“让小模型记住一切”，而是：

- 用 Runtime State 保证当前认知连续性
- 用 Episodic SQL 真相层保证长期事实、证据与治理
- 用 Semantic Card 和 Skill Spec 承担正式抽象层
- 用 Memory Gate 和 Progressive Disclosure 控制成本
- 用 Workspace / Meta / RL / Autonomy 形成完整闭环
- 在此基础上，才允许引入可选参数增益层

这是一条可落地、可治理、可回滚、可评测的记忆架构主线。
