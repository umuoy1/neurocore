# MVP 交付记录

> 当前进度跟踪已迁移至 [`docs/README.md`](../README.md)，本文档为历史交付记录。
>
> 2026-04-02 说明：
> - 本文只保留对 MVP 阶段的历史验收记录，不再作为当前项目状态判断依据。
> - “测试全部通过”与“全部 post-MVP 目标已交付”等表述已失效。
> - 当前真实代码状态请参见 [`docs/README.md`](../README.md) 与 [`03_code-audit-checklist.md`](./03_code-audit-checklist.md)。
> - 2026-04-20 补充：`SDK / Protocol Tightening` 已收口完成；本轮额外验证了 `tests/sdk-protocol-tightening.test.mjs`、`tests/remote-client-hardening.test.mjs`、`tests/policy-governance.test.mjs`、`tests/hosted-productization.test.mjs` 与 `tests/eval-api.test.mjs`。
> - 2026-04-22 补充：`Operational Maturity` 已收口完成；当前 hosted/runtime-server 已覆盖 webhook retry/DLQ/HMAC/timeout、batch session creation、eval configurable parallelism、agent versioning、session sharing，以及 logger/tracer SPI 与 observability gating。具体状态以 [`docs/README.md`](../README.md) 为准。
> - 2026-04-22 补充：`M10 / 技能强化学习` 当前阶段也已收口完成；当前已补 reward/policy/exploration/evaluation/transfer/online learner 全链路，以及 reward/policy/exploration/evaluation/transfer 事件和 SQLite 持久化。具体状态以 [`docs/README.md`](../README.md) 为准。
> - 2026-04-22 再补充：`M10 / 技能强化学习` 已继续补齐 FR-47 / FR-48 的闭环细节：当前已支持迁移 skill 去重、验证期递减与清除 penalty、验证失败自动回退，以及基于 TTL 的自动裁剪。具体状态以 [`docs/README.md`](../README.md) 为准。
> - 2026-04-23 再补充：`M10 / 技能强化学习` 已补齐 FR-45 的最小上下文化策略实现。当前 `BanditSkillPolicy` 已按 `goal_type / domain / action_type / tool_name / risk_level` 维护 contextual state，并与全局 state 并存；当前实现是 contextual bandit，不是完整策略网络。
> - 2026-04-23 再补充：`M10 / 技能强化学习` 当前又补了两项增强：效率奖励已改为基于真实 `cycle / latency / token` 统计；`BanditSkillPolicy` 也已从单层 exact-context 升级为 `exact -> operational -> family -> global` 的分层上下文 bandit。
> - 2026-04-23 最终补充：`M10 / 技能强化学习` 当前阶段已 100% 收口；当前又补齐了 reward `metrics / baseline_metrics` 持久化、基于历史 reward 的相对效率基线、结构化 RL 事件载荷与 SQLite schema 迁移。具体状态以 [`docs/README.md`](../README.md) 为准。
> - 2026-04-23 再补充：按代码与测试回归，`M8 / 世界模型与设备接入` 当前阶段也已完全收口；当前已补齐 `ActiveInferenceEvaluator`、`SensorFusionStrategy`、`ActuatorOrchestrator`，并接入 `SimulationBasedPredictor`、CycleEngine 的 Perceive 阶段与 runtime 的 `device.orchestrate` 执行路径。
> - 2026-04-23 再补充：按代码与测试回归，`M9 / 多 Agent 分布式调度` 当前阶段也已完成；当前已补 registry lifecycle 事件、`TaskDelegator.getStatus()`、goal/shared-state conflict 记录、coordination strategy registry、child-process/remote lifecycle mode 与 graceful terminate/save-state。更远期的分布式 Bus 与多实例后端不再计入当前阶段缺口。
> - 2026-04-24 补充：`M12 / 通用自主体能力` 当前阶段已实现完成。当前交付包含 `Phase 0 ~ Phase 6`：协议冻结、自治状态面、planner、self-monitor、intrinsic motivation、自生成目标、transfer/continual、六模块自治增强、alignment gate、autonomy trace/audit、focused regression 与 autonomy benchmark summary。具体状态以 [`docs/README.md`](../README.md) 为准。
> - 2026-04-24 再补充：`docs/05_2026-04-01_memory-evolution/07_next-generation-memory-system-implementation-plan.md` 当前阶段已按 Phase 0 ~ 5 收口完成。当前交付包含：正式 `Episode` 真相层字段与 SQL-first 持久化、`Memory Gate + Recall Bundle`、正式 `SemanticCard / ProceduralSkillSpec`、episode→card/spec 的治理传播，以及 objective/causal memory benchmarks。2026-04-25 路线校准后，参数层不再作为当前实现目标，`parametric_unit_refs` 只作为历史兼容字段保留且不汇聚到 Recall Bundle。具体状态以 [`docs/README.md`](../README.md) 为准。
> - 2026-04-25 补充：个人助理 `PA-M1` Web Chat 连续性已补齐终态 runtime session 重开时的 `conversation_handoff`；同一 chat 的最近用户/助手消息会注入新 session 初始输入 metadata，避免短指代上下文因 session `completed` 丢失。PA-M1 本地 Web Chat 连续性完成度约 92%，剩余仍是飞书真实平台联调与更大范围端到端稳定性验证。
> - 2026-04-25 记忆系统 P1 补充：`runMemorySystemBenchmark()` 与 `examples/demo-memory-system-benchmark.mjs` 已把 LongMemEval retrieval、objective benchmark、causal regression 汇聚为统一 artifact；`validateSqlFirstRuntimeState()` 已补齐 SQLite SQL-first runtime state 兼容验证。
> - 2026-04-25 个人助理记忆补充：`examples/personal-assistant` 已新增 `PersonalMemoryStore` 与 SQLite 实现，支持 `/remember`、`/forget`、`/correct`、`/memories`，并把 active user memories 注入普通消息的 `input.metadata.personal_memory`。
> - 2026-04-26 记忆评测补充：LongMemEval full dataset 路径新增 stable runner。当前已补 `tools/longmemeval-prepare-bundle.py` 和 `examples/demo-longmemeval-stable-benchmark.mjs`，可把 2GB+ official JSON 分片成可被现有 JS loader 稳定消费的 full-bundle shard，并输出 manifest、shard matrix 与 combined summary；OpenAI-compatible 配置也支持 `extraBody` 以关闭 reasoning-only 模型的 thinking 输出。
> - 2026-04-26 记忆检索补充：`EpisodicMemoryProvider` 的 sparse retrieval 已升级为 stopword-aware cosine + query/phrase coverage + BM25 rerank + role/fact-shape signals + targeted query expansion，并缓存候选 score，避免 sort comparator 重复计算；LongMemEval session ingestion 已补 full / user / assistant / lead-user / preference / fact 多视图。LongMemEval stable session 3-shard 验证达到 non-abstention `420`、R@5 `1.0000`、R@10 `1.0000`、MRR `0.9441`；当前优化版 session full baseline 为 non-abstention `1410`、R@5 `0.9574`、R@10 `0.9766`、MRR `0.8964`，其中 `longmemeval_s_cleaned` R@5 `0.9787`、R@10 `0.9915`。
> - 2026-04-25 Console 记忆可观测性补充：`GET /v1/sessions/:id/memory` 已返回 retrieval plans、recall bundles、latest plan/bundle 与 memory warnings；Console Memory Inspector 已新增 Observability 视图。
> - 2026-04-27 个人助理 P2 补充：`PA2-P2-04` 已完成多 Agent profile + channel binding。当前新增 profile registry、profile-scoped session route store、profile-aware router 和 profile policy audit；同一 chat 可按 user/channel/workspace 路由到不同 builder、tenant、memory/tool/policy scope。
> - 2026-04-27 个人助理 P2 补充：`PA2-P2-05` 已完成轨迹数据、脱敏和 benchmark artifact。当前可从个人助理 session replay 导出 trace/memory/tool provenance，经稳定脱敏后转换为可确定性 replay 的 eval artifact。
> - 2026-04-27 个人助理 P2 补充：`PA2-P2-06` 已完成全渠道媒体和语音基础层。当前 image/file/audio/voice 输入会归一化为 channel attachments，带 provenance/sensitivity 进入 runtime metadata 和 `content_parts`，audio/voice 输出具备富内容投递与文本 fallback。
> - 2026-04-27 个人助理 P2 补充：`PA2-P2-07` 已完成 Console 统一治理视图。当前新增个人助理治理控制器、Console governance store/page，支持 session、background task、approval、cron、subagent、memory、tool、audit 统一查看，并可对 approval/task/cron/subagent 执行 approve/reject/pause/resume/cancel，所有治理动作写入 audit before/after 记录。
> - 2026-04-27 个人助理硅基流动超时补充：OpenAI-compatible reasoner 已拆分 `jsonTimeoutMs / streamTimeoutMs`，个人助理配置链路已透传 `extraBody`，response generation 超时会返回可见兜底而非进程崩溃；同时过滤自然语言 preconditions 并让 `complete` 动作直接终态输出。真实硅基流动 WebChat 两轮验证通过，第二轮可保持相邻上下文并回答 `GPT-5.5`。

## 交付总结

MVP 核心验收条件已满足：开发者可定义 Agent，Session 可创建/恢复/完成，Runtime 可执行标准认知周期，并具备基础工具、记忆、门控、回放与评估能力。

## MVP 验收条件

| # | 条件 | 交付物 |
|---|---|---|
| 1 | 开发者可以定义 Agent | `defineAgent()` + 工具/记忆/策略/预测器/技能注册 |
| 2 | Session 可以创建、恢复、完成 | 含 resume、checkpoint、goal rebase、approval resume |
| 3 | Runtime 可以执行标准认知周期 | `CycleEngine` 主链路 |
| 4 | Agent 可使用目标栈、工具、记忆 | goal tree + tool gateway + 四层记忆 + procedural 自动提炼 |
| 5 | 高风险动作有基础门控 | warn/block policy + approval flow + 多维 budget |
| 6 | 运行过程可追踪、可回放、可评估 | trace / replay / eval runner / remote eval API |

## MVP 交付清单

Protocol Schema · Agent Builder · Session Runtime · Goal Stack · Workspace Snapshot（含竞争广播）· Tool Gateway · Working Memory · Episodic Memory · Semantic Memory · Procedural Memory（含 skill 自动提炼）· Meta Controller · Trace Store · Replay Runner · Eval Harness

## 验收场景

| 场景 | 测试位置 |
|---|---|
| 复杂问答 + 澄清 | `tests/mvp-scenarios.test.mjs` B1 |
| 多工具串联任务 | `tests/mvp-scenarios.test.mjs` B2 |
| 高风险工具审批 | `tests/mvp-scenarios.test.mjs` B3 |
| 长任务恢复 | `tests/runtime.test.mjs` input rebase / resume |
| 经验复用 | `tests/mvp-scenarios.test.mjs` B4 |
