# 五层记忆系统详细设计（Draft）

> 基于头脑风暴讨论的阶段性设计产出，尚未定稿。

---

## 总览

```
层级      │ 载体          │ 大小      │ 生命周期     │ 解决的问题
─────────┼──────────────┼──────────┼────────────┼─────────────────
瞬时适应  │ micro-LoRA   │ ~KB      │ 单次推理    │ 当前困境的临时应对
工作记忆  │ 结构化对象    │ 2~4K tok │ session    │ 当前在做什么
情景记忆  │ SQLite+Vec   │ ~KB/条   │ 周~月      │ 具体发生过什么
语义记忆  │ Soft Prompt  │ ~10~50KB │ 月~永久    │ 泛化的规律和常识
程序记忆  │ LoRA Adapter │ ~10~100MB│ 长期       │ 自动化的技能和行为
─────────┴──────────────┴──────────┴────────────┴─────────────────
         越往下：越抽象、越持久、越大、更新越慢、越不可解释
         越往上：越具体、越短暂、越小、更新越快、越可解释
```

---

## 第一层：瞬时适应（Transient Adaptation）

### 解决什么问题

Agent 在一个 cycle 内遇到了陌生情境——context 里没有足够信息，RAG 检索也没命中相关 episode。但这个任务需要 **现在** 就做出合理决策，不能等到"下次再学会"。

典型场景：用户突然切换到一个 Agent 从未处理过的子领域，或者当前任务的约束条件和历史经验冲突。

对应生物学：**突触短时程增强（STP）**——神经元在高频刺激后几秒到几分钟内的临时性突触增强，不涉及蛋白质合成，不形成长期记忆。

### 存储了什么

不存储"内容"，而是一个 **临时的参数偏移**——一个极小的 micro-adapter（r=1~2，只作用于当前推理）。它编码的是"基于刚刚这几步交互，我对当前情境的临时理解调整"。

具体包含：
- 对当前任务上下文的临时适配（比如用户的表述习惯、领域术语的临时对齐）
- 对当前策略空间的临时偏好（比如刚刚尝试策略 A 失败了，临时抑制 A 方向）

### 如何存储

```
载体：micro-LoRA adapter，r=1~2，仅作用于 q_proj/v_proj
大小：~几KB
生命周期：单次任务 / 单个 session，用完丢弃
训练方式：推理时做 2~5 步梯度下降，用当前 cycle 的
         observation 作为即时训练信号
持久化：不持久化。
         但如果这个瞬时适应被反复触发（说明这个情境
         不是一次性的），由巩固过程将其升级为语义记忆
```

### 层间关系

- 上游输入：来自工作记忆中"当前 cycle 我遇到了什么困难"
- 下游影响：直接修改当前推理的输出分布
- 向下巩固：如果同一类瞬时适应在多个 session 中反复出现 → 信号传递给巩固引擎 → 训练为 soft prompt 或 LoRA

---

## 第二层：工作记忆（Working Memory）

### 解决什么问题

Agent 在一个认知周期内需要"记住当前在做什么"——当前目标是什么、已经执行了哪些步骤、上一步的结果是什么、接下来打算做什么。这不是历史记录的回放，而是一个 **经过压缩的、面向决策的当前状态摘要**。

对应生物学：**前额叶工作记忆**——容量有限（7±2 chunks），但持续更新，是当前认知活动的核心舞台。

### 存储了什么

不是 raw chat history，而是结构化的当前状态：

```
WorkingMemoryState:
  current_goal        — 当前任务目标（单句）
  decision_chain      — 已做决策的因果链（A→B→C）
  active_observations — 最近 N 个 cycle 的关键 observation
  pending_questions   — 尚未解决的不确定性
  emotional_state     — 当前的风险/信心评估（来自 Amygdala）
  strategy_preference — 当前倾向的策略方向
```

### 如何存储

```
载体：结构化对象，序列化后注入 Context Window
大小：控制在 2K~4K tokens 以内
生命周期：session 级，session 结束时：
         - 重要内容降级为 episode 写入情景记忆
         - 状态摘要可选持久化为 session summary

更新策略：每个 cycle 结束时重写，不是追加
         旧状态被新状态覆盖——这就是工作记忆的
         "容量限制"，强制 Agent 只保留最相关的信息

可选增强：持久化压缩后的 KV Cache heavy hitters
         下次 session 可以"预热"，不需要从零开始
         建立上下文理解
```

### 层间关系

- 上游输入：瞬时适应层的结果反馈
- 自身更新：每个 cycle 的 observation 更新当前状态
- 向下巩固：session 结束时，有价值的工作记忆片段写入情景记忆
- 向上提取：当需要具体细节时，向情景记忆发起检索，结果加载进工作记忆

---

## 第三层：情景记忆（Episodic Memory）

### 解决什么问题

Agent 需要回忆 **具体发生过的事**——"上次处理类似任务时用了什么策略"、"三天前用户纠正过我的什么错误"、"上一次这个 API 调用失败的具体原因"。

这是 **可寻址的、可叙述的** 记忆。你能说出"什么时候、什么情境、做了什么、结果如何"。

对应生物学：**海马体的情景记忆**——具体事件的完整记录，带有时间标记、情感色彩和上下文绑定。

### 存储了什么

每条记录是一个完整的 Episode：

```
Episode:
  episode_id          — 唯一标识
  timestamp           — 发生时间
  tenant_id           — 所属租户/用户
  session_id          — 所属会话

  // 情境
  trigger_summary     — 触发事件的摘要
  context_digest      — 当时的上下文状态快照
  goal_refs           — 关联的目标

  // 决策
  selected_strategy   — 选择的策略
  tool_name           — 使用的工具
  action_params       — 具体动作参数

  // 结果
  outcome             — success / failure / partial
  valence             — 情感评价（-1.0 ~ +1.0）
  lessons             — 提取的经验教训

  // 元数据
  consolidation_state — pending / consolidated / archived
  access_count        — 被检索次数（用于效用评估）
  last_accessed       — 最后被检索时间
```

### 如何存储

```
载体：SQLite + sqlite-vec 向量扩展
     结构化字段存 SQLite 表（精确查询）
     context_digest + trigger_summary 的 embedding
     存向量索引（语义检索）

大小：每条 episode ~1~5KB，向量 ~3KB (768d float32)
容量：无硬上限，通过 TTL + 巩固标记管理增长

持久化：写入即持久化
检索方式：
  - 向量相似度（语义相关性）
  - 结构化过滤（时间范围、outcome、tool_name）
  - 混合排序：relevance × recency × valence_weight

关键索引：
  - (tenant_id, timestamp)        — 时间线查询
  - (tenant_id, tool_name)        — 按工具类型聚合
  - (consolidation_state)         — 巩固引擎扫描
  - 向量索引 on context_embedding — 语义检索

TTL 策略：
  - consolidation_state = "consolidated" 的 episode
    保留 30 天后可清理（模式已提取到上层）
  - 高 valence（|v| > 0.8）的 episode
    不受 TTL 约束（创伤/顿悟类记忆长期保留）
  - access_count = 0 超过 14 天的 episode
    标记为低效用，优先清理
```

### 层间关系

- 上游输入：工作记忆在 session 结束时写入 episode
- 被上层检索：工作记忆发起 query → 返回相关 episode
- 向下巩固：巩固引擎定期扫描 pending episode：
  - 相似 episode 出现 2~3 次 → 提取模式 → 训练 soft prompt → 标记为 consolidated
  - 相似 episode 出现 5+ 次 → 训练 LoRA adapter → 标记为 consolidated
- 不向下巩固：高 valence 单次事件保持原样（需要保留细节的记忆）

---

## 第四层：语义记忆（Semantic Memory）

### 解决什么问题

Agent 需要"知道"一些泛化的规律，而不需要回忆具体是从哪次经历中学到的——"Python 的列表推导比 for 循环快"、"这个用户偏好简洁回答"、"处理 CSV 文件先检查编码问题"。

这些知识已经 **脱离了具体事件**，变成了独立的"常识"。你不记得什么时候学会的，但你"就是知道"。

对应生物学：**大脑皮层的语义记忆**——从海马体的多次情景记忆中缓慢提取的抽象规律，存储在皮层突触中。

### 存储了什么

每条语义记忆是一个 **Soft Prompt**——几个学习到的连续向量 token，编码了一条泛化规律：

```
SemanticMemoryUnit:
  unit_id             — 唯一标识
  label               — 人类可读的描述（用于可解释性）
                        例："user_prefers_concise_style"
                        例："csv_check_encoding_first"

  soft_tokens         — 学习到的连续向量
                        形状：(n_tokens, hidden_dim)
                        典型 n_tokens = 4~16

  source_episodes     — 蒸馏来源的 episode_id 列表
  source_count        — 来源 episode 数量
  domain_tags         — 关联的领域标签

  activation_score    — 累计激活得分（被选中使用的次数）
  last_activated      — 最后被激活的时间
  created_at          — 创建时间
  confidence          — 置信度（来源越多越高）
```

### 如何存储

```
载体：文件系统 — 每个 SemanticMemoryUnit 存为一个小文件
     soft_tokens 存为 .pt tensor 文件
     元数据存为 .json

目录结构：
  memory_store/semantic/
  ├── index.json              — 所有 unit 的元数据索引
  ├── user_concise_style/
  │   ├── tokens.pt           — soft prompt 向量 (~几KB)
  │   └── meta.json           — 来源、得分、标签
  ├── csv_encoding_check/
  │   ├── tokens.pt
  │   └── meta.json
  └── ...

大小：每个 unit ~10~50KB（4~16 tokens × hidden_dim × float16）
容量：百级（几百条泛化规律足以覆盖一个用户/领域）

训练方式：Prefix Tuning
  - 冻结基座模型所有参数
  - 只训练 n 个 soft token 的向量值
  - 训练数据 = 来源 episodes 的 (context, strategy, outcome)
  - 几十步梯度就够（数据量小、参数量小）

运行时加载：
  - 激活判断：用当前 context embedding 和每个 unit 的
    domain_tags / label 做快速匹配
  - 激活的 soft prompts prepend 到模型输入前
  - 可同时激活多个（拼接），但有上限（避免挤占 context）
  - 典型：同时激活 3~5 个 semantic units

效用衰减：
  - activation_score 随时间指数衰减
  - 低于阈值的 unit 降级：不再参与快速匹配，
    但保留文件（可手动恢复）
  - 极低效用的 unit 在存储压力时删除
```

### 层间关系

- 上游输入：巩固引擎从相似 episode（2~3 次重复）中训练 soft prompt
- 被上层使用：运行时选择性 prepend 到模型输入，影响推理
- 向下巩固：当一个 semantic unit 的 source_count 持续增长（5+），且 confidence 高 → 升级为 LoRA adapter（更强的表达能力，更深的参数化）
- 升级后：soft prompt unit 不立即删除，保留一段时间作为 fallback

---

## 第五层：程序记忆（Procedural Memory）

### 解决什么问题

Agent 需要在特定领域/场景下 **自动化地、无需思考地** 做出正确行为——不是"想起来上次怎么做的"，而是"手指自己就动了"。这是最深层的记忆，已经变成了 Agent 的 **行为本能**。

典型场景：处理过 50 次 Python 类型错误后，Agent 不需要检索历史、不需要调用语义记忆，直接就知道该怎么调试——因为这个模式已经刻进了它的权重。

对应生物学：**基底神经节的程序记忆 / 小脑的运动记忆**——高度自动化的技能，执行时不经过意识（皮层），直接由皮层下结构驱动。

### 存储了什么

每个程序记忆是一个 **LoRA Adapter**——一组低秩权重矩阵，编码了一个领域/技能的完整行为模式：

```
ProceduralMemoryUnit:
  adapter_id          — 唯一标识
  adapter_name        — 人类可读名
                        例："python_debugging"
                        例："user_alice_preferences"
                        例："api_error_handling"

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
  domain_tags         — 领域标签（用于路由器粗筛）
  trigger_conditions  — 激活条件描述
  applicability       — 适用边界描述

  // 效用追踪
  activation_count    — 被路由器激活的总次数
  success_rate        — 激活后任务成功率
  last_activated      — 最后被激活时间
  ewc_fisher_diag     — Fisher 信息对角线
                        （保护重要参数不被后续训练覆盖）
```

### 如何存储

```
载体：文件系统 — 每个 adapter 一个目录，兼容 HuggingFace PEFT 格式
     直接可用 PeftModel.from_pretrained 加载

目录结构：
  memory_store/procedural/
  ├── registry.json                 — 所有 adapter 的路由索引
  ├── python_debugging/
  │   ├── adapter_config.json       — PEFT 配置
  │   ├── adapter_model.safetensors — LoRA 权重 (~10~100MB)
  │   ├── meta.json                 — 来源、效用、EWC 数据
  │   └── fisher_diag.pt            — Fisher 信息矩阵
  ├── user_alice_preferences/
  │   ├── ...
  └── ...

大小：每个 adapter 10~100MB（取决于 rank 和 target_modules）
容量：十级（10~30 个活跃 adapter）
     受限于推理时的 adapter 切换/合并开销

训练方式：标准 LoRA/QLoRA 微调
  - 训练数据 = 来源 episodes 的完整序列
  - 使用 EWC 正则化保护已有重要参数
  - 新 episode 积累时增量训练（不从零开始）
  - rank 可随成熟度提升：初始 r=4 → 积累后 r=8 → r=16

运行时加载：
  Router 判断当前 context 激活哪些 adapter
  ├── 单 adapter 场景：直接 set_adapter()
  └── 多 adapter 场景：weighted merge
      权重由 router 根据 context 相关性决定

  Router 本身也是一个轻量模型/规则：
  ├── 第一级：domain_tags 粗筛（规则匹配，几乎零成本）
  ├── 第二级：context embedding vs adapter embedding
  │          余弦相似度排序
  └── 第三级：Router 可以自身也是一个 LoRA adapter
             从历史路由决策中学习

效用管理：
  - success_rate 低于阈值 → 标记为 degraded，降低路由优先级
  - activation_count = 0 超过 30 天 → 标记为 dormant
  - dormant 超过 90 天 → 归档（移出活跃池，保留文件）
  - EWC fisher_diag 定期更新，反映哪些参数对当前任务最重要
```

### 层间关系

- 上游输入：
  - 巩固引擎从高频 episode（5+次）直接训练 LoRA
  - 成熟的 semantic unit 升级为 LoRA（更强表达能力）
- 被上层使用：运行时动态加载，直接影响模型推理输出
- 没有更下层：这是最深的记忆形态
- 特殊路径：极高效用、极高 confidence 的 adapter 可以考虑 **merge 进基座权重**（不可逆），但这通常只在模型版本升级时做

---

## 巩固过程（Consolidation）

连接五层记忆的核心机制，类比睡眠时的记忆巩固：

```
                    巩固引擎（周期性离线运行）
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        扫描情景记忆      更新语义记忆      更新程序记忆
              │               │               │
         聚类分析         效用衰减评估      EWC 更新
         相似 episode      低效 unit 降级    Fisher 重算
         分组              │               │
              │               │               │
         ┌────┴────┐         │               │
     2~3次重复  5+次重复      │               │
         │         │          │               │
    训练 soft   训练 LoRA     │               │
    prompt     adapter       │               │
         │         │          │               │
    标记源 episode 为 consolidated
         │         │
    启动 TTL 倒计时
```

---

## 设计原则

### 原则一：记忆形态随成熟度流动

```
原始 episode → soft prompt → LoRA adapter → 模型权重
 (具体)        (半泛化)      (领域技能)     (深层直觉)
 (大)          (几百字节)    (几十 MB)      (不可分离)
 (可删除)      (可删除)      (可插拔)       (永久)
```

不是所有记忆都要走到终点。大部分停留在 episode 或 soft prompt 层就够了。只有真正核心的、反复验证的模式才值得烧进权重。

### 原则二：检索不是查询，是激活

不要把记忆检索想成 "SELECT ... WHERE ..."。应该想成 **神经激活扩散**——当前 context 是一个激活模式，它自动激活相关的 adapter、soft prompt 和 episode，不同记忆形态的激活是并行的、竞争的、互相增强的。

### 原则三：遗忘是特性，不是 bug

不需要专门设计"遗忘机制"。让 EWC 的 Fisher 信息量自然衰减、让 adapter bank 有容量上限、让 episode store 有 TTL——遗忘就自然发生了。重要的记忆因为频繁被激活而持续巩固，不重要的自然消退。
