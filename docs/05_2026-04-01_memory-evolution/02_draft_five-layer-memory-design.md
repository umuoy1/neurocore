# 五层记忆系统详细设计（Draft）

> 基于头脑风暴讨论的阶段性设计产出，尚未定稿。

---

## 总览

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

## 架构约束

### 记忆 proposal 与主推理并行

记忆基座（端侧小模型）的 proposal 生成与主推理模型 **并行执行**，走异步通道。两者的输出在 Global Workspace 中竞争。如果记忆 proposal 在时间窗口内未就绪，主推理的 proposal 独立参与竞争，记忆系统本轮跳过。

这反而更生物：直觉反应（记忆）和深思熟虑（推理）在大脑中是并行的，不是串行等待。

```
用户输入
    │
    ├──────────────────────┬───────────────────────┐
    ▼                      ▼                       ▼
 主推理模型             记忆基座推理            情景记忆 RAG
 (API / 大模型)        (端侧小模型             (SQLite+Vec
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
```

### 相变方向的自然决策

当 consolidation_pressure 越过临界点时，相变方向由 episode 群组自身的特征自然决定：

```
共激活 episode 群组的特征分析：
    │
    ├── strategy_consistency 高（几乎总是用同一种方法）
    │   + outcome 以 success 为主
    │   → 这是一个行为模式 → 相变为程序记忆（LoRA）
    │
    ├── strategy_consistency 高
    │   + outcome 混合或以 failure 为主
    │   → 这是一个行为倾向/偏好 → 相变为语义记忆（Soft Prompt）
    │   （负面倾向也是倾向："遇到 X 情况要避免 Y 策略"）
    │
    └── strategy_consistency 低
        + 但 context 相似度很高
        → 还在探索，模式不稳定 → 暂不相变，继续积累

直接相变为 LoRA 的条件更严格：需要行为一致性和结果一致性都高。
Soft Prompt 的门槛更低：只需要行为倾向一致即可。
这和生物系统一致——习惯（程序记忆）比认知（语义记忆）需要更多的重复才能形成。
```

---

## 第一层：瞬时适应（Transient Adaptation）[可选层]

> **设计状态**：此层是整个架构中最激进的假设，工程成本最高（需要推理引擎支持反向传播）。
> 需要实验验证 micro-adapter（2~5 步梯度下降）相比 In-Context Learning 的增益是否值得额外复杂度。
> 如果 ICL 能达到 80% 效果，此层应降级为未来探索方向，核心系统不依赖它。

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
         不是一次性的），其产生的 observation 会反复写入情景记忆，
         相似 episode 的共激活压力自然积累，最终相变为更深层的记忆
```

### 层间关系

- 上游输入：来自工作记忆中"当前 cycle 我遇到了什么困难"
- 下游影响：直接修改当前推理的输出分布
- 向下巩固：如果同一类瞬时适应在多个 session 中反复出现 → 产生的 episode 自然积累共激活压力 → 最终相变为 soft prompt 或 LoRA

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

  // 激活痕迹（记忆自身的生命体征，不由外部管理器维护）
  activation_trace:
    total_activations   — 被检索/共激活的总次数
    co_activation_map   — { episode_id → 共激活次数 }
                          记录"我和谁一起被想起过"
    activation_contexts — 最近 N 次被激活时的 query embedding
                          记录"在什么情境下被想起的"
    last_activation     — 上次被激活的时间

  // 巩固压力（从 activation_trace 自然涌现的连续值）
  consolidation_pressure — float, 由激活频率、共激活稳定性、
                           结果一致性综合计算
                           每次激活时自然增长，沉默时自然衰减
```

### 如何存储

```
载体：SQLite + sqlite-vec 向量扩展
     结构化字段存 SQLite 表（精确查询）
     context_embedding 存向量索引（语义检索）

大小：每条 episode ~1~5KB，向量 ~3KB (768d float32)
容量：无硬上限，由自然遗忘机制管理增长

持久化：写入即持久化
检索方式：
  - 向量相似度（语义相关性）
  - 结构化过滤（时间范围、outcome、tool_name）
  - 混合排序：relevance × activation_recency × valence_weight

关键索引：
  - (tenant_id, timestamp)        — 时间线查询
  - (tenant_id, tool_name)        — 按工具类型聚合
  - 向量索引 on context_embedding — 语义检索

检索的副作用（自然跃迁的核心驱动力）：
  每次检索不是无痕的"只读"操作，而是会改变记忆自身的状态：
  - 被命中的 episode：activation_trace 更新
  - 被共同命中的 episode 之间：co_activation_map 互相增强
  - consolidation_pressure 重新计算
  - 如果 pressure 越过相变阈值 → 跃迁在此刻自然发生

自然遗忘：
  不设 TTL 扫描器。遗忘是激活竞争的结果——
  - 长期未被激活的 episode，activation_trace 自然衰减
  - 衰减后在检索排序中下沉，更难被命中
  - 更难命中 → 进一步衰减（正反馈）
  - 最终该 episode 在认知层面已"死亡"，物理清理只是善后
  - 高 valence（|v| > 0.8）的 episode 衰减速率更低
    （创伤/顿悟类记忆自然更持久）
```

### 层间关系

- 上游输入：工作记忆在 session 结束时写入 episode；显著 cycle（outcome 明确或 |valence| > 0.6）立即写入
- 被上层检索：工作记忆发起 query → 返回相关 episode → 检索行为本身更新 episode 的激活痕迹
- 向下相变：不由外部引擎扫描触发，而是在正常检索中自然发生——
  - 一组 episode 被反复共激活 → co_activation_map 积累 → consolidation_pressure 持续上升
  - pressure 越过相变阈值时 → 该组 episode 的共性模式自然凝结为 soft prompt 或 LoRA
  - 相变阈值不是硬编码数字，而是由激活频率、策略一致性、结果一致性综合涌现
- 高 valence 单次事件：因为衰减速率低，自然保持鲜活，不参与模式凝结（保留细节的记忆）

---

## 第四层：语义记忆（Semantic Memory）

### 解决什么问题

Agent 需要"知道"一些泛化的 **行为倾向**，而不需要回忆具体是从哪次经历中学到的——"这个用户偏好简洁回答"、"处理 CSV 文件先检查编码问题"、"遇到权限错误先查 IAM 配置"。

这些不是"知识"或"事实"（事实留在情景记忆里用 RAG 检索），而是 **行为偏好和策略倾向**——脱离了具体事件的抽象行为指导。

> **边界澄清**：语义记忆层 **只存行为倾向，不存知识**。
> - "Python 列表推导比 for 循环快" → 这是事实 → 留在情景记忆
> - "遇到循环性能问题倾向于先尝试列表推导" → 这是倾向 → 语义记忆
> Soft Prompt 的信息容量（4~16 tokens）恰好匹配行为倾向的抽象度——
> 它编码的是"偏置方向"，不是"具体内容"。

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

- 上游输入：情景记忆中 episode 的共激活模式自然凝结为 soft prompt——不是"被升级"，而是激活压力积累到临界点后的相变
- 被上层使用：运行时选择性 prepend 到模型输入，影响推理；每次被激活时 activation_score 自然增长
- 向下相变：当一个 semantic unit 被持续高频激活、且 source 不断增长 → 它自身的表达能力瓶颈成为自然压力 → 相变为 LoRA adapter（更大的参数容量承载更深的模式）
- 自然遗忘：activation_score 随时间指数衰减，长期不被激活的 unit 在检索竞争中自然下沉，最终不可见

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
  - success_rate 每次激活后自然追踪，低成功率 → 路由权重自然下降
  - 长期不被路由器激活 → 在竞争中被其他 adapter 排挤
  - EWC fisher_diag 随时间自然衰减 → 允许旧权重被新训练覆盖
  - 物理归档/清理只是对已在竞争中"死亡"的 adapter 的善后
```

### 层间关系

- 上游输入：
  - 情景记忆中高频共激活模式直接相变为 LoRA（压力足够大时可跳过 soft prompt 阶段）
  - 语义记忆的 soft prompt 在持续激活中自然相变为 LoRA
- 被上层使用：运行时动态加载，直接影响模型推理输出
- 没有更下层：这是最深的记忆形态
- 特殊路径：极高效用、极高 confidence 的 adapter 可以考虑 **merge 进基座权重**（不可逆），但这通常只在模型版本升级时做
- 自然遗忘：
  - 每次激活后追踪 success_rate；持续低成功率 → 路由权重自然下降
  - 长期不被路由器激活 → 在竞争中自然被排挤
  - EWC fisher_diag 随时间自然衰减 → 允许旧权重被新训练覆盖

---

## 记忆跃迁：自然相变而非程式化升级

### 核心理念

记忆系统没有"管理者"。没有一个站在记忆之外的控制器在扫描、判定、升级。每条记忆通过自身的激活历史决定自己的命运——被反复激活的自然巩固，被忽视的自然消退。整个系统的宏观行为从微观的激活动力学中涌现出来。

这和大脑一致：海马体不会"每隔 6 小时扫描一遍，把出现 3 次的模式升级到皮层"。每次你回忆一件事，那件事就在被巩固。回忆本身就是巩固。不存在一个独立于使用之外的"巩固过程"。

### 跃迁全景

```
瞬时适应 ──①──→ 工作记忆 ──②──→ 情景记忆 ──③──→ 语义记忆 ──④──→ 程序记忆
                   ↑                  │                           │
                   └────⑤─────────────┘         ──────⑥──────────┘
                      向上提取                      直接相变

                每层内部还有 ⑦ 自然衰减（遗忘）
```

### ① 瞬时适应 → 工作记忆（结果沉淀）

瞬时适应本身不"升级"——它用完就丢。但它产生的 **效果** 沉淀进工作记忆：micro-adapter 产生的 action 和 observation 被记录在 decision_chain 中。adapter 本身像催化剂一样消失了，但它催化的反应结果留在了工作记忆里。

### ② 工作记忆 → 情景记忆（经历固化）

两种触发，都是运行的自然副产物：
- session 结束 → 工作记忆中重要内容批量写入 episode
- 单个 cycle 产生显著结果（outcome 明确或 |valence| > 0.6）→ 立即写入

转化过程是 **重新编码**，不是复制——工作记忆是"面向当前决策"的格式，情景记忆是"面向未来回忆"的格式。丢弃执行细节，保留"情境-决策-结果"三元组。

### ③ 情景记忆 → 语义记忆（模式凝结）——自然相变

**这是最关键的跃迁。不是由巩固引擎扫描触发，而是在正常使用中自然发生。**

```
Agent 正常工作中，需要检索相关经验
         │
         ▼
  情景记忆检索 → 返回 [e1, e2, e3, e7]
         │
         │  检索行为本身触发以下副作用：
         │
         ├── e1, e2, e3, e7 各自的 activation_trace 更新
         │   total_activations += 1
         │   last_activation = now
         │
         ├── 这四条 episode 互相的 co_activation_map 更新
         │   "e1 和 e3 又一次在同一个 query 中被共激活了"
         │   它们之间的关联强度自然增长
         │
         ├── 每条 episode 的 consolidation_pressure 重新计算
         │   pressure = f(激活频率, 共激活稳定性, 结果一致性)
         │   这不是人为设定的计数器，而是从激活痕迹自然涌现的连续值
         │
         └── 如果一组 episode 的共激活压力越过了相变阈值
             → 它们的共性模式自然凝结为 soft prompt
             → 不是调度器触发的，而是这次激活刚好积累够了
             → 像水结冰——温度持续下降，在某个临界点状态自然转变
```

相变阈值不是硬编码的数字。它由以下信号综合涌现：
- **共激活频率**：这些 episode 被一起想起的频率有多高？
- **策略一致性**：这些 episode 用了相似的策略吗？不一致说明还在探索，不该凝结
- **结果一致性**：策略的 outcome 一致吗？混合结果说明模式不稳定
- **时间跨度**：跨越多少 session？跨 session 的共激活比同 session 更可信

### ④ 语义记忆 → 程序记忆（技能固化）——自然相变

同样不由外部调度器驱动。一个 soft prompt 被持续高频激活、不断有新的 source episode 汇入，它自身的表达能力瓶颈（只有几个 token 的容量）成为自然压力——需要更大的参数空间来承载不断丰富的模式。这个压力积累到临界点时，自然相变为 LoRA adapter。

### ⑤ 情景记忆 → 工作记忆（向上提取）

唯一的反向路径。工作记忆在当前 cycle 中判断"我需要更多信息"时，向情景记忆发起检索。检索结果的摘要加载进工作记忆的 active_observations，episode 的 strategy + outcome 影响 strategy_preference。

这次检索同时也是被检索 episode 的一次激活——**提取和巩固在同一个操作中同时发生**。

### ⑥ 情景记忆 → 程序记忆（直接相变）

跳过语义记忆层的快速通道。当一组 episode 的共激活压力极高（高频率 + 高一致性 + 跨多个 session），模式已经足够成熟，不需要在 soft prompt 阶段"试探"。压力直接驱动相变为 LoRA adapter。

和 ③→④ 路径的区别：渐进式相变适合不确定的、逐步发现的模式；直接相变适合从一开始就明确的、高频高成功率的模式。选择哪条路径不是由规则决定的，而是由压力的积累方式自然决定的。

### ⑦ 自然衰减（每层内的遗忘）

```
瞬时适应层：天然短命，用完即丢，无需衰减

工作记忆层：容量限制 = 自然淘汰
           新 observation 挤掉旧 observation
           低 importance 的先被挤掉——不是定时清理，是竞争

情景记忆层：激活竞争的自然结果
           长期未被激活 → activation_trace 衰减
           → 检索排序中下沉 → 更难被命中 → 进一步衰减
           → 正反馈循环 → 认知层面的"死亡"
           物理清理只是对已"死亡"记忆的善后，不是遗忘机制本身
           高 valence episode 的衰减速率天然更低（创伤/顿悟更持久）

语义记忆层：activation_score 随时间指数衰减
           score(t) = score(t₀) × e^(-λΔt)
           低于阈值 → 在激活竞争中自然不可见

程序记忆层：success_rate 持续追踪
           低成功率 → 路由权重自然下降 → 被其他 adapter 竞争掉
           EWC fisher_diag 自然衰减 → 旧权重逐渐允许被新训练覆盖
```

### consolidation_pressure 的动力学

```
每次被激活：pressure += α × relevance_of_this_activation
每次时间流逝：pressure *= e^(-λΔt)

pressure 在两种力的拉扯下动态变化：
├── 频繁激活 → pressure 持续上升
├── 长期沉默 → pressure 自然回落
└── 不需要任何外部调度器

当 pressure 越过临界点：
├── 模式已经在检索过程中被反复"预演"了
├── 训练 soft prompt / LoRA 不过是把已涌现的模式显式固定
└── 相变是对既成事实的确认，不是外部干预
```

### 跃迁的自然节奏

```
时间尺度          自然发生的跃迁
─────────────    ──────────────────────────
毫秒~秒          ① 瞬时适应产生结果 → 沉淀进工作记忆
分钟~小时         ② 显著 cycle → 立即写入情景记忆
                 ⑤ 检索回忆 → 同时完成提取和巩固
小时（session 结束）② 工作记忆批量 → 情景记忆
天~周             ③ 共激活压力积累 → 情景 → 语义相变
                  ⑥ 高压力直接相变 → 情景 → 程序
周~月             ④ 语义记忆成熟 → 程序记忆相变
持续              ⑦ 各层内激活竞争 → 自然衰减和淘汰
```

越深层的相变越慢，因为需要更多的激活证据积累。这和大脑一样——海马体到皮层的巩固需要数天到数周的反复重放，不是一次就完成的。

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

### 原则三：遗忘是激活竞争的自然结果

不设 TTL 扫描器，不设容量上限。重要的记忆因为频繁被激活而持续巩固，不重要的在激活竞争中自然下沉。遗忘不是一个独立的机制，而是记忆系统正常运行的副作用。

### 原则四：运行即巩固，没有独立的巩固过程

巩固不是一个定时运行的后台任务，而是每次检索、每次激活的自然副作用。每次回忆一条记忆，就在强化它。每次共同回忆多条记忆，就在提取它们的共性。当共性积累到临界点，相变自然发生。系统的宏观巩固行为从微观的激活动力学中涌现出来。

---

## 验证优先级

在实现之前，以下假设需要实验验证：

### P0：决定架构是否成立

```
1. 记忆 proposal 的竞争力
   实验：7B + LoRA 的 proposal vs 主推理模型（无记忆）的 proposal
   度量：在有历史经验可用的任务中，记忆增强是否带来可度量的决策改善
   如果失败：记忆基座可能需要更大的模型，或改变 proposal 的形式
            （不是完整的策略建议，而是"记忆摘要"注入主模型 context）

2. 端到端延迟可行性
   实验：在目标硬件上完整跑通 记忆检索 → 小模型推理 → proposal 生成
   度量：是否在主推理模型完成前生成有效 proposal
   如果失败：考虑更小的记忆基座（3B/1.5B），或将小模型的角色
            从"生成 proposal"降级为"生成记忆摘要"（注入主模型 context）
```

### P1：决定各层的技术选择

```
3. Soft Prompt vs RAG 承载语义记忆
   实验：用 10 条相关 episode 训练一个 Prefix，对比把相同信息放入 context
   度量：行为倾向的稳定性、跨 session 的一致性
   如果 RAG 效果相当：语义记忆层改用结构化摘要 + RAG，放弃 Prefix Tuning

4. 瞬时适应 vs In-Context Learning
   实验：micro-adapter（2 步梯度）vs 直接把 observation 放入 context
   度量：任务适应速度和决策质量
   如果 ICL 效果相当：瞬时适应层从架构中移除，降低系统复杂度

5. 相变训练在目标硬件上的耗时
   实验：Prefix Tuning（30 步）和 LoRA 训练（250 步）在目标硬件的实际耗时
   度量：是否分别在 30s / 5min 内完成
   如果超标：降低 rank、减少步数、或接受更长的训练时间（延迟训练策略）
```
