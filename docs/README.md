# NeuroCore 文档导航

本目录按"迭代阶段 + 日期 + 阅读顺序"组织，完整记录从范式提出到产品落地的设计演进。

---

## 01. 范式提出（2026-03-27）

NeuroCore 的理论出发点：分析 ReAct 框架的七大根本局限，提出受神经科学启发的六模块认知架构。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_react-limitations.md`](01_2026-03-27_paradigm/01_react-limitations.md) | ReAct 模型的深层局限性分析——线性链式推理、无世界模型、无持久记忆、无元认知、无动机系统、单点故障、扁平任务 |
| 2 | [`02_neurocore-paradigm.md`](01_2026-03-27_paradigm/02_neurocore-paradigm.md) | 新范式提案——NeuroCore 六模块架构（Cortex / Hippocampal / Cerebellar / Amygdala / Basal Ganglia / Prefrontal）的设计哲学、理论依据和各模块详细设计 |
| 3 | [`03_global-workspace-and-cycle.md`](01_2026-03-27_paradigm/03_global-workspace-and-cycle.md) | 全局工作空间的竞争广播机制、认知周期流程、运行实例演示（ReAct vs NeuroCore 行为对比） |
| 4 | [`04_neurocore-agent-architecture-full.md`](01_2026-03-27_paradigm/04_neurocore-agent-architecture-full.md) | 完整合并版——将前三篇整合为单一参考文档，用于后续 SDK 设计阶段的输入 |

---

## 02. SDK 设计与实施（2026-03-27）

将认知架构收敛为可交付的 SDK 产品：需求 → 设计 → 架构 → 协议 → 包结构 → 实施计划。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_requirements.md`](02_2026-03-27_sdk/01_requirements.md) | 产品定位、目标用户、核心价值主张、应用场景、功能需求清单（FR-01 ~ FR-27）、非功能需求和验收标准 |
| 2 | [`02_design.md`](02_2026-03-27_sdk/02_design.md) | SDK 设计方案——API 设计、会话模型、认知周期编排、记忆分层、工具与策略接口 |
| 3 | [`03_architecture.md`](02_2026-03-27_sdk/03_architecture.md) | 系统架构设计——分层架构、包边界、依赖规则、部署形态（嵌入式 / 托管式 / 混合式） |
| 4 | [`04_protocol-spec.md`](02_2026-03-27_sdk/04_protocol-spec.md) | 协议与 Schema 规格——核心类型定义、命令、事件、接口契约，作为所有包的公共协议源 |
| 5 | [`05_package-structure-and-spi.md`](02_2026-03-27_sdk/05_package-structure-and-spi.md) | 包结构与 SPI 设计——代码组织方式、模块边界、扩展点定义、依赖方向约束 |
| 6 | [`06_mvp-implementation-plan.md`](02_2026-03-27_sdk/06_mvp-implementation-plan.md) | MVP 实施计划——六阶段里程碑拆分（M0 ~ M5）、交付物定义、验收标准、实施原则 |

---

## 03. 差距评估与路线（2026-03-30）

MVP 完成后的代码状态评估，识别实现与设计之间的差距并规划后续路线。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_mvp-gaps-and-next-steps.md`](03_2026-03-30_assessment/01_mvp-gaps-and-next-steps.md) | MVP 条件逐条对照、交付清单验收状态、测试场景覆盖评估、四个收尾目标（门控路径 / 验收测试 / Remote Eval / 基线用例） |
| 2 | [`02_gap-analysis-and-roadmap.md`](03_2026-03-30_assessment/02_gap-analysis-and-roadmap.md) | 六模块完成度量化评估、主要差距表、后续里程碑规划（M5.1 ~ M7）、优先级排序（P0 ~ P3）、关键风险分析 |

---

## 04. 下一阶段设计（2026-03-31）

基于 MVP + Runtime Hardening 完成后的下一阶段需求拆解与详细设计。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_next-stage-overview.md`](04_2026-03-31_next-stage/01_next-stage-overview.md) | 第二阶段整体规划——五大方向总览、需求编号（FR-28 ~ FR-61）、里程碑依赖关系 |
| 2 | [`02_multi-agent-scheduling.md`](04_2026-03-31_next-stage/02_multi-agent-scheduling.md) | 方向 A：多 Agent 分布式调度（FR-28 ~ FR-35，Milestone 9）——Agent 注册与发现、任务分发、子会话管理与结果汇聚 |
| 3 | [`03_world-model-and-devices.md`](04_2026-03-31_next-stage/03_world-model-and-devices.md) | 方向 B：世界模型与外部设备接入（FR-36 ~ FR-43，Milestone 8）——Cerebellar 模块深化、设备抽象层、状态图维护 |
| 4 | [`04_skill-reinforcement-learning.md`](04_2026-03-31_next-stage/04_skill-reinforcement-learning.md) | 方向 C：技能自动提炼的强化学习（FR-44 ~ FR-49，Milestone 10）——Basal Ganglia 模块从技能匹配升级为自动提炼闭环 |
| 5 | [`05_operations-console.md`](04_2026-03-31_next-stage/05_operations-console.md) | 方向 D：运营控制台（FR-50 ~ FR-55，Milestone 11）——Session / Approval / Trace / Eval 的管理与可视化 |
| 6 | [`06_general-autonomy.md`](04_2026-03-31_next-stage/06_general-autonomy.md) | 方向 E：通用自主体能力（FR-56 ~ FR-61，Milestone 12）——自主目标生成、长期规划、跨域迁移，依赖方向 A/B/C |

---

## 05. 记忆系统演进（2026-04-01）

下一代记忆系统的设计探索：分析当前记忆实现的本质局限，借鉴 LLM 前沿技术，构想真正对齐神经科学的记忆架构。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_neural-memory-architecture.md`](05_2026-04-01_memory-evolution/01_neural-memory-architecture.md) | 神经记忆架构设计脑暴——LLM 四种记忆形态分析、LoRA 索引 vs 端侧微调方案对比、kNN-LM/Self-RAG/EWC 等六项关键技术借鉴、运行时检索与睡眠巩固架构设想、三个核心设计原则 |
| 2 | [`02_draft_five-layer-memory-design.md`](05_2026-04-01_memory-evolution/02_draft_five-layer-memory-design.md) | 五层记忆系统详细设计草案——各层数据结构、存储方式、层间关系、自然相变机制、consolidation_pressure 动力学 |
| 3 | [`03_memory-system-architecture.md`](05_2026-04-01_memory-evolution/03_memory-system-architecture.md) | **收敛稿**——完整需求（MR-01~15 / NR-01~08）、五层设计、六大技术组件架构、六阶段迁移计划、P0/P1 验证实验、风险与缓解 |

---

## 项目进度

> 本节为 NeuroCore 唯一的进度跟踪源。每次完成功能改动后同步更新。

### 总体状态

**MVP + 全部产品化补齐 + M8/M9 已交付**，255 个测试全部通过。

### 里程碑

| Milestone | 名称 | 状态 |
|---|---|---|
| M5.1 | 仲裁层升级（Meta + Workspace） | ✅ 完成 |
| M5.2 | 预测闭环（Cerebellar / World Model） | ✅ 完成 |
| M5.3 | 技能系统（Basal Ganglia / Skill） | ✅ 完成 |
| M6 | Hosted Runtime 产品化 | ✅ 完成 |
| M7 | 测试、CI 与发布自动化 | ✅ 完成 |
| M8 | 世界模型与设备接入 | ✅ 完成 |
| M9 | 多 Agent 分布式调度 | ✅ 完成 |

### 六模块完成度

| 模块 | 映射 | 完成度 | 说明 |
|---|---|---|---|
| Cortex / Reasoner | 大脑皮层 | 70% | LLM reasoner、plan/respond、OpenAI adapter 已有；多模态、结构化流式、高级推理策略未做 |
| Hippocampal / Memory | 海马体 | 80% | 四层记忆 + procedural 自动提炼已有；TTL、negative learning 未做 |
| Cerebellar / World Model | 小脑 | 90% | 预测闭环 + device-core + world-model 已实现；Active Inference、Device Coordination 未做 |
| Amygdala / Motivation-Risk | 杏仁核 | 40% | 基础 policy/approval/budget/cost 已有；细粒度 risk model 未做 |
| Basal Ganglia / Skill | 基底神经节 | 80% | skill 匹配-执行-提炼闭环已有；RL 自动提炼未做 |
| Prefrontal / Meta | 前额叶 | 85% | 多维评分/冲突检测/prediction error 消费已有；richer reasoning 未做 |
| Global Workspace | 全局工作空间 | 80% | broadcast-compete-select 竞争机制已实现 |

### 当前阶段边界（不做）

- 分布式 Bus 实现（Redis/NATS）、去中心化注册（gossip/DHT）、runtime-server 多 Agent 管理 API（FR-35）
- 图数据库后端、CRDT 冲突解决、DistributedTracer 跨 Agent span 管理
- 技能自动提炼的强化学习
- 完整运营控制台 UI
- 通用 AGI 式自主体能力
- Active Inference（FR-42）、Device Coordination（FR-43）

---

## 命名规则

- 目录：`<阶段序号>_<日期>_<主题>`
- 文件：`<顺序>_<主题>.md`
- 日期统一采用 `YYYY-MM-DD`
