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
> - 2026-04-27 个人助理 Baseline 设计补充：新增 `docs/11_2026-04-27_personal-agent-competitive-spec/09_personal-assistant-baseline-test.md`，定义 `PA-BL-001` 产品级完整 Baseline，包括完整调用流程、12 轮问答链路、场景矩阵、artifact、延迟/安全/可观测指标和阻断级回归验收标准。当前为设计规格，后续缺口是 dedicated runner 与 `tests/personal-assistant-baseline.test.mjs`。
> - 2026-04-27 个人助理缺口计划补充：新增 `docs/11_2026-04-27_personal-agent-competitive-spec/10_gap-requirements-and-execution-plan.md`，把 PA2 完成后的下一轮个人助理能力整理为 `PA-GAP-001` ~ `PA-GAP-030`，并为每项固定“分析 / 执行 / 验收”过程。下一步从 `PA-GAP-001` 产品级 Baseline Runner 开始。
> - 2026-04-27 个人助理 Baseline Runner 补充：`PA-GAP-001` 已落地 dedicated deterministic runner、`tests/personal-assistant-baseline.test.mjs` 和 accepted summary。当前 `PA-BL-001` 最新 run 为 `pa-bl-001-2026-04-27T15-53-36-881Z-deterministic`，66/66 assertions passed；后续 PA-GAP 任务从 `PA-GAP-002` 开始。
> - 2026-04-27 个人助理安装入口补充：`PA-GAP-002` 已落地 `neurocore assistant setup/start/status/stop/install-daemon`，支持临时 HOME 配置、自启动服务文件生成、pid/log 管理和无外部 token 的 bootstrap reasoner。下一项为 `PA-GAP-003` doctor / health / config dry-run。
> - 2026-04-27 个人助理诊断入口补充：`PA-GAP-003` 已落地 `neurocore assistant health/doctor/config --dry-run`，可用 JSON 诊断缺失模型 token、provider 超时、端口冲突、SQLite 路径、审批绕过、DM allowlist 和 sandbox 缺失风险。下一项为 `PA-GAP-004` 真实 CLI/TUI 产品。
> - 2026-04-27 个人助理 CLI/TUI 补充：`PA-GAP-004` 已落地 `neurocore assistant chat/tui`，复用 Gateway/CommandHandler，支持多行输入、slash autocomplete、history、status stream、stream edit 输出和 Ctrl+C interrupt。下一项为 `PA-GAP-005` 会话 UX 命令。
> - 2026-04-27 个人助理会话 UX 命令补充：`PA-GAP-005` 已落地 `/retry`、`/undo`、`/personality`、`/insights`、`/trace`，WebChat/CLI/IM 共用 `CommandHandler` schema；除显式 `/retry` 外，命令不会误触模型调用。下一项为 `PA-GAP-006` DM pairing / allowlist / home channel。
> - 2026-04-27 个人助理身份配对补充：`PA-GAP-006` 已落地 PairingManager、SQLite pairing code/home channel/audit store、Gateway 未配对外部 DM 阻断，以及 `/pair`、`/unpair`、`/sethome` 命令。下一项为 `PA-GAP-007` 模型选择、fallback、health check。
> - 2026-04-27 个人助理模型治理补充：`PA-GAP-007` 已落地 OpenAI-compatible provider registry、session-level `/model use/reset/audit/health`、provider health probe 和 fallback reasoner；主 provider 429/timeout 时可自动切换 fallback provider，切换和自动 fallback 均写入 session metadata 审计。下一项为 `PA-GAP-008` credential vault / least-secret privilege。
> - 2026-04-27 个人助理凭据治理补充：`PA-GAP-008` 已落地 `CredentialVault`、secret ref、scoped lease、统一 artifact redactor、`web_search` 工具按 scope lease API key，以及 sandbox secret-like env deny-by-default。下一项为 `PA-GAP-009` 产品级文件工具。
> - 2026-04-28 个人助理文件工具补充：`PA-GAP-009` 已落地 governed workspace file tools，支持 read/list/search/diff/write/edit/apply_patch/rollback，所有路径限定在 workspace root，写入类操作 high side effect 审批前不落盘，并返回 diff、hash、bytes 与 rollback_id。下一项为 `PA-GAP-010` 终端后台进程管理。
> - 2026-04-28 个人助理终端后台进程补充：`PA-GAP-010` 已落地 `TerminalBackgroundProcessManager` 和 `terminal_process_start/poll/log/write/wait/kill` 工具，支持增量日志、stdin、wait、进程组 kill、timeout、task ledger 成功/失败/取消归档，以及 high-risk start/write/kill 审批前不 spawn。下一项为 `PA-GAP-011` 真实浏览器 profile。
> - 2026-04-28 个人助理浏览器 profile 补充：`PA-GAP-011` 已落地 browser session/provider SPI 和 `browser_session_start/navigate/click/type/screenshot/pdf/snapshot/close` 工具，默认 fetch profile provider 支持本地登录态/cookie/表单验收，可选 Playwright provider 支持真实 browser context、截图和 PDF；profile close 会清理目录，untrusted marker 保留。下一项为 `PA-GAP-012` 通用 webhook + Gmail Pub/Sub。
> - 2026-04-28 个人助理 webhook 补充：`PA-GAP-012` 已落地 `PersonalWebhookIngress` 和 `GmailPubSubWebhookAdapter`，支持 token 鉴权、session/task route、BackgroundTaskLedger 写入、Gmail Pub/Sub base64 data 解码、untrusted payload 标记和 audit 事件。下一项为 `PA-GAP-013` 通知策略。
> - 2026-04-28 个人助理通知策略补充：`PA-GAP-013` 已落地 notification policy store/planner，`pushToUser` 支持 quiet hours、urgent bypass、fallback route、dedupe key 和 dedupe window；normal/silent 可静默，主渠道失败后可跨渠道 fallback，重复提醒被合并。下一项为 `PA-GAP-015` 任务板产品化。
> - 2026-04-28 个人助理任务板补充：`PA-GAP-015` 已落地 `PersonalAssistantTaskBoard`，可查看任务状态、timeline、trace_ids、goal_ids、artifact refs、错误、retry provenance，并支持 cancel/retry 与 task audit；cron/subagent/webhook 三类任务已验收。下一项为 `PA-GAP-014` 用户数据和隐私控制台。
> - 2026-04-28 个人助理隐私控制补充：`PA-GAP-014` 已落地 `PersonalDataSubjectService`、memory/session-search 隐私状态、export/delete/freeze/retention/audit 能力和 Console Privacy 页面；删除或冻结后的 memory/trace/tool/artifact 不再进入 recall/search/export 默认结果。下一项为 `PA-GAP-022` 个人知识库接入。
> - 2026-04-28 个人助理知识库补充：`PA-GAP-022` 已落地 SQLite personal knowledge base、ingest/search/delete/reindex 工具、PDF/OCR artifact、permission scope、citation 格式和 recall provider；删除后的文档不再被 search/retrieval 返回。下一项为 `PA-GAP-023` 联系人和关系图谱。
> - 2026-04-28 个人助理联系人图谱补充：`PA-GAP-023` 已落地 SQLite contact graph、organization/channel identity/relationship 解析、联系人工具和 contact-aware `email_send`；歧义收件人不会发送，高风险关系需要显式确认，关系 memory_scope 会进入发送结果。下一项为 `PA-GAP-024` 多 profile 产品入口。
> - 2026-04-28 个人助理多 profile 补充：`PA-GAP-024` 已落地 personal profile product service、profile create/inspect/list/switch 工具、profile-aware app routing、Console Profiles 页面和 cross-profile isolation 检测；工作/家庭等 profile 的 memory/tool/channel/policy scope 可验收隔离。下一项为 `PA-GAP-018` WhatsApp / Signal / WeChat / Matrix / Teams channels。
> - 2026-04-28 个人助理扩展渠道补充：`PA-GAP-018` 已落地 WhatsApp、Signal、WeChat、Matrix、Teams adapter，扩展统一 IMPlatform/capabilities、pairing 默认保护、配置/env/secret lease 和 Gateway smoke；每个渠道均覆盖收发、approval、media fallback、handoff 与 memory 注入验收。下一项为 `PA-GAP-019` 语音 STT/TTS 和 push-to-talk。
> - 2026-04-28 个人助理语音补充：`PA-GAP-019` 已落地 `VoiceIOService`、STT provider、TTS provider、push-to-talk metadata、`/voice on/off/status` 偏好和文本回退；audio/voice 输入可转写进入 runtime，支持语音回复投递，TTS/STT 失败不会阻断文本链路。下一项为 `PA-GAP-020` 桌面移动节点。
> - 2026-04-28 个人助理端侧节点补充：`PA-GAP-020` 已落地 device node gateway protocol、pairing code、capability manifest、camera/screen/location/canvas permission gate、headless simulator 和个人助理设备节点工具；simulator 可完成配对、授权、screen/camera mock command 和审计。下一项为 `PA-GAP-021` Canvas / artifact surface。
> - 2026-04-28 个人助理 Canvas 补充：`PA-GAP-021` 已落地 Canvas artifact store、HTML sanitizer、CSP preview renderer、version/diff/rollback 工具和 Console Assistant Canvas 页面；agent 可创建并更新 HTML artifact，恶意 script/event/javascript URL 被清洗并通过 CSP/sandbox 约束。下一项为 `PA-GAP-016` Skills marketplace and install audit。
> - 2026-04-28 个人助理技能市场补充：`PA-GAP-016` 已落地 `SkillMarketplace`、source/package search、install/update/remove/enable/disable/audit、permission/risk manifest、version pin 和升级失败 rollback；禁用技能不能触发，安装与禁用动作均有审计。下一项为 `PA-GAP-017` OpenClaw and Hermes migration。
> - 2026-04-28 个人助理迁移器补充：`PA-GAP-017` 已落地 OpenClaw/Hermes migration importer、dry-run mapping report、persona/memory/skills/allowlist/channels 导入、重复检测、secret ref 跳过策略和 rollback artifact；真实导入后的 profile、memory、skill、identity/home channel 均可查询。下一项为 `PA-GAP-025` Advanced sandbox backend。

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
