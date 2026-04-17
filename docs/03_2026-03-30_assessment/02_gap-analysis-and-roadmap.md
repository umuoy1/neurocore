# NeuroCore 里程碑交付记录（历史修订版）

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档保留为阶段性评估记录。
>
> 2026-04-02 校准说明：
> - M8 世界模型 / 设备接入已形成主链路闭环。
> - M9 多 Agent 调度原语已进入主干，但 delegate 续跑闭环仍待补。
> - M11 运营控制台已具备方案、REST 端点与 Console 预实现，但当前不作为主优先级推进。
> - 当前执行顺序调整为：个人助理产品线 + Console 相关准备 → 记忆系统演进 → 未来再恢复 M11 完整实施。
> - 因此，下文中的“已完成”表示“该阶段的主体交付已进入代码库”，不表示所有 hosted / Console 端到端验证都已结束。
> - 更精确的代码反推结论见 [`03_code-audit-checklist.md`](./03_code-audit-checklist.md)。
> - 2026-04-14 补充：Prefrontal / Meta 的代码现状已确认仍属“轻量门控”，深层自评估设计见 [`../06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md`](../06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md)。
> - 2026-04-18 补充：当前实施顺序已切到 `SDK / Protocol Tightening -> Core Gaps -> Meta 后半段`；第一批 SDK / Protocol 收口已完成，包含判别化 `RuntimeCommand`、`SessionCheckpoint.schema_version`、受限 overrides、`PolicyDecision.severity`、完全判别的 `NeuroCoreEvent`、缺失命令/事件、事件 `sequence_no`、remote client `AbortSignal` 超时/429+503 重试/SSE `Last-Event-ID` 重连，以及 local/remote session handle 的基础对齐。第二批 Core Gaps 已继续收口：`ToolGateway` 已补 `idempotency_key` 结果缓存、TTL 与 namespace-based invalidation，`PolicyProvider.evaluateInput / evaluateOutput` 已进入主链，input/output screening 已能真正影响 cycle / response，`ask_user` 已具备结构化 prompt schema 透传与 resume 前输入校验能力，多轮会话历史、role-annotated conversation buffer、token-aware truncation 与 conversational token counting 也已进入 runtime / reasoner 主链，`runtime.output` 现在也显式区分 `token_stream / buffered` 语义；同时第三批已开始收口，`CandidateAction.preconditions` 已在执行前真实校验，不再只是协议字段。

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
| M6 | Hosted Runtime 产品化（核心） | ✅ | HTTP API + async/stream + SSE + webhook + file/SQLite 持久化 + remote client + auth/config/audit/metrics 基础设施 |
| M7 | 测试、CI 与发布（核心） | ✅ | GitHub Actions CI + test 分层 + baseline-llm gated lane + changesets/release workflow |
| M8 | 世界模型与设备接入 | ✅ | `device-core`（Sensor/Actuator SPI + Registry + Pipeline）+ `world-model`（WorldStateGraph + ForwardSimulator）+ CycleEngine Perceive 阶段 |
| M9 | 多 Agent 分布式调度 | ◐ | `multi-agent`（Registry + Bus + Delegator + Auction + Coordination + SharedState + Lifecycle）+ CycleEngine delegate 分支 |

## 当前执行优先级

| 阶段 | 工作流 | 当前状态 |
|---|---|---|
| 当前 | SDK / Protocol Tightening | 第一批已完成：判别化 `RuntimeCommand`、`SessionCheckpoint.schema_version`、受限 overrides、`PolicyDecision.severity`、完全判别的 `NeuroCoreEvent`、缺失命令/事件、事件 `sequence_no`、remote client `AbortSignal` 超时/429+503 重试/SSE `Last-Event-ID` 重连，以及 local/remote session handle 的基础对齐；下一步继续 builder validation、shared session-handle interface、remote pagination |
| 下一阶段 | Core Gaps | 当前已完成 `structured ask_user / tool cache / content filtering / multi-turn conversation / token streaming semantics` 基础收口，且 `CandidateAction.preconditions` 已开始在执行前真实生效；下一步继续做 parallel tools、delegate 闭环、conditional planning 的 branching/DAG、多模态输入骨架 |
| 更后阶段 | Meta 后半段 | 在前两批收口后，按 `provider-level calibration -> verifier isolation / budget -> provider reliability -> online meta eval -> ReflectionLearner` 推进 |

## 已实现核心能力

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core`
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标
- **记忆四层**：working + episodic + semantic + procedural，tenant-scoped cross-session recall
- **预算与压缩**：token/tool/cycle/cost budget assessment、token accounting、cost budget tracking、graded context compression，以及 tenant/risk 级审批策略与 per-tenant / per-tool rate limiting
- **托管 Runtime**：HTTP API、async/stream、SSE、webhook（重试 + 投递日志）、文件/SQLite 持久化、远程 client（超时 + 重试）
- **治理与租户**：runtime-server 已具备 API key auth、request-time permission gating、tenant isolation，以及带 reviewer identity 的 approval audit
- **可观测性**：runtime-server 已具备 structured JSON logs、`/v1/metrics` + Prometheus export、trace export 与 runtime saturation snapshot
- **Runtime Hardening**：cycle 现已支持 `reasoner.plan/respond` 与 memory/skill/policy/predictor provider 超时保护，单点慢调用不再拖死整轮执行
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay、eval 持久化（含 runtime-server SQLite durable reports）、baseline eval cases 共享模块
- **世界模型与设备**：Perception Pipeline、Device Registry、WorldStateGraph、ForwardSimulator、SimulationBasedPredictor
- **多 Agent**：Agent Registry、Inter-Agent Bus、Task Delegator、Coordination Strategies、Shared State、Lifecycle Manager
- **运营控制台骨架**：Dashboard / Session / Trace / Goal / Memory / Workspace / Eval / Approval / Multi-Agent / World Model / Device / Config 页面及对应 Zustand store

## 当前收尾项（截至 2026-04-02）

- 个人助理 Phase A 已落地 IM Gateway、Web Chat、飞书 Adapter、搜索/浏览器连接器和 Agent 组装；当前 Web Chat / Feishu / Hosted Runtime / Console 已完成原生 `streamText -> runtime.output` 文本流和 `runtime.status` 活动流对齐，Focused 回归已覆盖审批恢复、`auto_approve`、proactive、Web Chat、飞书消息转发与 Hosted Runtime SSE；收口重点转向飞书真实平台联调与更大范围端到端稳定性验证。
- Console API 基础层未完全统一，存在 `/v1/v1/*` 路径重复和若干返回结构不一致问题；当前只做整理和校准，不把其视为 M11 全量交付。
- `WsServer` 已实现但仍需完成 `runtime-server` 启动接线、鉴权协商与前端订阅联调，这部分作为未来 M11 的输入资产保留。
- 多 Agent 的 `delegate` 结果回流尚未与 `call_tool` 路径形成等价自动续跑闭环，这一点影响 M9 的“完成”口径。
- `docs/05_2026-04-01_memory-evolution/` 是下一阶段主线，当前已完成 SQL 记忆库迁移设计、normalized SQLite store、四层记忆的 SQLite persistence 接线、独立 `SqliteCheckpointStore`、`RuntimeSessionSnapshot` 与 `SessionCheckpoint` 的记忆瘦身、默认 SQL-first 持久化路径、legacy SQLite/File runtime state 的显式迁移入口，以及 LongMemEval retrieval benchmark harness、recursive full-bundle loader、matrix/aggregate runner、vendored official retrieval/QA wrapper、hypothesis generation 与 full-run 脚本；working memory TTL、semantic negative-pattern learning 与 cost budget tracking 也已接入主链；runtime 已不再消费 fat runtime snapshot 的 memory/checkpoint payload；后续继续推进官方全量数据基线跑数、SQL-first 默认路径的长期兼容性验证和后续 schema 演进。
- Runtime Hardening 新收口：`ToolGateway` 已补 transient/permanent error 区分、tool circuit breaker 与更保守的 retry 行为；`RuntimeStateStore` 写失败会转为 degraded persistence status + `runtime.status` 事件，而不是直接中断 session 主链；`SessionManager` 与 `AgentRuntime` 已补 session TTL / idle expiration / resident LRU eviction。
- Prefrontal / Meta 当前代码能力仍主要是 action 级 confidence / risk / conflict gating，尚未进入深层自评估；新的方向性设计已补在 `docs/06_2026-04-14_metacognition-evolution/01_deep-metacognition-and-self-evaluation.md`。
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
- 2026-04-16 M8.5 Phase 5 第一批补充：`@neurocore/eval-core` 已补 `MetaBenchmarkBundle`、summary API、human-readable summary formatter、summary diff 与 benchmark artifacts builder；仓库已新增 families A~G 的本地 case bundle、`examples/demo-meta-benchmark.mjs`、`examples/demo-meta-benchmark-compare.mjs`、`.neurocore/benchmarks/meta/` 持久化输出，以及 GitHub Actions 中独立 `meta-stack` lane 与 benchmark artifact 上传；下一步严格转向 online meta eval。

## 关键风险（历史记录）

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级破坏现有闭环 | 新模块/新策略路径落地 + test harness 回归 |
| session-level lock/CAS 影响 resume/approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 兼容性 | 保留内存 fallback + 增量接入 |
| 当前工作流过多并行导致优先级分散 | 先聚焦个人助理与 Console 准备，再进入记忆系统演进，最后恢复 M11 |
| Console 联调暴露接口契约漂移 | 先统一 API 基础层与类型，M11 恢复后再做页面逐页联调 |
