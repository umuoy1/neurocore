# NeuroCore 五层记忆系统——需求、设计与架构

> 版本：1.0 | 日期：2026-04-01
> 状态：收敛稿，基于头脑风暴、外部评审反馈和迁移分析的综合产出。
> 排期：当前阶段完成个人助理与 Console 相关准备后，作为下一阶段主线进入验证与迁移设计。

---

## 目录

1. [需求](#1-需求)
   - 1.1 问题陈述
   - 1.2 功能需求
   - 1.3 非功能需求
   - 1.4 约束与假设
2. [设计](#2-设计)
   - 2.1 五层记忆总览
   - 2.2 各层详细设计
   - 2.3 记忆跃迁：自然相变
   - 2.4 设计原则
3. [架构](#3-架构)
   - 3.1 系统架构总图
   - 3.2 六大技术组件
   - 3.3 端到端认知循环
   - 3.4 资源与性能预算
4. [迁移方案](#4-迁移方案)
   - 4.1 现有资产评估
   - 4.2 六阶段迁移计划
5. [验证计划](#5-验证计划)
   - 5.1 P0：决定架构是否成立
   - 5.2 P1：决定各层技术选择
6. [风险与缓解](#6-风险与缓解)
7. [附录](#7-附录)

---

## 1. 需求

### 1.1 问题陈述

当前 NeuroCore 的四层记忆系统（工作记忆、情景记忆、语义记忆、程序记忆）在实现上仍然是**压缩文本 + 程式化索引**——

- 工作记忆 = 内存 Map，无容量压力，无竞争淘汰
- 情景记忆 = 按 session 分桶的 Episode 数组，无向量检索，无激活追踪
- 语义记忆 = 基于字符串匹配的 pattern 计数器，无泛化能力
- 程序记忆 = 出现次数 ≥ 3 即升级的固定规则，无行为模式学习

这些实现与认知科学中的记忆机制存在本质差距：没有向量语义检索、没有自然遗忘、没有激活竞争、没有从情景经验到行为技能的真正泛化。

**目标**：设计一套真正对齐神经科学的记忆系统，利用 LLM 领域的前沿技术（LoRA、Soft Prompt、向量检索、kNN-LM 插值），让 Agent 的记忆具备：

1. **语义检索** — 基于含义而非关键词匹配
2. **自然遗忘** — 不用的记忆自然消退，重要记忆自然巩固
3. **模式凝结** — 重复经验自然相变为行为倾向和自动化技能
4. **经验复用** — 历史经验直接影响当前推理，而非仅提供文本参考

### 1.2 功能需求

| 编号 | 需求 | 层级 |
|------|------|------|
| MR-01 | 工作记忆维持结构化当前状态，每 cycle 重写，2~4K tokens 容量限制 | 工作记忆 |
| MR-02 | 情景记忆支持向量语义检索 + 结构化过滤的混合查询 | 情景记忆 |
| MR-03 | 每次检索自动更新被检索 episode 的激活痕迹（activation_trace） | 情景记忆 |
| MR-04 | 共激活 episode 之间的关联强度自动增长（co_activation_map） | 情景记忆 |
| MR-05 | consolidation_pressure 从激活痕迹自然涌现，无外部调度器 | 情景记忆 |
| MR-06 | 未被激活的 episode 通过正反馈循环自然衰减（自然遗忘） | 情景记忆 |
| MR-07 | 高 valence episode（\|v\| > 0.8）衰减速率更低 | 情景记忆 |
| MR-08 | consolidation_pressure 越过阈值时，依据 episode 群组特征自然决定相变方向 | 跃迁 |
| MR-09 | 语义记忆编码行为倾向（Soft Prompt），不存储事实知识 | 语义记忆 |
| MR-10 | 运行时选择性加载 Soft Prompt，影响推理输出分布 | 语义记忆 |
| MR-11 | 程序记忆以 LoRA Adapter 形态编码自动化技能 | 程序记忆 |
| MR-12 | Router 动态路由当前 context 到合适的 LoRA Adapter | 程序记忆 |
| MR-13 | 记忆 proposal 与主推理并行生成，在 Global Workspace 竞争 | 架构 |
| MR-14 | 记忆 proposal 超时未就绪时主推理独立参与竞争 | 架构 |
| MR-15 | [可选] 瞬时适应层通过 micro-LoRA 提供临时参数偏移 | 瞬时适应 |

### 1.3 非功能需求

| 编号 | 需求 | 指标 |
|------|------|------|
| NR-01 | 情景记忆检索延迟（万级 episode） | < 10ms |
| NR-02 | Embedding 计算延迟（单条） | < 10ms |
| NR-03 | Prefix Tuning 训练耗时（30 步） | < 30s |
| NR-04 | LoRA 训练耗时（250 步） | < 5min |
| NR-05 | 记忆 proposal 生成超时上限 | 可配置，默认与主推理时间对齐 |
| NR-06 | 1 年存储增长（50 次/天） | < 1GB |
| NR-07 | 记忆系统不阻塞认知循环主路径 | 异步/并行 |
| NR-08 | 训练任务不阻塞推理 | 后台执行，推理优先 |

### 1.4 约束与假设

**约束**：
- 端侧部署，无微服务依赖（无 Redis、无 Kafka）
- 目标硬件：Apple Silicon 32GB+ 或消费级 GPU（RTX 3090 级）
- 现有 MemoryProvider SPI 接口保持兼容

**假设**（需验证）：
- 7B 记忆基座模型的 proposal 在 Global Workspace 中具有竞争力（P0 验证）
- Soft Prompt 能有效编码行为倾向且优于 RAG（P1 验证）
- micro-LoRA 2~5 步梯度下降优于 In-Context Learning（P1 验证）

---

## 2. 设计

### 2.1 五层记忆总览

```
层级      │ 载体          │ 大小      │ 生命周期     │ 解决的问题
─────────┼──────────────┼──────────┼────────────┼─────────────────
瞬时适应  │ micro-LoRA   │ ~KB      │ 单次推理    │ 当前困境的临时应对 [可选层]
工作记忆  │ 结构化对象    │ 2~4K tok │ session    │ 当前在做什么
情景记忆  │ SQLite+Vec   │ ~KB/条   │ 周~月      │ 具体发生过什么
语义记忆  │ Soft Prompt  │ ~10~50KB │ 月~永久    │ 泛化的行为倾向
程序记忆  │ LoRA Adapter │ ~10~100MB│ 长期       │ 自动化的技能和行为
─────────┴──────────────┴──────────┴────────────┴─────────────────
         越往下：越抽象、越持久、越大、更新越慢、越不可解释
         越往上：越具体、越短暂、越小、更新越快、越可解释
```

**生物学映射**：

| 记忆层 | 生物对应 | 核心特征 |
|--------|----------|----------|
| 瞬时适应 | 突触短时程增强（STP） | 几秒到几分钟的临时性突触增强 |
| 工作记忆 | 前额叶工作记忆 | 容量有限（7±2 chunks），持续更新 |
| 情景记忆 | 海马体情景记忆 | 具体事件，带时间标记和情感色彩 |
| 语义记忆 | 大脑皮层语义记忆 | 从多次情景中缓慢提取的抽象规律 |
| 程序记忆 | 基底神经节/小脑 | 高度自动化技能，不经过意识 |

### 2.2 各层详细设计

---

#### 第一层：瞬时适应（Transient Adaptation）[可选层]

> **设计状态**：工程成本最高（需推理引擎支持反向传播），需实验验证 micro-adapter 相比 ICL 的增益。如 ICL 达到 80% 效果，此层降级为未来探索方向。

**解决什么问题**：Agent 在一个 cycle 内遇到陌生情境，context 和 RAG 都缺乏信息，需要**现在**做出合理决策。

**存储内容**：临时参数偏移（micro-LoRA adapter, r=1~2），编码对当前情境的临时理解调整。

**存储方式**：
```
载体：micro-LoRA adapter，r=1~2，仅作用于 q_proj/v_proj
大小：~几KB
生命周期：单次任务 / 单个 session，用完丢弃
训练：推理时 2~5 步梯度下降，当前 cycle 的 observation 作为训练信号
持久化：不持久化
```

**层间关系**：
- 上游输入：工作记忆中当前 cycle 的困难
- 下游影响：直接修改当前推理的输出分布
- 向下巩固：同一类瞬时适应反复出现 → 产生的 episode 积累共激活压力 → 最终自然相变

---

#### 第二层：工作记忆（Working Memory）

**解决什么问题**：Agent 需要"记住当前在做什么"——经过压缩的、面向决策的当前状态摘要。

**存储内容**：
```
WorkingMemoryState:
  current_goal        — 当前任务目标（单句）
  decision_chain      — 已做决策的因果链（A→B→C）
  active_observations — 最近 N 个 cycle 的关键 observation
  pending_questions   — 尚未解决的不确定性
  emotional_state     — 当前的风险/信心评估（来自 Amygdala）
  strategy_preference — 当前倾向的策略方向
```

**存储方式**：
```
载体：结构化对象，序列化后注入 Context Window
大小：控制在 2K~4K tokens
生命周期：session 级
更新策略：每个 cycle 结束时重写（非追加）——容量限制强制只保留最相关信息
可选增强：持久化压缩后的 KV Cache heavy hitters，下次 session 可预热
```

**层间关系**：
- 自身更新：每 cycle 的 observation 更新当前状态
- 向下巩固：session 结束时有价值片段写入情景记忆
- 向上提取：向情景记忆发起检索，结果加载进 active_observations

---

#### 第三层：情景记忆（Episodic Memory）

**解决什么问题**：Agent 需要回忆**具体发生过的事**——可寻址、可叙述的记忆。

**数据结构**：
```
Episode:
  episode_id          — 唯一标识
  timestamp           — 发生时间
  tenant_id           — 所属租户/用户
  session_id          — 所属会话

  // 情境
  trigger_summary     — 触发事件的摘要
  context_digest      — 当时的上下文状态快照（保留原始文本，支持重新向量化）
  context_embedding   — context 的向量表示
  goal_refs           — 关联的目标

  // 决策
  selected_strategy   — 选择的策略
  tool_name           — 使用的工具
  action_params       — 具体动作参数

  // 结果
  outcome             — success / failure / partial
  valence             — 情感评价（-1.0 ~ +1.0）
  lessons             — 提取的经验教训

  // 激活痕迹（记忆自身的生命体征）
  activation_trace:
    total_activations   — 被检索/共激活的总次数
    co_activation_map   — { episode_id → 共激活次数 }
    activation_contexts — 最近 N 次被激活时的 query embedding
    last_activation     — 上次被激活的时间

  // 巩固压力（从 activation_trace 自然涌现）
  consolidation_pressure — float
```

**存储方式**：
```
载体：SQLite + sqlite-vec 向量扩展
     结构化字段存 SQLite 表，context_embedding 存向量索引
大小：每条 ~1~5KB 结构化 + ~3KB 向量（768d float32）
容量：无硬上限，由自然遗忘机制管理

检索方式：
  - 向量相似度（语义相关性）
  - 结构化过滤（时间范围、outcome、tool_name）
  - 混合排序：relevance × activation_recency × valence_weight

关键索引：
  - (tenant_id, timestamp)        — 时间线查询
  - (tenant_id, tool_name)        — 按工具类型聚合
  - 向量索引 on context_embedding — 语义检索
```

**检索的副作用（核心驱动力）**：
```
每次检索不是无痕的"只读"操作，而是会改变记忆自身的状态：
  - 被命中的 episode：activation_trace 更新
  - 被共同命中的 episode 之间：co_activation_map 互相增强
  - consolidation_pressure 重新计算
  - 如果 pressure 越过相变阈值 → 跃迁在此刻自然发生
```

**自然遗忘**：
```
不设 TTL 扫描器。遗忘是激活竞争的结果——
  - 长期未被激活 → activation_trace 自然衰减
  - 衰减后在检索排序中下沉 → 更难被命中
  - 更难命中 → 进一步衰减（正反馈）
  - 最终认知层面"死亡"，物理清理只是善后
  - 高 valence（|v| > 0.8）episode 衰减速率更低
```

**层间关系**：
- 上游输入：工作记忆在 session 结束时写入；显著 cycle（|valence| > 0.6）立即写入
- 被上层检索：工作记忆发起 query → 返回 episode → 检索行为本身更新激活痕迹
- 向下相变：在正常检索中自然发生（见 2.3 跃迁机制）

---

#### 第四层：语义记忆（Semantic Memory）

**解决什么问题**：Agent 需要泛化的**行为倾向**，不需要回忆具体经历。

> **边界澄清**：语义记忆只存行为倾向，不存知识。
> - "Python 列表推导比 for 循环快" → 事实 → 留在情景记忆
> - "遇到循环性能问题倾向于先尝试列表推导" → 倾向 → 语义记忆
> Soft Prompt 的信息容量（4~16 tokens）恰好匹配行为倾向的抽象度。

**数据结构**：
```
SemanticMemoryUnit:
  unit_id             — 唯一标识
  label               — 人类可读描述（如 "user_prefers_concise_style"）
  soft_tokens         — 学习到的连续向量 (n_tokens, hidden_dim), n_tokens = 4~16
  source_episodes     — 蒸馏来源 episode_id 列表
  source_count        — 来源 episode 数量
  domain_tags         — 关联的领域标签
  activation_score    — 累计激活得分
  last_activated      — 最后激活时间
  confidence          — 置信度（来源越多越高）
```

**存储方式**：
```
载体：文件系统
     soft_tokens → .pt tensor 文件
     元数据 → .json

目录结构：
  memory_store/semantic/
  ├── index.json
  ├── user_concise_style/
  │   ├── tokens.pt (~几KB)
  │   └── meta.json
  └── ...

大小：每个 unit ~10~50KB
容量：百级
训练：Prefix Tuning，冻结基座，只训练 soft token 向量值
运行时：激活的 soft prompts prepend 到模型输入，可同时激活 3~5 个
效用衰减：activation_score 随时间指数衰减，低于阈值不再参与匹配
```

---

#### 第五层：程序记忆（Procedural Memory）

**解决什么问题**：Agent 在特定场景下**自动化地**做出正确行为——行为本能。

**数据结构**：
```
ProceduralMemoryUnit:
  adapter_id          — 唯一标识
  adapter_name        — 人类可读名（如 "python_debugging"）

  // LoRA 参数
  lora_weights        — LoRA A/B 矩阵集合
  rank                — 秩（4~32，随成熟度增长）
  target_modules      — 作用的模型层
  alpha               — 缩放因子

  // 来源追溯
  source_episodes     — 蒸馏来源 episode_id 列表
  source_semantics    — 升级来源 semantic unit_id 列表
  episode_count       — 累计训练 episode 数量

  // 路由元数据
  domain_tags         — 领域标签
  trigger_conditions  — 激活条件描述
  applicability       — 适用边界描述

  // 效用追踪
  activation_count    — 被路由器激活的总次数
  success_rate        — 激活后任务成功率
  last_activated      — 最后被激活时间
  ewc_fisher_diag     — Fisher 信息对角线（保护重要参数）
```

**存储方式**：
```
载体：文件系统，兼容 HuggingFace PEFT 格式

目录结构：
  memory_store/procedural/
  ├── registry.json
  ├── python_debugging/
  │   ├── adapter_config.json
  │   ├── adapter_model.safetensors (~10~100MB)
  │   ├── meta.json
  │   └── fisher_diag.pt
  └── ...

大小：每个 adapter 10~100MB
容量：十级（10~30 个活跃 adapter）
训练：标准 LoRA/QLoRA 微调 + EWC 正则化
运行时：Router 判断激活哪些 adapter → set_adapter() 或 weighted merge
```

**Router 架构**：
```
第一级：domain_tags 粗筛（规则匹配，零成本）
第二级：context embedding vs adapter embedding 余弦相似度排序
第三级：[可选] Router 自身也是 LoRA adapter，从历史路由决策中学习
```

**效用管理**：
```
- success_rate 每次激活后追踪，低成功率 → 路由权重下降
- 长期不被激活 → 在竞争中被排挤
- EWC fisher_diag 随时间衰减 → 允许旧权重被新训练覆盖
```

---

### 2.3 记忆跃迁：自然相变而非程式化升级

#### 核心理念

记忆系统没有"管理者"。没有站在记忆之外的控制器在扫描、判定、升级。每条记忆通过自身的激活历史决定自己的命运——被反复激活的自然巩固，被忽视的自然消退。宏观行为从微观激活动力学中涌现。

#### 跃迁全景

```
瞬时适应 ──①──→ 工作记忆 ──②──→ 情景记忆 ──③──→ 语义记忆 ──④──→ 程序记忆
                   ↑                  │                           │
                   └────⑤─────────────┘         ──────⑥──────────┘
                      向上提取                      直接相变

                每层内部还有 ⑦ 自然衰减（遗忘）
```

| 路径 | 方向 | 触发机制 | 时间尺度 |
|------|------|----------|----------|
| ① | 瞬时适应 → 工作记忆 | adapter 消失，催化结果留在 decision_chain | 毫秒~秒 |
| ② | 工作记忆 → 情景记忆 | session 结束批量写入；显著 cycle 立即写入 | 分钟~小时 |
| ③ | 情景记忆 → 语义记忆 | 共激活压力越过阈值，模式凝结为 Soft Prompt | 天~周 |
| ④ | 语义记忆 → 程序记忆 | Soft Prompt 表达能力瓶颈 + 持续高频激活 | 周~月 |
| ⑤ | 情景记忆 → 工作记忆 | 工作记忆发起检索，摘要加载进 active_observations | 分钟 |
| ⑥ | 情景记忆 → 程序记忆 | 极高共激活压力（高频+高一致性+跨多 session）直接相变 | 天~周 |
| ⑦ | 各层内部 | 激活竞争的自然结果，各层衰减机制不同 | 持续 |

#### consolidation_pressure 动力学

```
每次被激活：pressure += α × relevance_of_this_activation
每次时间流逝：pressure *= e^(-λΔt)

pressure 在两种力的拉扯下动态变化：
├── 频繁激活 → pressure 持续上升
├── 长期沉默 → pressure 自然回落
└── 不需要任何外部调度器
```

#### 相变方向的自然决策

当 consolidation_pressure 越过临界点时，相变方向由 episode 群组自身特征决定：

```
共激活 episode 群组的特征分析：
    │
    ├── strategy_consistency 高 + outcome 以 success 为主
    │   → 行为模式 → 相变为程序记忆（LoRA）
    │
    ├── strategy_consistency 高 + outcome 混合或以 failure 为主
    │   → 行为倾向/偏好 → 相变为语义记忆（Soft Prompt）
    │   （负面倾向也是倾向："遇到 X 要避免 Y"）
    │
    └── strategy_consistency 低 + context 相似度高
        → 还在探索，模式不稳定 → 暂不相变，继续积累
```

直接相变为 LoRA 的条件更严格：需要行为一致性和结果一致性都高。Soft Prompt 门槛更低：只需行为倾向一致。这和生物系统一致——习惯比认知需要更多重复。

#### 各层衰减机制

```
瞬时适应：天然短命，用完即丢
工作记忆：容量限制 = 自然淘汰，新 observation 挤掉旧的
情景记忆：激活竞争正反馈 → 认知"死亡" → 物理清理善后
语义记忆：activation_score × e^(-λΔt) → 低于阈值不可见
程序记忆：success_rate 追踪 + EWC fisher_diag 衰减 → 自然被排挤
```

### 2.4 设计原则

**原则一：记忆形态随成熟度流动**

```
原始 episode → soft prompt → LoRA adapter → [模型权重]
 (具体)        (半泛化)      (领域技能)     (深层直觉)
 (大)          (几百字节)    (几十 MB)      (不可分离)
 (可删除)      (可删除)      (可插拔)       (永久)
```

不是所有记忆都要走到终点。大部分停留在 episode 层就够了。

**原则二：检索不是查询，是激活**

当前 context 是激活模式，自动激活相关的 adapter、soft prompt 和 episode。不同记忆形态的激活是并行的、竞争的、互相增强的。

**原则三：遗忘是激活竞争的自然结果**

不设 TTL 扫描器，不设容量上限。重要记忆因频繁激活而巩固，不重要的在竞争中自然下沉。

**原则四：运行即巩固，没有独立的巩固过程**

巩固不是定时后台任务，而是每次检索、每次激活的自然副作用。回忆即巩固。共同回忆即提取共性。共性积累到临界点，相变自然发生。

---

## 3. 架构

### 3.1 系统架构总图

```
用户输入
    │
    ├──────────────────────┬───────────────────────┐
    ▼                      ▼                       ▼
 主推理模型             记忆基座推理            情景记忆 RAG
 (API / 大模型)        (端侧 7~8B 小模型       (SQLite+Vec
  ~1-5s               + soft prompt             检索)
                      + LoRA adapter)
                       ~5-20s
    │                      │                       │
    ▼                      ▼                       ▼
 ┌──────────────────────────────────────────────────┐
 │            Global Workspace Competition           │
 │                                                   │
 │  评分维度：                                        │
 │  ├── 推理质量（主推理模型天然占优）                   │
 │  ├── 信息增益（记忆 proposal 提供主模型缺失的经验）   │
 │  └── 经验相关性（RAG 提供具体历史细节）              │
 │                                                   │
 │  记忆 proposal 的价值不在于"推理更好"               │
 │  而在于"提供了主模型没有的信息"                      │
 └──────────────────────────────────────────────────┘
          │
          ▼
    输出 / Action
          │
          ▼
  ┌───────────────┐
  │ Episode 写入   │ ←── 显著 cycle 立即写入
  │ 激活痕迹更新   │ ←── 检索的副作用
  │ 相变检测       │ ←── pressure 越过阈值时自然发生
  └───────┬───────┘
          │ (异步)
          ▼
  ┌───────────────┐
  │ 异步训练调度   │ ←── Soft Prompt / LoRA 训练
  │ (后台 worker)  │     推理优先，训练"尽力而为"
  └───────────────┘
```

### 3.2 六大技术组件

#### 组件 1：端侧小模型（记忆基座）

```
模型：Qwen2.5-7B / Llama-3-8B（或同级模型）
定位：不是主推理模型，而是记忆的物理载体
推理精度：QLoRA 方式——4-bit 基座 + BF16 LoRA 参数
         显存占用 ~6GB，兼顾推理和训练
训练精度：BF16 LoRA 参数
```

#### 组件 2：推理引擎

```
选型：PyTorch + PEFT（统一引擎，简单性优先）
     如目标平台确定为 Apple Silicon → 可考虑 MLX

必须支持：
  - LoRA 热切换（set_adapter / weighted merge）
  - Soft Prompt 注入（prepend soft tokens）
  - 反向传播（如启用瞬时适应层）
  - 同一进程内训练和推理共存
```

#### 组件 3：向量化管线

```
Embedding 模型：BGE-base (109M, 768d) + ONNX Runtime
              单条 < 10ms，ONNX 量化后 ~110MB 内存
向量存储：sqlite-vec（与 SQLite 共用，零额外依赖）
         万级 episode 检索 < 10ms
         十万级需考虑归档或迁移至 HNSW
版本追踪：记录 embedding 模型版本，保留原始文本支持重新向量化
```

#### 组件 4：PEFT 训练管线

三档训练模式，对应不同记忆层的相变需求：

| 模式 | 层级 | 参数 | 步数 | 耗时 | 数据 |
|------|------|------|------|------|------|
| A. Micro-adapter | 瞬时适应 [可选] | r=1~2, q_proj/v_proj | 2~5 | < 1s | 当前 cycle 1~2 条 |
| B. Prefix Tuning | 语义记忆 | 4~16 soft tokens | ~30 | < 30s | 共激活 episode 3~10 条 |
| C. LoRA/QLoRA | 程序记忆 | r=4~16, attention 全层 | 3~5 epochs | < 5min | 来源 episode 5~50 条 |

EWC 正则化应用于 C 模式，保护已有重要参数不被后续训练覆盖。

训练数据质量控制：
- 只用 outcome 为正面的 episode 训练程序记忆
- 训练后在验证集上自动评估
- 新 LoRA 质量差于旧的则不替换

#### 组件 5：激活痕迹引擎

嵌入检索路径的副作用系统，不是独立进程：

```
检索命中 episode
    │
    ├── 更新 activation_trace（total_activations, last_activation）
    ├── 更新共命中 episode 间的 co_activation_map
    ├── 重算 consolidation_pressure
    │       pressure = w1 × norm(activation_frequency)
    │                + w2 × strategy_consistency
    │                + w3 × outcome_consistency
    │                + w4 × log(temporal_span + 1)
    │
    └── if pressure > θ → 分析群组特征 → 触发异步训练
```

θ 初始设为 0.7，后续根据实际效果调整。各维度权重通过实验确定。

#### 组件 6：异步训练调度

```
实现：内存队列 + worker 线程
设计哲学："尽力而为"——类比生物系统的睡眠巩固
约束：
  - 单任务串行（避免 GPU 争用）
  - 推理优先（推理请求到来时暂停训练）
  - 训练状态持久化到 SQLite（支持中断恢复）
  - 失败重试（有限次数）
```

资源分配策略：
```
方案A（推荐）：延迟训练
  → 训练推迟到用户不活跃时执行
  → 最接近生物"睡眠巩固"

方案B：时间分片
  → 推理请求优先
  → 推理间隙执行训练（保存 optimizer 状态）

方案C：降级训练
  → 更激进量化（4-bit）
  → batch size = 1
```

### 3.3 端到端认知循环

```
步骤                                             延迟
──────────────────────────────────────────────  ──────
1. 接收用户输入                                   ~0ms
2. Embedding 计算（BGE-base via ONNX）            ~10ms
3. 向量检索（sqlite-vec，万级）                    ~5ms
4. 激活痕迹更新 + pressure 计算                    ~1ms
5. 工作记忆状态构造                                ~1ms
6. [并行启动] 主推理模型 (API)                    ~1-5s
7. [并行启动] 记忆基座推理                        ~5-20s
   ├── Prefix/LoRA 加载                          ~100-500ms
   ├── [可选] Micro-adapter 训练                  ~600-1500ms
   └── Proposal 生成                             ~5-15s
8. Global Workspace 竞争                          ~依赖 6/7
   ├── 主推理就绪 → 记忆未就绪 → 主推理独立参与
   └── 两者都就绪 → 按评分维度竞争
9. 输出 / Action 执行
10. Episode 写入 + 激活痕迹副作用                  ~异步
```

主路径延迟（不含记忆基座推理）：步骤 2~6 ≈ **1~5 秒**，与当前系统一致。
记忆增强路径：额外 5~20 秒，但异步并行不阻塞主路径。

### 3.4 资源与性能预算

**内存/显存**：

| 组件 | 占用 |
|------|------|
| 记忆基座 7B (4-bit + BF16 LoRA) | ~6GB |
| BGE-base Embedding (ONNX) | ~110MB |
| SQLite + sqlite-vec（万级 episode） | ~90MB |
| 活跃 LoRA adapters (缓存 3~5 个) | ~150~500MB |
| 总计 | ~7~8GB |

**存储（1 年 × 50 次/天）**：

| 类别 | 大小 |
|------|------|
| Episode 结构化数据 + 向量 | ~90MB |
| Co-activation 表（稀疏） | ~5MB |
| Semantic units (~100 个) | ~20MB |
| LoRA adapters (~20 个) | ~600MB |
| **总计** | **~715MB** |

---

## 4. 迁移方案

### 4.1 现有资产评估

**可完全复用**：
- MemoryProvider SPI 接口（retrieve / getDigest / writeEpisode / consolidate）
- Episode 类型定义（需扩展 activation_trace 和 consolidation_pressure 字段）
- CycleEngine 的 collectMemoryState 并行调用模式
- AgentRuntime 的 provider 注册机制

**需重写**：
- 所有四个 Provider 的实现（底层存储从内存 Map → SQLite+Vec / 文件系统）
- Episode 构造逻辑（增加 embedding 计算和激活痕迹初始化）

**新增**：
- 向量化管线（BGE + ONNX + sqlite-vec）
- 激活痕迹引擎
- 异步训练调度器
- PEFT 训练管线（Python 进程，通过 IPC 与 TypeScript 运行时通信）
- 记忆基座推理服务

### 4.2 六阶段迁移计划

```
Phase 0: 情景记忆 SQLite 化                              ~800 行
─────────────────────────────────────────────
  • EpisodicMemoryProvider 重写：内存 Map → SQLite
  • Episode 表 DDL + 基础 CRUD
  • 现有 API 兼容（retrieve / writeEpisode / getDigest）
  • 验收：所有现有测试通过

Phase 1: 向量语义检索                                    ~600 行
─────────────────────────────────────────────
  • 引入 BGE-base + ONNX Runtime
  • sqlite-vec 向量索引
  • 混合检索：向量相似度 × 结构化过滤
  • 验收：语义检索质量优于字符串匹配

Phase 2: 激活痕迹 + 自然遗忘                              ~1200 行
─────────────────────────────────────────────
  • activation_trace / co_activation_map 字段
  • 检索副作用系统
  • consolidation_pressure 计算
  • 自然遗忘（衰减 + 排序下沉）
  • 验收：可观测到 pressure 积累和遗忘行为

  ──────────── Phase 0~2 完成：纯 TypeScript，~2600 行 ────────────
  此时情景记忆已具备向量检索 + 激活追踪 + 自然遗忘
  无需 ML 基础设施，已显著优于当前实现

Phase 3: 记忆基座 + LoRA 程序记忆                         ~2000 行
─────────────────────────────────────────────
  • Python 记忆基座服务（PyTorch + PEFT）
  • TypeScript ↔ Python IPC 通信层
  • ProceduralMemoryProvider 重写：LoRA adapter 管理
  • Router 实现（domain_tags 粗筛 + embedding 排序）
  • 验收：LoRA 加载/切换/推理可用

Phase 4: Soft Prompt 语义记忆 + 相变                      ~1500 行
─────────────────────────────────────────────
  • Prefix Tuning 训练管线
  • SemanticMemoryProvider 重写
  • 相变检测 + 方向决策（strategy/outcome consistency）
  • 异步训练调度器
  • 验收：可观测到 episode → soft prompt 自然相变

Phase 5: 并行 Proposal + Global Workspace 集成            ~1500 行
─────────────────────────────────────────────
  • 记忆基座 proposal 生成
  • 与主推理并行执行
  • Global Workspace 评分（信息增益维度）
  • 超时处理
  • [可选] 瞬时适应层（实验验证后决定）
  • 验收：端到端记忆增强认知循环

  ──────────── Phase 3~5 完成：TypeScript + Python，~5000 行 ───────
  完整五层记忆系统上线
```

---

## 5. 验证计划

### 5.1 P0：决定架构是否成立

在投入 Phase 3+ 之前必须验证：

**实验 1：记忆 proposal 的竞争力**
```
设置：7B + LoRA 的 proposal vs 主推理模型（无记忆）的 proposal
度量：在有历史经验可用的任务中，记忆增强是否带来可度量的决策改善
失败处理：
  → 改变 proposal 形式为"记忆摘要"注入主模型 context（退化为增强 RAG）
  → 或使用更大的记忆基座模型
```

**实验 2：端到端延迟可行性**
```
设置：在目标硬件上完整跑通 记忆检索 → 小模型推理 → proposal 生成
度量：是否在主推理模型完成前生成有效 proposal
失败处理：
  → 更小的记忆基座（3B/1.5B）
  → 降级为"记忆摘要"注入主模型 context
```

### 5.2 P1：决定各层技术选择

在 Phase 3~5 开发中验证：

**实验 3：Soft Prompt vs RAG 承载语义记忆**
```
设置：用 10 条相关 episode 训练 Prefix，对比同信息放入 context
度量：行为倾向的稳定性、跨 session 一致性
失败处理：语义记忆层改用结构化摘要 + RAG
```

**实验 4：瞬时适应 vs ICL**
```
设置：micro-adapter（2 步梯度）vs 直接把 observation 放入 context
度量：任务适应速度和决策质量
失败处理：瞬时适应层从架构中移除
```

**实验 5：相变训练硬件耗时**
```
设置：Prefix Tuning（30 步）和 LoRA（250 步）在目标硬件实际耗时
度量：是否分别在 30s / 5min 内完成
失败处理：降低 rank、减少步数、或接受延迟训练
```

---

## 6. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | 记忆 proposal 被主推理总是压过 | 记忆系统形同虚设 | GW 评分增加"信息增益"维度；退化为 RAG 增强 |
| R2 | Apple Silicon 上训练超时 | LoRA 相变不可用 | 降低 rank/步数；延迟到空闲时段训练 |
| R3 | Prefix Tuning 无法有效编码行为倾向 | 语义记忆层失效 | 退化为结构化摘要 + RAG |
| R4 | 推理和训练的 GPU 资源竞争 | 推理延迟不可预测 | 推理优先策略；延迟训练（类睡眠巩固） |
| R5 | 基座模型更换导致所有 LoRA/Prefix 失效 | 记忆需全部重训 | 保留原始训练数据（episode）；支持批量重训 |
| R6 | 训练数据含错误行为 | LoRA 学到错误模式 | 只用正面 outcome 训练；训练后自动评估+回滚 |
| R7 | pressure 阈值/权重不合理 | 相变过早或过晚 | 初始保守设定（θ=0.7）；持续观测和调参 |
| R8 | 用户要求"忘记"特定记忆 | LoRA 中的知识无法精确遗忘 | 删除 episode + 标记受污染的 adapter 待重训 |

---

## 7. 附录

### A. 参考资料

| 文档 | 内容 |
|------|------|
| `references/01_llm-technology-brainstorm.md` | LLM 领域技术全景——推理时计算、Agent 架构、持续学习、MoE 等 |
| `references/02_lora-rank-finetuning.md` | LoRA 技术细节——秩选择、PEFT 实现、QLoRA、变体对比 |
| `references/03_lora-agent-memory-system.md` | Agent 记忆系统参考实现——Context + RAG + LoRA 三层方案 |
| `references/03_memory_system_judge.md` | 外部技术评审——8.5/10 评分，关键问题与建议 |

### B. 术语表

| 术语 | 定义 |
|------|------|
| consolidation_pressure | 从 episode 的激活痕迹自然涌现的连续值，衡量该 episode 群组"准备好"相变的程度 |
| co_activation_map | 记录"哪些 episode 被一起回忆过"的稀疏邻接矩阵 |
| 相变 (Phase Transition) | 记忆从一种形态自然转变为另一种形态（如 episode → soft prompt），类比水结冰 |
| 记忆基座 | 端侧 7~8B 小模型，不做主推理，作为 LoRA/Soft Prompt 的物理载体 |
| 自然遗忘 | 通过激活竞争正反馈循环实现的遗忘，非定时扫描 |
| EWC | Elastic Weight Consolidation，通过 Fisher 信息矩阵保护已有重要参数 |

### C. 与现有设计文档的关系

本文档扩展以下需求编号（参见 `docs/04_2026-03-31_next-stage/01_next-stage-overview.md`）：

- 记忆系统演进方向覆盖 Hippocampal 模块的深化需求
- 程序记忆（LoRA）与 FR-44~FR-49（技能自动提炼）存在交叉，LoRA adapter 可替代当前基于规则计数的 skill promotion 机制
- 记忆基座的 proposal 竞争机制与 Global Workspace 设计对齐（`docs/01_2026-03-27_paradigm/03_global-workspace-and-cycle.md`）
