# NeuroCore 里程碑交付记录（历史修订版）

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档保留为阶段性评估记录。
>
> 2026-04-02 校准说明：
> - M8 世界模型 / 设备接入当前阶段已完全收口；`ActiveInferenceEvaluator`、`SensorFusionStrategy`、`ActuatorOrchestrator` 及其 runtime 接线已进入主链。
> - M9 多 Agent 调度当前阶段也已收口完成；registry lifecycle 事件、`TaskDelegator.getStatus()`、goal/shared-state conflict 记录、coordination strategy registry、child-process/remote lifecycle mode 与 graceful terminate/save-state 已补齐，剩余仅保留更远期的分布式与生产化增强。
> - 2026-04-23 校准：M11 运营控制台当前阶段已完成，`packages/console`、`runtime-server` 的 Console 端点、鉴权、WS 订阅、持久会话浏览和多视图页面均已进入主链。
> - 当前执行顺序已从“个人助理产品线 + Console 相关准备”切到：`M12 / 更远期分布式增强 / 记忆系统后续演进`。
> - 因此，下文中的“已完成”现在包含 M11 当前阶段交付，而不是仅指 Hosted/Runtime 内核。
> - 更精确的代码反推结论见 [`03_code-audit-checklist.md`](./03_code-audit-checklist.md)。
> - 2026-04-14 补充：Prefrontal / Meta 的代码现状已确认仍属“轻量门控”，深层自评估设计见 [`../06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md`](../06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md)。
> - 2026-04-20 补充：`SDK / Protocol Tightening` 已收口完成，当前交付包含判别化 `RuntimeCommand`、`SessionCheckpoint.schema_version`、受限 overrides、`PolicyDecision.severity`、完全判别的 `NeuroCoreEvent`、缺失命令/事件、事件 `sequence_no`、builder `validate()/build()`、重复注册拒绝、`configurePolicy()` / `configureApprovalPolicy()`、shared `SessionHandleLike`、local/remote `checkpoint/replay/waitForSettled` 对齐，以及 remote trace/episode/event pagination、`AbortSignal` 超时、429/503 重试和 SSE `Last-Event-ID` 重连。第二批与第三批 Core Gaps 也已收口：`ToolGateway` 已补 `idempotency_key` 结果缓存、TTL 与 namespace-based invalidation，`PolicyProvider.evaluateInput / evaluateOutput` 已进入主链，input/output screening 已能真正影响 cycle / response，`ask_user` 已具备结构化 prompt schema 透传与 resume 前输入校验能力，多轮会话历史、role-annotated conversation buffer、token-aware truncation、conversation summary 与 conversational token counting 已进入 runtime / reasoner 主链，`runtime.output` 也已显式区分 `token_stream / buffered` 语义；同时 `CandidateAction.preconditions`、parallel tools fork/join、delegate 子会话闭环、conditional planning 的 fallback/DAG plan graph，以及 typed content parts + MIME-aware observation/tool result skeleton 已进入主链。
> - 2026-04-22 补充：Operational Maturity 当前阶段已收口完成。当前交付包含 webhook retry/backoff、DLQ、HMAC signature、timeout、batch session creation、eval configurable parallelism、agent versioning、session sharing（viewer / contributor / approver）、serialized session operations、custom `logger / tracer` SPI，以及 `ObservabilityConfig.trace_enabled / event_stream_enabled` 的 API gating。
> - 2026-04-22 补充：`M10 / 技能强化学习` 当前阶段已收口完成。当前交付包含 `RewardSignal / RewardStore / RewardComputer`、`BanditSkillPolicy`、`rl_config`、`epsilon-greedy / UCB / Thompson Sampling`、`SkillEvaluator`、deprecated/pruned 生命周期、`SkillTransferEngine`、`SkillOnlineLearner` 与 prioritized replay，以及 reward/policy/exploration/evaluation/transfer 事件和 SQLite 持久化。
> - 2026-04-22 再补充：`M10 / 技能强化学习` 已补齐 FR-47 / FR-48 的实现细节：迁移 skill 现在会做去重、验证期递减与 penalty 清除、验证失败自动回退；技能评估现在也支持基于 TTL 的自动裁剪，不再只在 deprecated 后再裁剪。
> - 2026-04-23 再补充：`M10 / 技能强化学习` 已补齐 FR-45 的最小上下文化策略实现：`BanditSkillPolicy` 当前已按 `goal_type / domain / action_type / tool_name / risk_level` 维护 contextual state，并与全局 state 双层并存；当前实现是 contextual bandit，不是完整神经策略网络。
> - 2026-04-23 再补充：`M10 / 技能强化学习` 已继续增强两点：`RewardComputer` 的效率维度已改为基于真实 `cycle / latency / token` 统计；`BanditSkillPolicy` 已从单层 exact-context 升级为 `exact -> operational -> family -> global` 的分层上下文 bandit。
> - 2026-04-23 最终校准：`M10 / 技能强化学习` 当前阶段已 100% 收口；当前又补齐了 reward `metrics / baseline_metrics` 持久化、基于历史 reward 的相对效率基线，以及 `policy.updated / exploration.triggered / skill.transferred / skill.pruned` 的结构化事件载荷和对应 SQLite schema 迁移。
> - 2026-04-24 补充：`docs/05_2026-04-01_memory-evolution/07_next-generation-memory-system-implementation-plan.md` 当前阶段已按 Phase 0 ~ 6 完成。当前交付包含正式 `Episode` 真相层字段与 SQL-first 持久化、`Memory Gate + Recall Bundle`、card-first `SemanticCard`、正式 `ProceduralSkillSpec`、episode tombstone/suspect/rollback 的派生对象传播，以及 `memory-objective-benchmark / memory-causal-regression` 两条确定性评测。
> - 2026-04-24 补充：`M12 / 通用自主体能力` 当前已补齐代码优先实施总计划，见 [`../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md`](../09_2026-04-24_autonomy-implementation/01_m12-code-first-implementation-plan.md)。
> - 2026-04-24 再补充：`M12` 当前阶段已收口完成。当前交付包含 `Phase 0 ~ Phase 6`：协议冻结、自治状态面、planner、self-monitor、intrinsic motivation、自生成目标、transfer/continual、六模块自治增强、alignment/trace/audit，以及 autonomy benchmark summary 与 focused regression。
> - 2026-04-25 补充：个人助理 `PA-M1` Web Chat 连续性完成度提升到约 92%；`ConversationRouter` 已在终态/空闲 runtime session 重开时生成 `conversation_handoff`，把同一 chat 的最近对话注入新 session 初始输入 metadata，修复短指代上下文断裂问题。
> - 2026-04-25 记忆系统 P1 补充：`runMemorySystemBenchmark()` / `examples/demo-memory-system-benchmark.mjs` 已形成 retrieval + objective + causal 的统一评测入口；`validateSqlFirstRuntimeState()` 已形成 SQL-first runtime state 兼容验证入口。
> - 2026-04-25 个人助理记忆补充：显式个人偏好记忆已进入产品主链，支持 `/remember`、`/forget`、`/correct`、`/memories`，并在普通消息中注入 `input.metadata.personal_memory`。
> - 2026-04-26 记忆评测补充：LongMemEval full dataset 稳定跑法已补齐。`tools/longmemeval-prepare-bundle.py` 负责 official bundle 分片、hash 与 manifest；`examples/demo-longmemeval-stable-benchmark.mjs` 负责 shard 级 matrix 跑数与 combined summary；OpenAI-compatible config 支持 `extraBody`，QA/generation 路径可透传 `enable_thinking=false`。
> - 2026-04-26 记忆检索补充：episodic retrieval 已补 stopword-aware sparse scoring、query/phrase coverage、BM25 rerank、role preference、金额/数量事实形态 boost、targeted query expansion 与候选 score 缓存；LongMemEval session ingestion 已补 full / user / assistant / lead-user / preference / fact 多视图。LongMemEval stable session 3-shard 当前验证达到 non-abstention `420`、R@5 `1.0000`、R@10 `1.0000`、MRR `0.9441`；当前优化版 session full baseline 为 non-abstention `1410`、R@5 `0.9574`、R@10 `0.9766`、MRR `0.8964`，其中 `longmemeval_s_cleaned` R@5 `0.9787`、R@10 `0.9915`。
> - 2026-04-25 Console 记忆可观测性补充：runtime-server memory endpoint 已暴露 retrieval plan、recall bundle 和 memory warnings；Console Memory Inspector 已新增 Observability tab。

## 完成度

| 参照基准 | 完成度 |
|---|---|
| MVP 定义（`06_mvp-implementation-plan.md`） | ~100% |
| 第一阶段 FR 清单（`01_requirements.md`） | ~98% |
| 六模块完整目标（`04_neurocore-agent-architecture-full.md`） | ~85%~90% |

## 已完成或主体已实现的里程碑

| Milestone | 名称 | 状态 | 核心交付物 |
|---|---|---|---|
| M5.1 | 仲裁层升级 | ✅ | `WorkspaceCoordinator` broadcast-compete-select + `MetaController` 多维评分/冲突检测 |
| M5.2 | 预测闭环 | ✅ | `PredictionStore` + `PredictionErrorComputer` + `RuleBasedPredictor` + MetaController error rate 消费 |
| M5.3 | 技能系统 | ✅ | `SkillExecutor` + `ProceduralMemoryProvider` + episode → skill 自动提炼 + skill-first 路径 |
| M6 | Hosted Runtime 产品化（核心） | ✅ | HTTP API + async/stream + SSE + webhook（retry/DLQ/HMAC/timeout）+ file/SQLite 持久化 + remote client + auth/config/audit/metrics 基础设施 + batch session creation + eval parallelism + agent versioning + session sharing + logger/tracer SPI |
| M7 | 测试、CI 与发布（核心） | ✅ | GitHub Actions CI + test 分层 + baseline-llm gated lane + changesets/release workflow |
| M8 | 世界模型与设备接入 | ✅ | `device-core`（Sensor/Actuator SPI + Registry + Pipeline + SensorFusionStrategy + ActuatorOrchestrator）+ `world-model`（WorldStateGraph + ForwardSimulator + ActiveInferenceEvaluator）+ CycleEngine Perceive/Simulate/Act 路径 |
| M9 | 多 Agent 分布式调度 | ✅ | `multi-agent`（Registry + lifecycle events + Bus + Delegator + status tracking + Coordination registry + SharedState conflict records + Lifecycle child-process/remote mode）+ CycleEngine delegate 分支 |
| M10 | 技能强化学习 | ✅ | `RewardSignal / RewardStore / RewardComputer` + hierarchical contextual `BanditSkillPolicy` + `rl_config` + exploration strategies + `SkillEvaluator` + transfer engine + online learner + reward metrics/baseline persistence + structured RL events |

## 当前执行优先级

| 阶段 | 工作流 | 当前状态 |
|---|---|---|
| 已完成 | SDK / Protocol Tightening | 当前阶段已收口完成：判别化 `RuntimeCommand`、`SessionCheckpoint.schema_version`、受限 overrides、`PolicyDecision.severity`、完全判别的 `NeuroCoreEvent`、缺失命令/事件、事件 `sequence_no`、builder `validate()/build()`、重复注册拒绝、`configurePolicy()` / `configureApprovalPolicy()`、shared `SessionHandleLike`、local/remote `checkpoint/replay/waitForSettled` 对齐，以及 remote trace/episode/event pagination、`AbortSignal` 超时、429/503 重试和 SSE `Last-Event-ID` 重连 |
| 已完成 | Core Gaps | 这一批已收口完成：`structured ask_user / tool cache / content filtering / multi-turn conversation / conversation summary / token streaming semantics / delegate closure / conditional planning branching+DAG / multimodal skeleton` 全部进入主链 |
| 已完成 | Meta 后半段 | 当前阶段已完成 `provider-level calibration -> verifier isolation / budget -> provider reliability -> online meta eval -> curve export -> ReflectionLearner`，后续转入持续趋势分析与策略演进 |
| 已完成 | Operational Maturity | 当前阶段已完成 webhook retry/DLQ/HMAC/timeout、batch session creation、eval parallelism、agent versioning、session sharing、logger/tracer SPI 与 observability gating |
| 已完成 | M10 / Skill RL | 当前阶段已 100% 完成，已覆盖 reward/policy/exploration/evaluation/transfer/online learner 全链路、基于真实 `cycle / latency / token` 的效率奖励、reward metrics/baseline persistence、FR-45 分层上下文 bandit，以及 FR-47/48 闭环细节；后续只保留更长期的训练运营与策略演进 |

## 已实现核心能力

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core`
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标
- **记忆四层**：working + episodic + semantic + procedural，tenant-scoped cross-session recall
- **预算与压缩**：token/tool/cycle/cost budget assessment、token accounting、cost budget tracking、graded context compression，以及 tenant/risk 级审批策略与 per-tenant / per-tool rate limiting
- **托管 Runtime**：HTTP API、async/stream、SSE、webhook（重试 + DLQ + HMAC + timeout + 投递日志）、文件/SQLite 持久化、远程 client（超时 + 重试）、batch session creation、eval parallelism、agent versioning、session sharing 与可插拔 `logger / tracer`
- **治理与租户**：runtime-server 已具备 API key auth、request-time permission gating、tenant isolation，以及带 reviewer identity 的 approval audit
- **可观测性**：runtime-server 已具备 structured JSON logs、可插拔 `logger / tracer`、`/v1/metrics` + Prometheus export、trace export 与 runtime saturation snapshot，且 `trace_enabled / event_stream_enabled` 已开始真正影响 traces/events API 暴露
- **Runtime Hardening**：cycle 现已支持 `reasoner.plan/respond` 与 memory/skill/policy/predictor provider 超时保护，单点慢调用不再拖死整轮执行
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay、eval 持久化（含 runtime-server SQLite durable reports）、baseline eval cases 共享模块
- **世界模型与设备**：Perception Pipeline、Device Registry、WorldStateGraph、ForwardSimulator、SimulationBasedPredictor、ActiveInferenceEvaluator、SensorFusionStrategy、ActuatorOrchestrator
- **多 Agent**：Agent Registry、Inter-Agent Bus、Task Delegator（含状态跟踪）、Coordination Strategies + Registry、Shared State（含 conflict records）、Lifecycle Manager（含 child-process/remote mode）
- **技能强化学习**：`RewardSignal / RewardStore / RewardComputer`、`BanditSkillPolicy`、`rl_config`、`epsilon-greedy / UCB / Thompson Sampling`、`SkillEvaluator`、deprecated/pruned 生命周期、`SkillTransferEngine`、`SkillOnlineLearner` 与 prioritized replay
- **运营控制台产品实现**：Dashboard / Session / Trace / Goal / Memory / Workspace / Eval / Approval / Multi-Agent / World Model / Device / Config 页面及对应 Zustand store，配套 REST/WS/鉴权链路已接通

## 当前收尾项（截至 2026-04-02）

- 个人助理 Phase A 已落地 IM Gateway、Web Chat、飞书 Adapter、搜索/浏览器连接器和 Agent 组装；当前 Web Chat / Feishu / Hosted Runtime / Console 已完成原生 `streamText -> runtime.output` 文本流和 `runtime.status` 活动流对齐，Web Chat 已补终态 runtime session 重开的 `conversation_handoff`，显式个人偏好记忆已补 `/remember` / `/forget` / `/correct` / `/memories` 与 runtime metadata 注入，Focused 回归已覆盖审批恢复、`auto_approve`、proactive、Web Chat、终态 session 上下文 handoff、个人记忆命令、个人记忆注入、飞书消息转发与 Hosted Runtime SSE；收口重点转向飞书真实平台联调、文档知识库与更大范围端到端稳定性验证。
- Console API 基础层、鉴权与 WS 订阅链路当前阶段已收口：`/v1/v1/*` 路径重复、`auth/me` 缺失、未鉴权 WS 连接、若干 response shape 错位，以及 `world-state / memory / memory observability / skills / devices / delegations / goals` 端点缺口均已修正。
- `runtime-server` 现在可聚合持久会话和历史审批，Console 不再只依赖当前进程的内存态 session。
- 多 Agent 的 `delegate` 结果回流已与 runtime 主链收口；后续仅保留远程/多实例调度层增强，不再影响当前阶段 M9 完成口径。
- `docs/05_2026-04-01_memory-evolution/` 当前已不只是迁移设计阶段。现已完成 SQL 记忆库迁移设计、normalized SQLite store、四层记忆的 SQLite persistence 接线、独立 `SqliteCheckpointStore`、`RuntimeSessionSnapshot` 与 `SessionCheckpoint` 的记忆瘦身、默认 SQL-first 持久化路径、legacy SQLite/File runtime state 的显式迁移入口、SQL-first validator、Console Memory Observability，以及 LongMemEval retrieval benchmark harness、recursive full-bundle loader、matrix/aggregate runner、memory system benchmark 聚合入口、vendored official retrieval/QA wrapper、hypothesis generation、large-file shard prepare 与 stable full-run 脚本；随后继续完成了 `06/07` 的正式对象实施：正式 `Episode` 真相层、`Memory Gate + Recall Bundle`、`SemanticCard / ProceduralSkillSpec`、治理传播、`memory-objective-benchmark` 与 `memory-causal-regression`。2026-04-26 已继续把 episodic sparse retrieval 从单一余弦/coverage 提升到 session multi-view + stopword-aware cosine + query/phrase coverage + BM25 rerank + role/fact-shape signals + targeted query expansion，并固化 LongMemEval session full retrieval baseline：full combined R@5 `0.9574`、R@10 `0.9766`，LongMemEval-S R@5 `0.9787`、R@10 `0.9915`。2026-04-25 路线校准后，参数层取消为当前非目标，`parametric_unit_refs` 只保留为历史兼容字段且不再汇聚到 Recall Bundle。后续保留项收缩为 dense/embedding backend 对照、reader/QA evaluator 闭环和后续 schema 演进。
- Runtime Hardening 新收口：`ToolGateway` 已补 transient/permanent error 区分、tool circuit breaker 与更保守的 retry 行为；`RuntimeStateStore` 写失败会转为 degraded persistence status + `runtime.status` 事件，而不是直接中断 session 主链；`SessionManager` 与 `AgentRuntime` 已补 session TTL / idle expiration / resident LRU eviction。
- 2026-04-22 已完成 `M10 / 技能强化学习`：skill 主链已补 `RewardSignal / RewardStore / RewardComputer`、`BanditSkillPolicy`、`rl_config`、探索-利用策略、技能评估与裁剪、迁移学习、online learner、prioritized replay，以及 reward/policy/exploration/evaluation/transfer 事件与 SQLite 持久化；`ProceduralMemoryProvider.retrieve()` 已从固定分数切到 learned policy selection，并保持 `rl_config` 未配置时回退到原阈值/静态行为。随后继续补齐了迁移 skill 去重、验证期递减与失败回退、基于 TTL 的自动裁剪语义、基于真实 `cycle / latency / token` 的效率奖励、FR-45 的分层上下文 bandit（`exact -> operational -> family -> global`），以及 reward `metrics / baseline_metrics` 持久化和结构化 RL 事件。当前阶段已 100% 收口。
- Prefrontal / Meta 当前阶段已完成从轻量门控到深层自评估 v1 的收口：控制平面单真源、calibration 单路径/持久化、DeepEvaluator SPI、Signal Bus provider 化、provider-level calibration、provider reliability scoring、online meta eval、曲线导出与 `ReflectionLearner` 均已进入代码库；后续只保留趋势分析与长期策略演进。
- 2026-04-14 已进一步形成代码实施单：`docs/06_2026-04-14_metacognition-evolution/04_code-first-implementation-tasklist.md`，下一步可直接进入协议与 runtime 主链改造。
- 2026-04-14 已完成第一批实现：`MetaSignalBus`、`FastMonitor`、结构化 `MetaAssessment / SelfEvaluationReport`、`WorkspaceSnapshot.metacognitive_state` 与 `CycleTraceRecord` 元认知字段已进入代码库。
- 2026-04-14 已完成第二批收口：`DeepEvaluator`、`VerificationTrace`、经 deep eval 校准后的 `MetaAssessment`，以及 `DefaultMetaController` 对 `request-more-evidence / switch-to-safe-response / execute-with-approval / abort` 的安全消费已进入代码库；下一步转向 `Calibrator`、`ReflectionLearner` 与更完整的 meta eval。
- 2026-04-14 已完成第三批最小闭环：`Calibrator`、`CalibrationRecord` 与 trace/runtime 接线已进入代码库，执行后 outcome 已开始沉淀为校准样本；下一步转向 `ReflectionLearner`、更完整的 `MetaControlAction` 消费与 meta eval。
- 2026-04-14 根据外部子稿《工程子稿一：Fast Monitor + Deep Evaluator 决策表与伪代码》进一步增强：`FastMonitor` 已升级为标签化 V2，补齐 `trigger_tags`、显式置信度权重、`simulation-unreliable` 的 deep-eval 触发、预算紧张下的高成本动作抑制；`DeepEvaluator` 已按触发标签路由子检查器并收紧动作建议表。
- 2026-04-14 根据外部子稿《工程子稿二：Meta Signal Bus 字段与聚合规则逐项说明》进一步增强：`MetaSignalBus` 已补 `goal_id`、`MetaSignalProvenance`、`predictor_error_rate / predictor_bucket_reliability`、更细粒度 `budget_pressure`、更保守的 `evidence_freshness` 与 `source_reliability_prior` 聚合规则。
- 2026-04-14 根据外部子稿《工程子稿三：Meta Benchmark——如何量化“知道自己不知道”》进一步实现：`@neurocore/eval-core` 已新增 `meta-benchmark.ts`，覆盖 `ECE / Brier / Overconfidence Failure Rate`、`FastMonitor` 专项指标、`DeepEvaluator` 专项指标、`ControlAllocator` 专项指标、`Risk Gating / Evidence Sensitivity / Learning Reflection` 七组评分输出，并补了 focused tests。
- 2026-04-15 路线收口调整：Prefrontal / Meta 下一阶段不再以“继续横向加模块”为主，而改为五条收口主线：`控制平面单真源`、`calibration 单路径与持久化`、`DeepEvaluator SPI 化`、`MetaSignalBus provider 化`、`真实 meta benchmark 数据集与 online eval`。
- 2026-04-15 M8.5 Phase 2 补充：`ControlAllocator` 已成为最终控制动作单真源，`DefaultMetaController` 已瘦身为 adapter；`Calibrator` 已升级为 `query + calibrate + record` 单一路径，`SqliteCalibrationStore`、task bucket、决策前 bucket reliability 查询与执行后写回均已进入代码库；下一步严格转向 `DeepEvaluator SPI 化`，不提前做 provider 化和 learner 扩展。
- 2026-04-15 M8.5 Phase 3 补充：`DeepEvaluator` 已切到 `Verifier SPI` 编排层，默认 `logic / evidence / tool / safety / process` verifiers 与可选 `CounterfactualSimulator SPI` 已进入主链，支持并发执行、部分失败降级和 budget-aware 选择；下一步严格转向 `MetaSignalBus provider 化`。
- 2026-04-16 M8.5 Phase 4 补充：`MetaSignalBus` 已完成 family-provider 第一版，`task / evidence / reasoning / prediction / action / governance` 六类 `Heuristic*Provider`、provider registry、family merge rules、degraded/fallback provenance 与关键缺失值保守化已进入代码库；provider 失败时总线仍可产出 frame，缺失 prediction family 时下游不会继续判成 `routine-safe`；下一步严格转向真实 meta benchmark 数据集与 CI/online eval。
- 2026-04-16 M8.5 Phase 5 第一批补充：`@neurocore/eval-core` 已补 `MetaBenchmarkBundle`、summary API、human-readable summary formatter、summary diff 与 benchmark artifacts builder；仓库已新增 families A~G 的本地 case bundle、`examples/demo-meta-benchmark.mjs`、`examples/demo-meta-benchmark-compare.mjs`、`.neurocore/benchmarks/meta/` 持久化输出，以及 GitHub Actions 中独立 `meta-stack` lane 与 benchmark artifact 上传；随后进入 online meta eval 收口。
- 2026-04-20 M8.5 Phase 5 第二批补充：`ReflectionLearner`、`InMemoryReflectionStore / SqliteReflectionStore`、trace 中的 `applied_reflection_rule / created_reflection_rule`、`@neurocore/eval-core` 的 `meta-online-eval.ts`、coverage-vs-accuracy / risk-conditioned curve export、`examples/demo-meta-online-eval.mjs` 与 recurrence regression suite 已进入代码库；`Meta 后半段` 当前阶段收口完成。

## 关键风险（历史记录）

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级破坏现有闭环 | 新模块/新策略路径落地 + test harness 回归 |
| session-level lock/CAS 影响 resume/approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 兼容性 | 保留内存 fallback + 增量接入 |
| 当前工作流过多并行导致优先级分散 | 先收口 M11，再进入 M12 与更远期分布式增强 |
| Console 联调暴露接口契约漂移 | 当前阶段已通过统一 API 基础层、类型、鉴权和 WS 契约收口；后续只保留更大范围真实环境联调 |
