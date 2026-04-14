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
| 当前 | 个人助理 + Console 准备 | 以 `docs/05_2026-04-01_personal-assistant/` 为主线推进产品化；Console 侧仅保留接口契约整理、后端支持梳理与预实现维护 |
| 下一阶段 | 记忆系统演进 | 进入 `docs/05_2026-04-01_memory-evolution/` 的需求收敛、迁移计划与验证设计 |
| 更后阶段 | Prefrontal 深化 + M11 运营控制台 | 待个人助理和记忆系统演进阶段收口后，先推进深层元认知与自评估，再恢复 M11 的完整联调、E2E 与正式交付 |

## 已实现核心能力

- **协议与分层**：`protocol / runtime-core / sdk-core / sdk-node / runtime-server / memory-core / policy-core / eval-core`
- **Runtime 主链路**：Session → Goal → Cycle → Workspace → Action → Observation → Memory / Trace / Checkpoint
- **Goal Tree**：root goal、分解、父子状态派生、显式输入 rebase
- **Tool Gateway**：注册、schema 校验、超时、重试、失败观测、执行指标
- **记忆四层**：working + episodic + semantic + procedural，tenant-scoped cross-session recall
- **预算与压缩**：token/tool/cycle/cost budget assessment、token accounting、graded context compression
- **托管 Runtime**：HTTP API、async/stream、SSE、webhook（重试 + 投递日志）、文件/SQLite 持久化、远程 client（超时 + 重试）
- **Trace / Replay / Eval**：本地 eval runner、remote eval API、session replay、eval 持久化、baseline eval cases 共享模块
- **世界模型与设备**：Perception Pipeline、Device Registry、WorldStateGraph、ForwardSimulator、SimulationBasedPredictor
- **多 Agent**：Agent Registry、Inter-Agent Bus、Task Delegator、Coordination Strategies、Shared State、Lifecycle Manager
- **运营控制台骨架**：Dashboard / Session / Trace / Goal / Memory / Workspace / Eval / Approval / Multi-Agent / World Model / Device / Config 页面及对应 Zustand store

## 当前收尾项（截至 2026-04-02）

- 个人助理 Phase A 需要落地 IM Gateway、Web Chat、搜索/浏览器连接器和 Agent 组装。
- Console API 基础层未完全统一，存在 `/v1/v1/*` 路径重复和若干返回结构不一致问题；当前只做整理和校准，不把其视为 M11 全量交付。
- `WsServer` 已实现但仍需完成 `runtime-server` 启动接线、鉴权协商与前端订阅联调，这部分作为未来 M11 的输入资产保留。
- 多 Agent 的 `delegate` 结果回流尚未与 `call_tool` 路径形成等价自动续跑闭环，这一点影响 M9 的“完成”口径。
- `docs/05_2026-04-01_memory-evolution/` 是下一阶段主线，当前已完成 SQL 记忆库迁移设计、normalized SQLite store、四层记忆的 SQLite persistence 接线、独立 `SqliteCheckpointStore`、`RuntimeSessionSnapshot` 与 `SessionCheckpoint` 的记忆瘦身、默认 SQL-first 持久化路径、legacy SQLite/File runtime state 的显式迁移入口，以及 LongMemEval retrieval benchmark harness、recursive full-bundle loader、matrix/aggregate runner、vendored official retrieval/QA wrapper、hypothesis generation 与 full-run 脚本；runtime 已不再消费 fat runtime snapshot 的 memory/checkpoint payload；后续继续推进官方全量数据基线跑数、SQL-first 默认路径的长期兼容性验证和后续 schema 演进。
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

## 关键风险（历史记录）

| 风险 | 缓解措施 |
|---|---|
| 仲裁层升级破坏现有闭环 | 新模块/新策略路径落地 + test harness 回归 |
| session-level lock/CAS 影响 resume/approval 语义 | 先补并发测试，再收紧状态机 |
| eval durable persistence 兼容性 | 保留内存 fallback + 增量接入 |
| 当前工作流过多并行导致优先级分散 | 先聚焦个人助理与 Console 准备，再进入记忆系统演进，最后恢复 M11 |
| Console 联调暴露接口契约漂移 | 先统一 API 基础层与类型，M11 恢复后再做页面逐页联调 |
