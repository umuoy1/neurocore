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
| 3 | [`03_code-audit-checklist.md`](03_2026-03-30_assessment/03_code-audit-checklist.md) | **当前最准确的代码反推审计**——按 M0 ~ M13 逐项判断完成度、闭环状态、架构评估，以及按优先级排序的真实待办 |
| 4 | [`04_memory-code-audit-and-remediation-plan.md`](03_2026-03-30_assessment/04_memory-code-audit-and-remediation-plan.md) | 记忆系统代码专项审计与修复计划——按 working / episodic / semantic / procedural 四层梳理代码现状、问题分级、修复阶段和验收标准 |
| 5 | [`05_memory-runtime-closure-map.md`](03_2026-03-30_assessment/05_memory-runtime-closure-map.md) | 记忆系统代码反推的模块关系图与生命周期图——梳理 runtime、四层记忆、checkpoint/restore/cleanup 的真实闭环与状态边界 |

---

## 04. 下一阶段设计（2026-03-31）

基于 MVP + Runtime Hardening 完成后的下一阶段需求拆解与详细设计。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_next-stage-overview.md`](04_2026-03-31_next-stage/01_next-stage-overview.md) | 第二阶段整体规划——六大方向总览、需求编号（FR-28 ~ FR-69）、里程碑依赖关系 |
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
| 4 | [`04_sql-memory-migration-design.md`](05_2026-04-01_memory-evolution/04_sql-memory-migration-design.md) | SQL 记忆库迁移设计——把 `RuntimeSessionSnapshot` 中的四层记忆从 `snapshot_json` 拆出，建立规范化 SQL 表、阶段化迁移路径，以及首批 SQLite store 骨架范围 |
| 5 | [`05_longmemeval-benchmark-integration.md`](05_2026-04-01_memory-evolution/05_longmemeval-benchmark-integration.md) | LongMemEval benchmark 接入说明——official dataset bundle loader、recursive full-bundle discovery、retrieval/suite/matrix runner、vendored official retrieval/QA evaluator wrapper、hypothesis generation、NeuroCore episodic adapter、full-run script 与当前阶段的 benchmark 边界 |
| 6 | [`06_next-generation-memory-system-design.md`](05_2026-04-01_memory-evolution/06_next-generation-memory-system-design.md) | 下一代记忆系统正式设计——`Runtime / Durable` 主链、正式 `Episode / SemanticCard / ProceduralSkillSpec`、`Memory Gate`、`Recall Bundle`、治理链与参数层非目标边界 |
| 7 | [`07_next-generation-memory-system-implementation-plan.md`](05_2026-04-01_memory-evolution/07_next-generation-memory-system-implementation-plan.md) | 下一代记忆系统施工单——Phase 0 ~ 5 的代码优先实施顺序、文件级改造范围、focused tests 与验收条件；Phase 6 参数层已取消为当前路线非目标 |

---

## 06. 运营控制台设计（2026-04-02）

M11 运营控制台的完整设计文档：独立 SPA，覆盖 Agent 运行时全链路数据的可视化与交互管理。

| # | 文档 | 内容 |
|---|---|---|
| 0 | [`00-overview.md`](04_2026-04-01_console/00-overview.md) | 总览——目标、技术栈（React 19 + Tailwind + Recharts + Zustand + WebSocket）、架构原则、文档索引 |
| 1 | [`01-package-structure.md`](04_2026-04-01_console/01-package-structure.md) | 包结构——目录布局、依赖声明、构建配置、路由定义 |
| 2 | [`02-websocket-protocol.md`](04_2026-04-01_console/02-websocket-protocol.md) | WebSocket 协议——消息信封、12 个通道、客户端命令、心跳、租户隔离 |
| 3 | [`03-state-management.md`](04_2026-04-01_console/03-state-management.md) | 状态管理——12 个 Zustand Store 设计、数据流、WS 绑定 |
| 4 | [`04-dashboard.md`](04_2026-04-01_console/04-dashboard.md) | Dashboard（FR-50）——5 指标卡片、吞吐/延迟图、健康面板、实时事件流 |
| 5 | [`05-session-browser.md`](04_2026-04-01_console/05-session-browser.md) | Session 浏览器（FR-51）——列表筛选、详情三栏布局、预算仪表、事件流 |
| 6 | [`06-trace-viewer.md`](04_2026-04-01_console/06-trace-viewer.md) | Cycle Trace 查看器（FR-52）——时间轴、阶段分解、竞争日志、预测对比 |
| 7 | [`07-goal-tree.md`](04_2026-04-01_console/07-goal-tree.md) | Goal Tree 可视化——层级树、状态着色、依赖关系、筛选搜索 |
| 8 | [`08-memory-inspector.md`](04_2026-04-01_console/08-memory-inspector.md) | Memory 检查器——Observability + Working/Episodic/Semantic/Procedural 浏览，展示 retrieval plan、recall bundle 与治理 warning |
| 9 | [`09-workspace-inspector.md`](04_2026-04-01_console/09-workspace-inspector.md) | Workspace 检查器——快照钻取、竞争日志、风险评估、策略决策 |
| 10 | [`10-multi-agent.md`](04_2026-04-01_console/10-multi-agent.md) | Multi-Agent 面板——注册表、委派追踪、协调视图、心跳监控、拍卖面板 |
| 11 | [`11-world-model.md`](04_2026-04-01_console/11-world-model.md) | World Model 查看器——实体-关系力导向图、冲突列表、查询过滤 |
| 12 | [`12-device-panel.md`](04_2026-04-01_console/12-device-panel.md) | Device 面板——传感器/执行器卡片、读数图表、感知管道 |
| 13 | [`13-eval-dashboard.md`](04_2026-04-01_console/13-eval-dashboard.md) | Eval 面板（FR-53）——运行管理、趋势图、对比视图、回归检测 |
| 14 | [`14-approval-center.md`](04_2026-04-01_console/14-approval-center.md) | 审批中心（FR-54）——实时队列、历史、审计日志、上下文快照弹窗 |
| 15 | [`15-config-editor.md`](04_2026-04-01_console/15-config-editor.md) | 配置编辑器（FR-55）——Agent Profile 表单/JSON、策略模板、API Key 管理 |
| 16 | [`16-backend-extensions.md`](04_2026-04-01_console/16-backend-extensions.md) | 后端扩展——WS Server、MetricsStore、AuditStore、ConfigStore、26 个新端点 |
| 17 | [`17-implementation-sequence.md`](04_2026-04-01_console/17-implementation-sequence.md) | 实施分期——4 阶段（后端基础→核心 UI→高级视图→扩展能力）|

---

## 07. 个人助理架构设计（2026-04-01）

基于 NeuroCore Runtime 构建个人助理产品：飞书 IM 接入、主动引擎、服务连接器。三阶段实施计划。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_personal-assistant-requirements.md`](05_2026-04-01_personal-assistant/01_personal-assistant-requirements.md) | 需求全景——调研分析（OpenClaw/Harness Engineering）、10 个核心场景、FR-PA-01~10 需求分解、IM 平台技术规格 |
| 2 | [`02_personal-assistant-architecture.md`](05_2026-04-01_personal-assistant/02_personal-assistant-architecture.md) | 架构设计——在 `examples/personal-assistant/` 下作为独立应用实现，包含飞书 Adapter（长连接 + 卡片交互）、IMAdapter SPI、ConversationRouter、Proactive Engine、Service Connector Tool 模式、Agent 组装、飞书技术规格 |
| 3 | [`03_implementation-plan.md`](05_2026-04-01_personal-assistant/03_implementation-plan.md) | 实施计划——Phase A（飞书 + Web Chat + 搜索）、Phase B（主动引擎 + 邮件日历）、Phase C（知识库 + 技能 + 多设备），全部以 `examples/personal-assistant/` 为独立应用目录组织 |
| 4 | [`04_1_independent-milestones.md`](05_2026-04-01_personal-assistant/04_1_independent-milestones.md) | 独立产品线 milestone 设计——将主线 M0~M13 与个人助理 `PA-M1~PA-M6` 分层，重定义 `M-PA-1~11` 为工程工作包，并给出当前推荐执行顺序 |
| 5 | [`04_1_code-first-implementation-spec.md`](05_2026-04-01_personal-assistant/04_1_code-first-implementation-spec.md) | 代码落地细化——基于当前 SDK/Runtime 真实接口，定义 `examples/personal-assistant/` 独立应用的目录结构、helper、运行流、PR 切分、测试文件和当前必须绕开的接口缺口，作为 `PA-M1~PA-M3` 的直接施工说明 |
| 5 | [`04_2_milestone-breakdown.md`](05_2026-04-01_personal-assistant/04_2_milestone-breakdown.md) | 施工级里程碑拆解——20 个子里程碑（M-PA-1.1~11.1）、每个里程碑的交付物/验收标准/依赖/估时、FR 覆盖追踪矩阵、测试策略、风险登记簿 |

---

## 08. 元认知系统演进（2026-04-14）

基于当前 Runtime / Workspace / Prediction / Memory 主链，对 Prefrontal / Meta 做一次独立升级设计，把轻量门控推进为深层自评估系统。

| # | 文档 | 内容 |
|---|---|---|
| 1 | [`01_deep-metacognition-and-self-evaluation.md`](06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md) | 主设计稿——严格吸收外部专家报告与当前代码现状，收敛为 `Meta Signal Bus / Fast Monitor / Deep Evaluator / Control Allocator / Post-Hoc Learner` 五层前额叶控制栈 |
| 2 | [`02_meta-signal-assessment-and-protocol.md`](06_2026-04-14_metacognition-evolution/02_meta-signal-assessment-and-protocol.md) | 协议与状态模型拆分——定义 `MetaSignalFrame`、`MetaAssessment`、`ConfidenceVector`、`UncertaintyDecomposition`、`VerificationTrace`、`MetaState` 与现有 `Workspace / Trace / MetaDecision` 的衔接方式 |
| 3 | [`03_control-allocation-learning-and-benchmark.md`](06_2026-04-14_metacognition-evolution/03_control-allocation-learning-and-benchmark.md) | 控制、学习与评测拆分——定义 `MetaControlAction`、控制价值函数、事后学习器、校准与反思闭环，以及元认知 benchmark 与实施阶段 |
| 4 | [`04_code-first-implementation-tasklist.md`](06_2026-04-14_metacognition-evolution/04_code-first-implementation-tasklist.md) | 代码实施单——把 4.14 设计压到协议改动、runtime 接线、trace 持久化、测试与 PR 切分的施工级粒度，作为下一步直接写代码的输入 |
| 5 | [`05_m8.5-contract-freeze.md`](06_2026-04-14_metacognition-evolution/05_m8.5-contract-freeze.md) | M8.5 协议冻结与收口说明——固定 `MetaDecisionV2`、单真源控制路径、校准单路径与当前阶段验收口径 |

---

## 09. M12 实施拆解（2026-04-24）

把 `M12 / 通用自主体能力` 从“完整蓝图”收敛为可施工的代码优先实施总计划。

当前状态：

- `Phase 0` 已完成：协议冻结、自治状态面、自治事件、trace/checkpoint/runtime snapshot round-trip
- `Phase 1 ~ Phase 6` 已完成：planner、self-monitor、intrinsic motivation、自生成目标、transfer/continual、六模块自治增强、alignment/trace/benchmark 回归都已接入主链
- 当前阶段：M12 当前阶段闭环完成

| # | 文档 | 内容 |
|---|---|---|
| 0 | [`00_overview.md`](09_2026-04-24_autonomy-implementation/00_overview.md) | 总览——说明本目录的作用和实施文档索引 |
| 1 | [`01_m12-code-first-implementation-plan.md`](09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md) | M12 总实施单——Phase 划分、包规划、主链接线、PR 切分、验收标准与非目标 |

---

## 10. 平台职责边界（2026-04-24）

为了支撑“超级助理”目标，明确哪些能力必须实现于 `NeuroCore` 平台层，而不应下沉到具体个人助理产品。

| # | 文档 | 内容 |
|---|---|---|
| 0 | [`00_overview.md`](10_2026-04-24_runtime-platform-boundary/00_overview.md) | 总览——说明本目录用途、边界判断方式和文档索引 |
| 1 | [`01_runtime-platform-checklist.md`](10_2026-04-24_runtime-platform-boundary/01_runtime-platform-checklist.md) | 平台必须实现的能力清单——按运行时、记忆、自主、多 Agent、治理、协议与可观测性分层列出 |

---

## 项目进度

> 本节为 NeuroCore 唯一的进度跟踪源。每次完成功能改动后同步更新。
>
> 2026-04-18 校准说明：
> - 当前执行顺序已从“个人助理 / Console 准备优先”切到 `SDK / Protocol Tightening -> Core Gaps -> Meta 后半段 -> Operational Maturity`，其中前四项都已在当前阶段收口完成。
> - `SDK / Protocol Tightening` 最终交付包含：判别化 `RuntimeCommand`、`SessionCheckpoint.schema_version`、受限 `CreateSessionCommand.overrides`、`PolicyDecision.severity`、完全判别的 `NeuroCoreEvent`、缺失命令/事件、事件 `sequence_no`、builder `validate()/build()`、重复注册拒绝、`configurePolicy()` 与 `policy_ids` 对齐、显式 `configureApprovalPolicy()`、shared `SessionHandleLike`、local/remote `checkpoint/replay/waitForSettled` 对齐，以及 remote trace/episode/event pagination、`AbortSignal` 超时、429/503 重试和 SSE `Last-Event-ID` 重连。
> - 第二批已继续收口：`ToolGateway` 已补 `idempotency_key` 结果缓存、TTL 与 namespace-based invalidation，`PolicyProvider.evaluateInput / evaluateOutput` 已进入主链，input/output screening 已能真正影响 cycle / response，`ask_user` 已具备结构化 prompt schema 透传与 resume 前输入校验能力，多轮会话历史、role-annotated conversation buffer、token-aware truncation 与 conversational token counting 也已进入 runtime / reasoner 主链，`runtime.output` 现在也显式区分 `token_stream / buffered` 语义。
> - Core Gaps 当前这一批已经收口完成：delegate 子会话闭环、conditional planning 的 fallback/DAG plan graph、多模态 typed content parts，以及长对话 summary 都已进入主链；这一阶段不再继续扩 Core Gaps，而是转向 Meta 后半段和剩余 SDK robustness。
> - 2026-04-22 补充：`M10 技能强化学习` 已完成。当前交付包含 `RewardSignal / RewardStore / RewardComputer`、`BanditSkillPolicy`、`rl_config`、`epsilon-greedy / UCB / Thompson Sampling`、`SkillEvaluator`、deprecated/pruned 生命周期、`SkillTransferEngine`、`SkillOnlineLearner` 与 prioritized replay，以及 reward/policy/exploration/evaluation/transfer 事件和 SQLite 持久化。
> - 2026-04-22 再补充：`M10` 当前阶段已继续补齐 FR-47 / FR-48 的闭环细节，当前 skill 主链已支持迁移 skill 去重、验证期递减与 penalty 清除、验证失败自动回退，以及基于 TTL 的自动裁剪。
> - 2026-04-23 补充：`M10` 已补齐 FR-45 的最小上下文化策略实现。当前 `BanditSkillPolicy` 已按 `goal_type / domain / action_type / tool_name / risk_level` 维护上下文 policy state，并与全局 state 并存；当前实现是 contextual bandit，不是独立神经策略网络。
> - 2026-04-23 再补充：`M10` 又补了两处增强：`RewardComputer` 的效率维度已从启发式代理改成基于真实 `cycle / latency / token` 统计；`BanditSkillPolicy` 已从单层 exact-context 升级为 `exact -> operational -> family -> global` 的分层上下文 bandit。
> - 2026-04-23 最终校准：`M10` 当前阶段已 100% 收口。当前实现又补齐了 reward `metrics / baseline_metrics` 持久化、基于历史 reward 的相对效率基线、`policy.updated / exploration.triggered / skill.transferred / skill.pruned` 的结构化事件载荷，以及对应 SQLite 迁移与 focused regression。
>
> 2026-04-23 校准说明：
> - 本次按代码、测试与当前 Console/API/WS 主链重新核对了 M11 的真实状态。
> - 结论是：`packages/console`、`runtime-server` 与 hosted 产品化链路当前阶段已经收口；M11 不再应被视为“预实现/准备态”。
> - 当前更准确的描述是：个人助理 Phase A 已形成统一活动流主链，Console 也已形成产品级闭环；下一阶段主线转向 M12 与更远期分布式增强。

### 总体状态

**从代码角度看，M0 ~ M11 当前阶段都已形成主体闭环；M8 的 Active Inference / Device Coordination、M9 的本地多 Agent 核心闭环，以及 M11 的 Console/API/WS/鉴权/持久会话浏览链路都已补齐。当前执行优先级转向 M12 与更远期分布式增强。**

- Runtime 主链路、Hosted Runtime、世界模型、设备接入、多 Agent 原语/mesh 与 Console 产品实现代码均已进入主分支。
- Hosted Runtime 的 remote eval API 现已支持 SQLite durable report persistence，server 重启后仍可查询历史 eval run；同时已补齐 Prometheus metrics export、trace export、runtime saturation snapshot、webhook retry/DLQ/HMAC/timeout、batch session creation、eval configurable parallelism、agent versioning、session sharing，以及可插拔 `logger / tracer`。
- 个人助理 Phase A 当前已具备 `IM Gateway / ConversationRouter / Web Chat / Feishu Adapter / Web Search / Web Browser / Agent 组装 / 本地配置覆盖` 等基础能力；Web Chat、飞书推送、Hosted Runtime SSE 与 Console 观察面板已经统一到原生 `Reasoner.streamText -> runtime.output` 文本流和 `runtime.status` 活动流，前端/平台侧可实时看到 `memory_retrieval / reasoning / tool_execution / response_generation / approval` 的结构化运行过程；审批恢复链路、启动时 `auto_approve` 配置、proactive 最小闭环、终态 runtime session 重开的 `conversation_handoff`、产品层 `/remember` / `/forget` / `/correct` / `/memories` 个人偏好记忆治理入口，以及 Web/Feishu/Hosted Runtime 的 focused 产品回归均已覆盖。PA-M1 本地 Web Chat 连续性约 92%，PA-M4 的用户偏好记忆最小闭环已提前落地；当前剩余主要是飞书真实平台联调、文档知识库和可监听端口环境下的更大范围端到端验证，而不是再维护第二套消息协议。
- 当前代码库 `npm run typecheck` 可通过；本地纯逻辑与大多数非 socket 测试可运行。Hosted / `runtime-server` 相关测试仍需在允许本地监听端口的环境中完成全量验证。
- 当前的 “Console” 已不再只是文档、接口契约与预实现整理；`packages/console`、`runtime-server` 的 Console 端点、鉴权、WS 订阅、持久会话浏览、Memory/World/Skill/Delegation 视图与审批审计页都已进入主链。
- 更细的里程碑判断、闭环分析和真实待办，见 [`03_code-audit-checklist.md`](03_2026-03-30_assessment/03_code-audit-checklist.md)。

### 里程碑

| Milestone | 名称 | 状态 |
|---|---|---|
| M0 | 协议与基础仓库 | ◐ 主体完成 |
| M1 | Runtime Core 最小闭环 | ✅ 完成 |
| M2 | 工具、记忆与门控 | ✅ 完成 |
| M3 | Trace、Replay、Eval | ✅ 完成 |
| M4 | SDK 与 Runtime Server | ✅ 完成 |
| M5 | 可选增强 | ◐ 主体完成 |
| M5.1 | 仲裁层升级（Meta + Workspace） | ✅ 完成 |
| M5.2 | 预测闭环（Cerebellar / World Model） | ✅ 完成 |
| M5.3 | 技能系统（Basal Ganglia / Skill） | ✅ 完成 |
| M6 | Hosted Runtime 产品化 | ✅ 核心完成 |
| M7 | 测试、CI 与发布自动化 | ✅ 核心完成 |
| M8 | 世界模型与设备接入 | ✅ 完成 |
| M9 | 多 Agent 分布式调度 | ✅ 当前阶段完成 |
| M10 | 技能强化学习 | ✅ 当前阶段 100% 完成 |
| M11 | 运营控制台（Operations Console） | ✅ 当前阶段完成 |
| M12 | 通用自主体能力 | ✅ 当前阶段完成 |
| M13 | 深层元认知与自评估 | ✅ 当前阶段完成，后续进入持续评估与策略演进 |

### 六模块完成度

| 模块 | 映射 | 完成度 | 说明 |
|---|---|---|---|
| Cortex / Reasoner | 大脑皮层 | 84% | LLM reasoner、plan/respond、OpenAI adapter 已有；`Reasoner.streamText(...)` 原生文本流主链已接入 runtime / Web Chat / Feishu / Hosted Runtime / Console，provider 侧也已补基础 chunk flush 优化；cycle 现已支持 `reasoner.plan/respond` 超时保护；`ToolGateway` 已补 transient/permanent error 区分、tool circuit breaker 与更保守的 retry 语义；`RuntimeStateStore` 写失败现在会降级留痕而不是直接炸掉主链；session retention 已补 TTL / idle expiration / LRU resident eviction；结构化流式决策、多模态和更高级推理策略未做 |
| Hippocampal / Memory | 海马体 | 99% | 四层记忆 + procedural 自动提炼已有；已修正 procedural 主链路、restore/cleanup 一致性、memory flag、生效中的 retrieval 排序与稀疏向量 rerank、working memory 协议级容量治理、provider/store 边界，以及 procedural/semantic checkpoint restore 与 store reconciliation；SQL 记忆库迁移设计、normalized SQLite store、四层记忆 persistence 接线、独立 `SqliteCheckpointStore`、`RuntimeSessionSnapshot` 与 `SessionCheckpoint` 的记忆瘦身、`defineAgent()` 默认 SQL-first 持久化路径、`SqliteRuntimeStateStore` 在 builder/runtime 两条入口的自动补齐链路、legacy SQLite/File runtime state 的显式迁移入口，以及 LongMemEval retrieval benchmark harness、recursive full-bundle loader、matrix/aggregate runner、vendored official retrieval/QA wrapper、hypothesis generation 与 full-run 脚本都已落地；working memory TTL 与 semantic negative-pattern learning 也已接入主链；runtime 已不再消费 fat runtime snapshot 的 memory/checkpoint payload；dense embedding 后端未做 |
| Cerebellar / World Model | 小脑 | 100% | 预测闭环 + device-core + world-model 已实现；当前已补齐 `ActiveInferenceEvaluator`、`SensorFusionStrategy`、`ActuatorOrchestrator`，并接入 `SimulationBasedPredictor`、CycleEngine 的 Perceive 阶段与 runtime 的 `device.orchestrate` 执行路径 |
| Amygdala / Motivation-Risk | 杏仁核 | 58% | 基础 policy/approval/budget/cost 已有；tenant/risk 级审批策略、per-tenant / per-tool rate limiting、runtime-server auth / permission gating、更强 approval reviewer identity，以及 session sharing 的 viewer/contributor/approver 角色模型已接入主链；细粒度 risk model 未做 |
| Basal Ganglia / Skill | 基底神经节 | 95% | skill 匹配-执行-提炼闭环已有；2026-04-22 已补 `RewardSignal / RewardStore / RewardComputer`、`BanditSkillPolicy`、`rl_config`、`epsilon-greedy / UCB / Thompson Sampling`、`SkillEvaluator`、deprecated/pruned 生命周期、`SkillTransferEngine`、`SkillOnlineLearner` 与 prioritized replay；随后继续补齐了迁移 skill 去重、验证期递减与失败回退、基于 TTL 的自动裁剪、基于真实 `cycle / latency / token` 的效率奖励、`exact -> operational -> family -> global` 分层上下文 bandit，以及 reward `metrics / baseline_metrics` 持久化和结构化 RL 事件。当前 M10 阶段已 100% 收口；模块层面只剩更长期的训练数据运营和更强训练基础设施 |
| Prefrontal / Meta | 前额叶 | 100% | 轻量门控、多维评分、冲突检测、prediction error 消费已有；2026-04-14 已落地 `MetaSignalBus`、`FastMonitor`、结构化 `MetaAssessment / SelfEvaluationReport`、`WorkspaceSnapshot.metacognitive_state` 与 trace 接线；随后补齐 `DeepEvaluator`、`VerificationTrace`、`MetaDecisionV2` 与 `ControlAllocator` 单真源控制平面，并将 `DefaultMetaController` 收薄为 adapter；2026-04-15 已完成 calibration closure：`Calibrator` 具备 `query + calibrate + record` 单一路径，`InMemoryCalibrationStore / SqliteCalibrationStore`、task bucket、决策前 bucket reliability 查询与执行后写回已接入主链，`DeepEvaluator` 私有校准已移除，allocator 也开始显式消费低 calibration reliability 作为保守化信号；随后完成 `DeepEvaluator SPI` 第一版：默认 `logic / evidence / tool / safety / process` verifiers 与可选 `CounterfactualSimulator SPI` 已进入主链，`DeepEvaluator` 只负责按 trigger tags 选 verifier、并发运行、聚合 `VerificationTrace` 并在 verifier 部分失败时降级返回；2026-04-16 已完成 `MetaSignalBus` family-provider 第一版：`task / evidence / reasoning / prediction / action / governance` 六类 `Heuristic*Provider`、provider registry、family merge rules、degraded/fallback provenance 与关键缺失值保守化已进入代码库，缺失 prediction family 时下游不会继续判成 `routine-safe`；同日补齐 `meta-benchmark` case bundle、summary/persistence runner、summary diff、`.neurocore/benchmarks/meta/` 输出以及独立 `meta-stack` CI lane 与 benchmark artifact 上传；2026-04-19 已完成 predictor-level calibration profiles、`MetaSignalProviderReliabilityStore`（内存/SQLite）、`MetaSignalBus.provider_profiles`、provider reliability penalty，以及 `DeepEvaluator` 的 per-verifier budgets / fail-open-fail-closed isolation；2026-04-20 已完成 `ReflectionLearner`（内存/SQLite）、trace 中的 `applied_reflection_rule / created_reflection_rule`、基于 `EvalRunReport` 的 online meta eval pipeline、coverage-vs-accuracy / risk-conditioned curves 导出、`examples/demo-meta-online-eval.mjs` 与 recurrence regression tests，当前阶段收口完成 |
| Global Workspace | 全局工作空间 | 80% | broadcast-compete-select 竞争机制已实现 |

### 当前执行顺序

- **已完成**：SDK / Protocol Tightening
  - 当前阶段已收口完成：`RuntimeCommand` 判别字段、`SessionCheckpoint.schema_version`、受限 `CreateSessionCommand.overrides`、`PolicyDecision.severity`、完全判别的 `NeuroCoreEvent`、缺失命令/事件、事件 `sequence_no`、builder `validate()/build()`、重复注册拒绝、`configurePolicy()` / `configureApprovalPolicy()`、shared `SessionHandleLike`、local/remote `checkpoint/replay/waitForSettled` 对齐，以及 remote trace/episode/event pagination、`AbortSignal` 超时、429/503 重试和 SSE `Last-Event-ID` 重连。
- **已完成**：Core Gaps / Meta 后半段 / Operational Maturity
  - `ToolGateway` 结果缓存、TTL、namespace invalidation、content filtering、结构化 `ask_user`、multi-turn conversation、token streaming semantics、preconditions、parallel tools、delegate 闭环、conditional planning、multimodal skeleton、provider-level calibration、verifier isolation/budget、provider reliability、online meta eval、`ReflectionLearner`、webhook retry/DLQ/HMAC/timeout、batch session creation、eval configurable parallelism、agent versioning、session sharing，以及可插拔 `logger / tracer` 都已进入主链。
- **下一阶段**：更远期分布式增强 / 记忆系统后续演进 / 更长期自治学习基础设施
  - `M12` 当前阶段已收口完成；后续不再是补当前里程碑缺口，而是进入更远期的自治集群、分布式 shared state、更强 continual learning 与自治运营能力。

### M11 当前交付

- Console API 基础层已统一：`BASE_URL` 路径重复、response envelope 与前端类型错位已收口。
- `runtime-server` 已补齐 `auth/me`、goals、working/semantic memory、skills、world-state、devices、delegations 等 Console 主视图端点。
- WS 订阅已完成鉴权、断线重连与重新订阅；前端不再依赖未鉴权的临时连接。
- Session/Approval 列表已支持持久会话与历史审批聚合，不再只依赖当前进程内存态。
- Dashboard、Session、Memory、Approval、Multi-Agent、Config 页面对接已进入主链；M11 当前阶段按设计目标收口完成。

### 真实待办（代码反推）

- P0：`SDK / Protocol Tightening` 当前阶段已完成，后续只在新需求进入时做增量收紧，不再作为独立缺口跟踪。
- P0：Core Gaps 这一轮已完成，当前已覆盖 `structured ask_user / tool cache / content filtering / multi-turn conversation / token streaming semantics / delegate closure / conditional planning / multimodal skeleton`。
- P0：Operational Maturity 当前阶段已完成，当前已覆盖 webhook retry/DLQ/HMAC/timeout、batch session creation、eval configurable parallelism、agent versioning、session sharing，以及可插拔 `logger / tracer` 与 `trace_enabled / event_stream_enabled` gating。
- P0：M8 / M9 当前阶段已完成；当前已补齐 `ActiveInferenceEvaluator`、`SensorFusionStrategy`、`ActuatorOrchestrator`、WS 启动接线、registry lifecycle 事件、`TaskDelegator.getStatus()`、goal/shared-state conflict 记录、coordination strategy registry、child-process/remote lifecycle mode 与 graceful terminate/save-state。
- P1：Meta 后半段当前阶段已收口完成，后续只保留长期趋势分析、在线学习策略和更强 policy adaptation，不再作为当前阶段主阻塞。
- P1：`M10 / 技能强化学习` 当前阶段已 100% 收口，当前实现已包含 reward/policy/exploration/evaluation/transfer/online learner 全链路、FR-47/48 闭环细节、基于真实 `cycle / latency / token` 的效率奖励、reward `metrics / baseline_metrics` 持久化、FR-45 的分层上下文 bandit，以及结构化 RL 事件；后续只保留更长期的训练数据运营、策略趋势分析和更强训练基础设施，不再作为当前阶段主阻塞。
- P1：在允许本地端口监听的环境中补跑 hosted / WS 相关更大范围回归验证。
- P1：记忆系统代码专项审计项已收口，后续转入记忆演进阶段的能力增强，不再按“现有实现缺陷”跟踪。
- P2：进入 `docs/05_2026-04-01_memory-evolution/`，收敛五层记忆系统迁移方案；当前已完成 SQL 记忆库迁移设计、normalized store、四层记忆的 SQLite persistence 接线、独立 `SqliteCheckpointStore`、`RuntimeSessionSnapshot` 与 `SessionCheckpoint` 的记忆瘦身、`defineAgent()` 默认 SQL-first 持久化路径、`SqliteRuntimeStateStore` 在 builder/runtime 两条入口的自动补齐链路、legacy SQLite/File runtime state 的显式迁移入口、SQL-first validator、Console Memory Observability，以及 LongMemEval retrieval benchmark harness、recursive full-bundle loader、matrix/aggregate runner、memory system benchmark 聚合入口、vendored official retrieval/QA wrapper、hypothesis generation 与 full-run 脚本；runtime 已不再消费 fat runtime snapshot 的 memory/checkpoint payload；参数层已取消为当前路线非目标，个人助理显式记忆交互已补 `/remember` / `/forget` / `/correct` / `/memories`；下一步继续推进官方全量数据基线跑数。
- P2：`docs/06_2026-04-14_metacognition-evolution/04_code-first-implementation-tasklist.md` 的当前阶段已全部收口；后续转入持续评估、趋势分析和策略演进，而不是补当前设计缺口。

### 当前阶段边界（暂不投入）

- 分布式 Bus 实现（Redis/NATS）、去中心化注册（gossip/DHT）、runtime-server 多 Agent 管理 API（FR-35）
- 图数据库后端、更强的 CRDT/多副本冲突解决、DistributedTracer 跨 Agent span 管理
- 深层元认知与自评估的实现主线
- 通用 AGI 式自主体能力

---

## 命名规则

- 目录：`<阶段序号>_<日期>_<主题>`
- 文件：`<顺序>_<主题>.md`
- 日期统一采用 `YYYY-MM-DD`
