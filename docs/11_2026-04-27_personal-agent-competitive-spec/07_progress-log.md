# Personal Agent Progress Log

> 用途：作为长执行任务的可恢复工程日志。每次完成有意义工作后追加记录。

---

## 2026-04-27

### PA2-P0-00 started

目标：

| 项 | 内容 |
|---|---|
| 任务 | 建立长任务控制平面 |
| 范围 | 文档、ledger、验收 oracle、测试策略、执行协议、校验脚本 |
| 目标命令 | `npm run pa:plan-check`、`npm run pa:next-task`、`npm run pa:task-check -- PA2-P0-00`、`npm run pa:accept -- PA2-P0-00` |

初始设计依据：

| 来源 | 采用原则 |
|---|---|
| Anthropic Long-running Claude | 根目录长期指令、进度文件、test oracle、git checkpoint、Ralph loop |
| OpenClaw / Hermes 对标规格 | 个人助理需要跨渠道、记忆、工具、自动化、多 Agent 和治理闭环 |

### PA2-P0-00 completed

交付：

| 项 | 内容 |
|---|---|
| 文档 | `02_architecture.md`、`03_delivery-roadmap.md`、`04_acceptance-oracle.md`、`05_test-strategy.md`、`06_long-run-agent-protocol.md`、`07_progress-log.md`、`08_failed-attempts.md` |
| Ledger | `project-ledger.json`，当前任务已前移到 `PA2-P0-01` |
| 校验脚本 | `scripts/personal-agent-plan.mjs` |
| package scripts | `pa:plan-check`、`pa:next-task`、`pa:start`、`pa:task-check`、`pa:accept` |
| Agent 约束 | `AGENTS.md` 已加入个人助理长任务协议 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run pa:plan-check` | 通过 |
| `npm run pa:next-task` | 通过，收口前返回 `PA2-P0-00` |
| `npm run pa:task-check -- PA2-P0-00` | 通过 |
| `npm run pa:accept -- PA2-P0-00` | 通过 |
| `node --check scripts/personal-agent-plan.mjs` | 通过 |
| `node scripts/personal-agent-plan.mjs help` | 通过，展示 `pa:start` |
| `npm run build` | 通过 |
| 收口后 `npm run pa:next-task` | 通过，返回 `PA2-P0-01` |

用户追加要求：

| 要求 | 落地 |
|---|---|
| agent 自己分阶段提交、commit 和 push | 已写入 `06_long-run-agent-protocol.md`、`03_delivery-roadmap.md`、`04_acceptance-oracle.md` 和 `project-ledger.json` |

残留风险：

| 风险 | 处理 |
|---|---|
| `pa:accept` 通过后 ledger 状态会变化 | 收口后额外运行 `pa:plan-check` 和 `pa:next-task` 验证下一个任务 |

### PA2-P0-01 completed

交付：

| 项 | 内容 |
|---|---|
| 统一入口 | `normalizePersonalIngressMessage` 作为 WebChat、CLI、Feishu/IM 的统一 ingress envelope |
| 渠道能力 | `ChannelCapabilities` 明确表达 text、markdown、status、actions、approval、typing、streaming、edits、threads 等能力 |
| 身份上下文 | `PersonalIdentityContext` 随 envelope 进入 Gateway，并写入 runtime input metadata |
| CLI 入口 | 新增 `CliAdapter`，支持程序化 `receiveText` 输入并归一化为个人助理消息 |
| Gateway 透传 | `IMGateway` 在调用 `ConversationRouter` 前补齐 channel、identity、source metadata |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项测试 |
| `node --test tests/personal-assistant-config.test.mjs` | 通过，4 项测试 |
| `node --test tests/personal-assistant-web-chat.test.mjs tests/personal-assistant-e2e.test.mjs` | 通过，6 项测试 |
| `npm run pa:task-check -- PA2-P0-01` | 通过 |
| `npm run pa:accept -- PA2-P0-01` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-01` 已标记 completed |
| 下一项 | `PA2-P0-02` Conversation handoff and short-reference continuity |

### PA2-P0-02 completed

交付：

| 项 | 内容 |
|---|---|
| Handoff bundle | `ConversationHandoff` 扩展为 recent messages、recent turns、last user/assistant、short reference context |
| 短指代上下文 | 新 session 的 metadata 同时包含 `conversation_handoff`、`previous_conversation_summary`、`short_reference_context` |
| 同 chat 连续性 | 非终态 session 继续复用原 route；终态/idle session 重开时带上同 chat 历史 |
| 测试强化 | WebChat handoff 测试必须验证 user turn、assistant turn、turn bundle 和 top-level short reference context |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-web-chat.test.mjs tests/personal-assistant-e2e.test.mjs` | 通过，6 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项测试 |
| `npm run pa:task-check -- PA2-P0-02` | 通过 |
| `npm run pa:accept -- PA2-P0-02` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-02` 已标记 completed |
| 下一项 | `PA2-P0-03` Explicit personal memory in recall bundle |

### PA2-P0-03 completed

交付：

| 项 | 内容 |
|---|---|
| 个人记忆 provider | 新增 `PersonalMemoryRecallProvider`，将 active personal memories 注入 memory recall proposals、entries 和 digests |
| Agent 接线 | `startPersonalAssistantApp` 共享同一个 `SqlitePersonalMemoryStore` 给 command handler 和 runtime memory provider |
| 纠错语义 | provider 只读取 `listActive`，`/correct` tombstone 的旧事实不会进入 recall bundle |
| OpenAI 兼容 | proposal payload 同时包含 `entries`，可被 OpenAI-compatible reasoner 的 memoryRecall 摘要读取 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-e2e.test.mjs tests/memory-recall-bundle.test.mjs` | 通过，4 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项测试 |
| `npm run pa:task-check -- PA2-P0-03` | 通过 |
| `npm run pa:accept -- PA2-P0-03` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-03` 已标记 completed |
| 下一项 | `PA2-P0-04` Command registry and baseline slash commands |

### PA2-P0-04 completed

交付：

| 项 | 内容 |
|---|---|
| Command registry | `CommandHandler` 从 switch 改为 schema-registered command definitions，并暴露 `listCommandSchemas()` |
| 基线命令 | `/new`、`/status`、`/stop`、`/model`、`/usage`、`/compact` 均已注册并可执行 |
| 兼容命令 | 保留 `/reset`、`/history`、`/remember`、`/memories`、`/memory`、`/forget`、`/correct`、`/skills` |
| 结构化错误 | 未知命令返回 `Command error`，包含 `code`、`command`、`message`、`available_commands` |
| 跨入口一致性 | E2E 覆盖 WebChat/CLI normalized ingress 下 `/model`、`/usage`、`/compact`、`/stop`、未知命令输出一致 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，4 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项测试 |
| `npm run pa:task-check -- PA2-P0-04` | 通过 |
| `npm run pa:accept -- PA2-P0-04` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-04` 已标记 completed |
| 下一项 | `PA2-P0-05` Tool approval and command risk classification |

### PA2-P0-05 completed

交付：

| 项 | 内容 |
|---|---|
| 默认高风险工具 | `ToolPolicyProvider` 默认将 `shell`、`exec`、`send_message`、`message`、`webhook*` 等工具纳入 approval |
| 默认策略说明 | `DefaultPolicyProvider` 对同类工具名生成高风险 approval warning |
| 审批审计 | approval/rejection 测试断言 `status`、`approver_id`、`decided_at` 可从 runtime approval record 查询 |
| 风险可见 | 未知命令输出的 `available_commands` 包含命令风险等级，如 `/stop(medium)`、`/compact(low)` |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-approval.test.mjs tests/policy-governance.test.mjs` | 通过，11 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，4 项测试 |
| `npm run pa:task-check -- PA2-P0-05` | 通过 |
| `npm run pa:accept -- PA2-P0-05` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-05` 已标记 completed |
| 下一项 | `PA2-P0-06` Minimum background task ledger |

### PA2-P0-06 completed

交付：

| 项 | 内容 |
|---|---|
| Background task ledger | 新增 `BackgroundTaskLedger`，支持 created、running、succeeded、failed、cancelled |
| Proactive 接线 | heartbeat/cron 运行时创建 background task，写入 session_id、approval_id、result_text、delivery target |
| 查询和取消 | `ProactiveEngine` 暴露 `listBackgroundTasks()`、`getBackgroundTask()`、`cancelBackgroundTask()` |
| 完成投递 | notification/approval 投递后记录 delivered_at 和 delivery_target |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-proactive.test.mjs` | 通过，3 项测试 |
| `npm run pa:task-check -- PA2-P0-06` | 通过 |
| `npm run pa:accept -- PA2-P0-06` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-06` 已标记 completed |
| 下一项 | `PA2-P0-07` Minimum cron and delivery |

### PA2-P0-07 completed

交付：

| 项 | 内容 |
|---|---|
| Cron 管理 | `CronScheduler` 支持 list/get/pause/resume/remove/runNow |
| one-shot | `ScheduleEntry` 支持 `mode: one_shot` 和 `run_at`，触发后自动 disabled |
| recurring | 继续支持标准 5-field cron recurring schedule |
| Engine API | `ProactiveEngine` 暴露 schedule 管理 API |
| 投递验证 | cron 运行结果写入 background task ledger，并记录 delivery target |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-proactive.test.mjs` | 通过，4 项测试 |
| `npm run pa:task-check -- PA2-P0-07` | 通过 |
| `npm run pa:accept -- PA2-P0-07` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-07` 已标记 completed |
| 下一项 | `PA2-P0-08` Web search, fetch and browser connector closure |

### PA2-P0-08 completed

交付：

| 项 | 内容 |
|---|---|
| Web search citation | `web_search` 输出 `sources`、`citations`、`source_id`、`trust: untrusted`，摘要包含 `UNTRUSTED_WEB_CONTENT` 和来源引用 |
| Web fetch | 新增 `web_fetch` 工具，与 `web_browser` 共用 URL fetch connector，输出 cited source 和 untrusted marker |
| Browser trace | `web_fetch` / `web_browser` payload 写入 `browser_trace`，包含 action、tool_name、url、fetched_at、content_chars、link_count |
| Reasoning safety | 工具摘要在进入后续 reasoning 前带 `UNTRUSTED_WEB_CONTENT`，trace structured payload 同步保留 untrusted metadata |
| Ledger 扩展 | P1/P2 roadmap 任务已写入 `project-ledger.json`，下一项自动前移到 `PA2-P1-01` |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，6 项测试 |
| `npm run pa:task-check -- PA2-P0-08` | 通过 |
| `npm run pa:accept -- PA2-P0-08` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P0-08` 已标记 completed，P0 任务链完成 |
| 下一项 | `PA2-P1-01` Telegram adapter |

### PA2-P1-01 completed

交付：

| 项 | 内容 |
|---|---|
| Telegram adapter | 新增 `TelegramAdapter`，实现 Telegram Bot API 发送、编辑、typing 和测试用 `receiveUpdate` |
| Ingress normalization | Telegram message / callback_query 归一化为 PersonalGateway envelope，保留 chat、identity、transport metadata |
| Channel capabilities | `IMPlatform` 扩展为 `telegram`，默认支持 text、markdown、status、images、files、actions、approval_requests、typing、edits |
| Delivery | text、markdown、status、approval_request 均可转为 Telegram `sendMessage` payload，approval 使用 inline keyboard callback |
| Auth boundary | `allowed_senders` 在 adapter 入口层拦截未授权 sender，不进入 session routing |
| App config | 支持 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_API_BASE_URL`、`TELEGRAM_WEBHOOK_SECRET`、`TELEGRAM_ALLOWED_SENDERS` 和本地 config |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-telegram.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项回归 |
| `npm run pa:task-check -- PA2-P1-01` | 通过 |
| `npm run pa:accept -- PA2-P1-01` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-01` 已标记 completed |
| 下一项 | `PA2-P1-02` Slack adapter |

### PA2-P1-02 completed

交付：

| 项 | 内容 |
|---|---|
| Slack adapter | 新增 `SlackAdapter`，实现 Slack Events API 归一化、Slack Web API 发送/编辑和测试用 `receiveEvent` |
| Signing boundary | 支持 Slack `v0` HMAC signing 校验，签名缺失、错误或时间戳过期时不进入 routing |
| Allowlist | `allowed_senders` 在 adapter 入口层拦截未授权 Slack user |
| Thread routing | threaded Slack event 的 `chat_id` 编码为 `channel:thread_ts`，delivery 时还原为 `channel` + `thread_ts` |
| Markdown/status delivery | markdown 以 `mrkdwn` 发送，status 格式化为 Slack 文本，approval request 使用 blocks button |
| App config | 支持 `SLACK_BOT_TOKEN`、`SLACK_SIGNING_SECRET`、`SLACK_API_BASE_URL`、`SLACK_ALLOWED_SENDERS` 和本地 config |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-slack.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项回归 |
| `npm run pa:task-check -- PA2-P1-02` | 通过 |
| `npm run pa:accept -- PA2-P1-02` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-02` 已标记 completed |
| 下一项 | `PA2-P1-03` Discord adapter |

### PA2-P1-03 completed

交付：

| 项 | 内容 |
|---|---|
| Discord adapter | 新增 `DiscordAdapter`，实现 Gateway message event 归一化、Discord REST 发送/编辑/typing 和测试用 `receiveGatewayEvent` |
| Channel / DM / thread | channel 与 thread 直接作为 Discord channel target；`dm:<user_id>` 会先创建 DM channel 再发送 |
| Auth boundary | adapter start 要求 bot token，入口忽略 bot author，并用 `allowed_senders` 阻断未授权 user |
| Approval callback | Discord button interaction 归一化为 PersonalGateway action message，保留 reply message id |
| Delivery | markdown、status、approval_request、image/file fallback 均可转为 Discord message payload |
| App config | 支持 `DISCORD_BOT_TOKEN`、`DISCORD_API_BASE_URL`、`DISCORD_ALLOWED_SENDERS` 和本地 config |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-discord.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项回归 |
| `npm run pa:task-check -- PA2-P1-03` | 通过 |
| `npm run pa:accept -- PA2-P1-03` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-03` 已标记 completed |
| 下一项 | `PA2-P1-04` Email adapter with webhook and cron integration |

### PA2-P1-04 completed

交付：

| 项 | 内容 |
|---|---|
| Email adapter | 新增 `EmailAdapter`，支持 inbound email event、outbound `EmailSendProvider` delivery 和 no-op edit/typing |
| Untrusted ingress | inbound email 进入 gateway 前写入 `UNTRUSTED_EMAIL_CONTENT`，metadata/channel/identity 均带 untrusted 标记 |
| Delivery route | `IMPlatform` 扩展为 `email`，NotificationDispatcher 可通过 email route 投递 cron/background task 结果 |
| Approval trace | `email_send` 高风险工具保持 approval 拦截；auto-approved 执行后 trace structured payload 记录 message_id 和 tool_name |
| App wiring | `startPersonalAssistantApp` 在存在 email sender provider 时注册 EmailAdapter |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-email-adapter.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-proactive.test.mjs` | 通过，4 项回归 |
| `node --test tests/personal-assistant-approval.test.mjs` | 通过，5 项回归 |
| `npm run pa:task-check -- PA2-P1-04` | 通过 |
| `npm run pa:accept -- PA2-P1-04` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-04` 已标记 completed |
| 下一项 | `PA2-P1-05` Skills registry and AgentSkills compatibility |

### PA2-P1-05 completed

交付：

| 项 | 内容 |
|---|---|
| Skill registry | 新增 `AgentSkillRegistry`，递归发现 AgentSkills 风格 `SKILL.md` 并解析 id、name、description、permissions、channels、risk_level、enabled、content_hash |
| Channel governance | skill list/search/invoke 会按 `IMPlatform` 过滤 channel visibility，隐藏技能无法在不允许渠道运行 |
| Slash command | `/skills` 支持 list、search、audit、run，未配置 registry 时明确返回未配置 |
| Tool gateway | 新增 `personal_skill_list` 和 `personal_skill_invoke`，在工具层输出结构化 skill metadata、instructions、permissions 和 allowed 状态 |
| App config | 支持 `PERSONAL_ASSISTANT_SKILLS_ENABLED`、`PERSONAL_ASSISTANT_SKILL_DIRS` 和本地 config skills directories |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-skills.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，6 项回归 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，7 项回归 |
| `npm run pa:task-check -- PA2-P1-05` | 通过 |
| `npm run pa:accept -- PA2-P1-05` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-05` 已标记 completed |
| 下一项 | `PA2-P1-06` MCP client and tool filtering |

### PA2-P1-06 completed

交付：

| 项 | 内容 |
|---|---|
| MCP client | 新增 `PersonalMcpClient`，支持 HTTP JSON-RPC 和 stdio JSON-line `tools/list` / `tools/call` |
| Tool filtering | `include_tools` 和 `exclude_tools` 在 discovery 阶段过滤 MCP tools |
| ToolGateway injection | `createPersonalAssistantAgent` 支持通过 `mcpTools` options 注入发现后的 MCP tools |
| Untrusted output | MCP tool summary 以 `UNTRUSTED_MCP_CONTENT` 开头，payload 标记 `untrusted_content` 和 `untrusted_reason` |
| Resource marking | MCP result resources 会被复制到 payload.resources，并逐条标记 `trust: untrusted` |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-mcp.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，6 项回归 |
| `npm run pa:task-check -- PA2-P1-06` | 通过 |
| `npm run pa:accept -- PA2-P1-06` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-06` 已标记 completed |
| 下一项 | `PA2-P1-07` Subagent lifecycle and task panel |

### PA2-P1-07 completed

交付：

| 项 | 内容 |
|---|---|
| Subagent manager | 新增 `SubagentManager`，支持 spawn、list、get、cancel、cancelByParentSession |
| Ledger integration | child session 创建后写入 `BackgroundTaskLedger`，记录 parent_session_id、subagent 标记、session_id、result_text |
| Lifecycle | auto-run 子任务完成后标记 succeeded；失败标记 failed；手动取消标记 cancelled |
| Cascade stop | parent session cancellation 可级联取消同 parent_session_id 的所有 active child tasks |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-subagents.test.mjs` | 通过，2 项测试 |
| `npm run pa:task-check -- PA2-P1-07` | 通过 |
| `npm run pa:accept -- PA2-P1-07` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-07` 已标记 completed |
| 下一项 | `PA2-P1-08` Hybrid memory search and session search |

### PA2-P1-08 completed

交付：

| 项 | 内容 |
|---|---|
| Session search store | 新增 SQLite-backed `SessionSearchStore`，支持 keyword、semantic text、time filter、user/tenant scope 和 provenance 字段 |
| Recall provider | 新增 `SessionSearchRecallProvider`，将 hybrid search results、entries、match_reasons 和 provenance 注入 `memory_recall_bundle.proposals` |
| Gateway indexing | IM Gateway 自动索引用户输入和助手输出，绑定 session、cycle、trace、platform、chat 和 message provenance |
| App wiring | `createPersonalAssistantAgent` / `startPersonalAssistantApp` 支持共享 `sessionSearchStore`，启动后同库写入并召回会话历史 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-memory-search.test.mjs` | 通过，2 项测试 |
| `node --test tests/memory-recall-bundle.test.mjs` | 通过，2 项回归 |
| `node --test tests/personal-assistant-e2e.test.mjs tests/personal-assistant-gateway.test.mjs` | 通过，13 项回归 |
| `npm run benchmark:longmemeval:stable -- --dataset data --shard-size 50 --limit-shards 1 --granularity both --top-k 10` | 通过，session R@10 `1.0000` / MRR `0.9822`，turn R@10 `0.9267` / MRR `0.7068` |
| `npm run pa:task-check -- PA2-P1-08` | 通过 |
| `npm run pa:accept -- PA2-P1-08` | 通过，同上 LongMemEval 指标 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-08` 已标记 completed |
| 下一项 | `PA2-P1-09` Docker and SSH sandbox provider |

### PA2-P1-09 completed

交付：

| 项 | 内容 |
|---|---|
| Sandbox SPI | 新增 `SandboxProvider` / `SandboxManager`，支持 local、Docker、SSH execution targets |
| Sandbox tools | 新增 `sandbox_shell`、`sandbox_file_read`、`sandbox_file_write`，所有输出带 `SANDBOX_TRACE` 和 structured sandbox payload |
| Provider trace | sandbox result 记录 provider、target、operation、command、exit_code、timeout、executable、args、cwd |
| Policy forcing | policy-core 新增 `SandboxPolicyProvider`，可将原始 `shell` / `file_write` 等高风险工具 block，并要求走 sandbox 工具 |
| App wiring | `PersonalAssistantAppConfig.sandbox` 支持启用 sandbox、选择默认 target、配置 Docker/SSH/local，并在 Agent 启动时注册 sandbox tools |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-sandbox.test.mjs` | 通过，4 项测试 |
| `node --test tests/policy-governance.test.mjs` | 通过，6 项回归 |
| `node --test tests/personal-assistant-approval.test.mjs` | 通过，5 项回归 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，6 项回归 |
| `npm run pa:task-check -- PA2-P1-09` | 通过 |
| `npm run pa:accept -- PA2-P1-09` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-09` 已标记 completed |
| 下一项 | `PA2-P1-10` Heartbeat and standing orders |

### PA2-P1-10 completed

交付：

| 项 | 内容 |
|---|---|
| Standing order store | 新增 SQLite-backed `StandingOrderStore`，持久化 owner、scope、expiry、permission、metadata 和 last_applied_at |
| ProactiveEngine API | 新增 register/list/pause/resume standing order API，并支持启动时从 config 写入 standing orders |
| Heartbeat injection | heartbeat task prompt 和 input metadata 注入 active standing orders，按 user/platform scope 过滤 |
| Due-only heartbeat | `triggered=false` heartbeat result 继续静默跳过，不创建后台任务、不投递通知 |
| Audit metadata | heartbeat background task metadata 写入 payload、standing_order_ids、standing_orders、trace_ids、cycle_ids |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-standing-orders.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-proactive.test.mjs tests/personal-assistant-e2e.test.mjs` | 通过，10 项回归 |
| `npm run pa:task-check -- PA2-P1-10` | 通过 |
| `npm run pa:accept -- PA2-P1-10` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P1-10` 已标记 completed |
| 下一项 | `PA2-P2-01` Memory wiki and claim evidence layer |

### PA2-P2-01 completed

交付：

| 项 | 内容 |
|---|---|
| Claim store | 新增 SQLite-backed `MemoryClaimStore`，以 typed claim 表示个人事实 |
| Evidence layer | claim 支持 personal memory、session search、manual、external evidence refs，保留 session/message provenance |
| Freshness | claim 记录 observed_at、ttl_days、expires_at 和 freshness score |
| Contradiction | 同 user/subject 的不同 active claim 自动生成 contradiction metadata |
| Wiki rebuild | 新增 `rebuildMemoryWikiPage`，从 approved claims 重建 subject 分组 wiki markdown |
| Review lifecycle | 用户 review 支持 approve、correct、retire，保留 reviewer_id、reviewed_at、correction_of |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-memory-wiki.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-memory-search.test.mjs` | 通过，2 项回归 |
| `node --test tests/memory-recall-bundle.test.mjs` | 通过，2 项回归 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，6 项回归 |
| `npm run pa:task-check -- PA2-P2-01` | 通过 |
| `npm run pa:accept -- PA2-P2-01` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-01` 已标记 completed |
| 下一项 | `PA2-P2-02` Dreaming and consolidation pipeline |

### PA2-P2-02 completed

交付：

| 项 | 内容 |
|---|---|
| Dreaming consolidator | 新增 `DreamingConsolidator`，从 recent session search entries 生成 memory claim candidates |
| Evidence carryover | 每个 candidate 保留 session_search evidence refs、source_entry_ids、session_id、source_message_id |
| Safety checks | candidate 进入 review 前执行 duplicate、conflict、privacy、injection checks |
| Reviewable batch | consolidation 输出 `DreamingBatch(status=reviewable)`，不会直接写入 active claim store |
| Activation gate | 只有 `approveCandidate()` 被 reviewer 调用后才写入 approved memory claim，并记录 candidate id 和 safety checks |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-dreaming.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-memory-wiki.test.mjs` | 通过，3 项回归 |
| `node --test tests/personal-assistant-memory-search.test.mjs` | 通过，2 项回归 |
| `node --test tests/memory-recall-bundle.test.mjs` | 通过，2 项回归 |
| `npm run pa:task-check -- PA2-P2-02` | 通过 |
| `npm run pa:accept -- PA2-P2-02` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-02` 已标记 completed |
| 下一项 | `PA2-P2-03` Automatic skill generation and skill regression |

### PA2-P2-03 completed

交付：

| 项 | 内容 |
|---|---|
| Auto skill manager | 新增 `AutoSkillManager`，从 repeated successful workflows 生成 skill candidates |
| Candidate gate | candidate 默认不激活；`activateCandidate()` 要求 validation report passed |
| Regression validation | 新增 validator SPI 和 `createExpectedOutputValidator()`，用 regression cases 检查 generated skill instructions |
| Registry activation | validated candidate 可激活到 `AgentSkillRegistry`，生成 AgentSkills-compatible record |
| Version lifecycle | 同 skill 多版本会替换旧 active version；支持 disable version 和 rollback 到上一版本 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-auto-skills.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-skills.test.mjs` | 通过，3 项回归 |
| `node --test tests/skill-system.test.mjs tests/procedural-skill-spec.test.mjs` | 通过，28 项回归 |
| `npm run pa:task-check -- PA2-P2-03` | 通过 |
| `npm run pa:accept -- PA2-P2-03` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-03` 已标记 completed |
| 下一项 | `PA2-P2-04` Multi-agent profile and channel binding |

### PA2-P2-04 completed

交付：

| 项 | 内容 |
|---|---|
| Agent profile registry | 新增 `AgentProfileRegistry`、SQLite profile store 和 profile policy audit store |
| Channel binding | profile binding 支持 user、platform/chat、channel kind、workspace 与 priority 匹配 |
| Scoped route store | 新增 `SqliteProfileScopedSessionMappingStore`，同一 chat 可按 profile/workspace 隔离 session route |
| Profile-aware routing | 新增 `ProfileAwareConversationRouter`，按 profile 选择 builder、tenant、memory/tool/policy scope，并把 profile metadata 注入 runtime input |
| Approval recovery | Gateway approval action 改为通过 router 连接 session，避免多 builder/profile 下审批恢复走错 agent |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-agent-profiles.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs tests/personal-assistant-approval.test.mjs` | 通过，12 项回归 |
| `npm run pa:task-check -- PA2-P2-04` | 通过 |
| `npm run pa:accept -- PA2-P2-04` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-04` 已标记 completed |
| 下一项 | `PA2-P2-05` Trajectory data, redaction and benchmark artifacts |

### PA2-P2-05 completed

交付：

| 项 | 内容 |
|---|---|
| Trajectory export | `exportPersonalAgentTrajectory()` 可导出 session replay、trace records、final output、channel/identity/profile metadata |
| Provenance | 导出结果包含 trace provenance、memory recall/attached memory provenance 和 tool execution provenance |
| Redaction | 内置稳定脱敏器，覆盖 secret key 字段、Bearer/token/API key、email、phone、user/chat/message/session 私有标识和自由文本中的已知私有 ID |
| Benchmark artifact | `buildPersonalAgentTrajectoryBenchmarkArtifact()` 可把脱敏轨迹转换为 deterministic replay case |
| Deterministic replay | `replayPersonalAgentTrajectoryBenchmarkArtifact()` 基于 replay signature 验证 artifact 可稳定回放 |
| Personal assistant wrapper | 新增 `exportPersonalAssistantSessionTrajectory()`，可直接从 `AgentSessionHandle.replay()` 生成轨迹数据 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-trajectory-export.test.mjs` | 通过，1 项测试 |
| `node --test tests/longmemeval-benchmark.test.mjs tests/memory-objective-benchmark.test.mjs tests/memory-causal-regression.test.mjs` | 通过，15 项回归 |
| `node --test tests/personal-assistant-e2e.test.mjs tests/personal-assistant-memory-search.test.mjs` | 通过，8 项回归 |
| `npm run pa:task-check -- PA2-P2-05` | 通过 |
| `npm run pa:accept -- PA2-P2-05` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-05` 已标记 completed |
| 下一项 | `PA2-P2-06` Full-channel media and voice |

### PA2-P2-06 completed

交付：

| 项 | 内容 |
|---|---|
| Media attachment model | `UnifiedMessage` 新增 image/file/audio/voice 统一 attachments，保留 provenance、mime、duration、transcript、sensitivity |
| Ingress normalization | `normalizePersonalIngressMessage()` 可从媒体 content 或 attachments 数组生成 channel attachments |
| Runtime extraction | 新增 `extractMediaForRuntime()`，将媒体转换为摘要、provenance、sensitivity 和 `UserInput.content_parts` |
| Gateway wiring | 普通消息 metadata 注入 `media_attachments` / `media_extractions`，prompt 注入媒体摘要和提取文本 |
| Delivery fallback | audio/voice 输出内容可通过 dispatcher 保持富内容对象，并为 Slack/Discord/Email/Feishu 等文本渠道提供 fallback 文本 |
| WebChat support | WebChat payload 支持 image/file/audio/voice 输入和附件数组 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-media.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs tests/personal-assistant-web-chat.test.mjs tests/personal-assistant-email-adapter.test.mjs` | 通过，15 项回归 |
| `node --test tests/personal-assistant-telegram.test.mjs tests/personal-assistant-slack.test.mjs tests/personal-assistant-discord.test.mjs` | 通过，9 项回归 |
| `npm run pa:task-check -- PA2-P2-06` | 通过 |
| `npm run pa:accept -- PA2-P2-06` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-06` 已标记 completed |
| 下一项 | `PA2-P2-07` Console unified governance view |

### PA2-P2-07 completed

交付：

| 项 | 内容 |
|---|---|
| Governance controller | 新增 `PersonalAssistantGovernanceConsole`，统一聚合 sessions、background tasks、approvals、schedules、child agents、memory records 和 tool actions |
| Governed actions | 支持 approval approve/reject、schedule pause/resume、background task cancel、child agent pause/resume/cancel |
| Audit trace | 每个治理动作写入 audit record，保留 actor、target、before/after 和 details |
| Console store | 新增 `usePersonalAssistantGovernanceStore`，接入 `/v1/personal-assistant/governance` 及治理动作端点 |
| Console page | 新增 Assistant Governance 统一视图，展示 session/task/approval/cron/subagent/memory/tool/audit，并提供 approve/reject/pause/resume/cancel 操作 |
| Console typing | 修正既有 Console API 类型 re-export、audit 字段和事件 payload 类型漂移，Console typecheck/build 重新通过 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-console-governance.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-proactive.test.mjs tests/personal-assistant-subagents.test.mjs` | 通过，6 项回归 |
| `npm --workspace @neurocore/console run typecheck` | 通过 |
| `npm --workspace @neurocore/console run build` | 通过 |
| `npm run pa:task-check -- PA2-P2-07` | 通过 |
| `npm run pa:accept -- PA2-P2-07` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA2-P2-07` 已标记 completed |
| 下一项 | `PA2` OpenClaw/Hermes 对标个人助理任务链已完成，等待 `pa:next-task` 确认无剩余任务 |

### SiliconFlow timeout hardening completed

交付：

| 项 | 内容 |
|---|---|
| Provider timeout split | OpenAI-compatible reasoner 支持 `jsonTimeoutMs` 与 `streamTimeoutMs`，个人助理默认将结构化 plan/respond 阶段限制在 `45000ms`，最终流式回复继续使用长超时 |
| SiliconFlow extra body | 个人助理配置链路完整透传 `extraBody`，本地硅基流动配置中的 `enable_thinking=false` 不再被入口丢弃 |
| Runtime fallback | response generation 超时会返回可见错误文本并恢复到 waiting，不再以未捕获 `AbortError` 打崩 Web 服务 |
| Structured preconditions | OpenAI-compatible reasoner 会过滤自然语言 preconditions，只保留 runtime 可判定条件，避免相邻上下文被误判为 `Preconditions not met` |
| Complete action closure | `complete` 动作直接作为终态文本输出，不再错误调用 `streamText` |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/reasoner.test.mjs` | 通过，10 项测试 |
| `node --test tests/personal-assistant-config.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-web-chat.test.mjs` | 通过，7 项测试 |
| `node --test tests/runtime.test.mjs` | 通过，14 项测试 |
| 硅基流动真实 WebChat 两轮验证 | 通过，第一轮 `15508ms`，第二轮 `24838ms`，无 `Preconditions not met`，第二轮正确回答 `GPT-5.5` |

### Personal assistant baseline design completed

交付：

| 项 | 内容 |
|---|---|
| Baseline spec | 新增 `09_personal-assistant-baseline-test.md`，定义 `PA-BL-001` 产品级完整 Baseline |
| Full call flow | 覆盖 WebChat ingress、Gateway、Router、Runtime、Memory、Reasoner、Policy、Tool、Output、Trace、Governance、Cleanup |
| QA chain | 固定 12 轮问答链路，覆盖新模型核查、相邻上下文、分析、显式记忆、记忆纠错、邮件草稿、审批发送、自动提醒、新会话恢复 |
| Scenario matrix | 定义 S1~S12，包括可信/不可信搜索、provider timeout、streaming timeout、natural-language precondition、complete action、prompt injection、approval rejection、memory correction、多渠道命令、后台任务取消、媒体 fallback |
| Regression oracle | 定义 artifact、功能、延迟、安全、可观测、质量门槛和 blocker 规则 |
| Docs wiring | 更新 acceptance oracle、test strategy 和 docs README 导航 |

当前状态：

| 项 | 内容 |
|---|---|
| 已完成 | Baseline 设计与验收标准 |
| 待实现 | dedicated baseline runner、`tests/personal-assistant-baseline.test.mjs`、accepted deterministic baseline artifact |

### Personal assistant gap requirements and execution plan completed

交付：

| 项 | 内容 |
|---|---|
| Gap requirement table | 新增 `10_gap-requirements-and-execution-plan.md`，把 OpenClaw/Hermes 对标缺口和个人助理应有能力整理为 `PA-GAP-001` ~ `PA-GAP-030` |
| Execution phases | 定义 Phase A ~ G：Baseline/产品外壳、会话身份安全模型、执行工具外部事件、数据记忆知识库隐私、渠道语音端侧 Canvas、生态迁移沙箱自学习、长期数据训练和 IoT |
| Per-feature process | 每个 `PA-GAP-*` 都固定“分析 / 执行 / 验收”三段，要求先核对现状，再做入口/状态/持久化/权限/可观测/测试闭环，最后用真实 runner 或产品入口验收 |
| Acceptance matrix | 汇总每项任务的基础命令、focused 回归、baseline 收口和 live provider 收口命令 |

当前状态：

| 项 | 内容 |
|---|---|
| 已完成 | 文档级需求表、完整计划和真实验收过程 |
| 下一项 | 将 `PA-GAP-001` ~ `PA-GAP-030` 导入机器可读 ledger，并先实现 `PA-GAP-001` 产品级 Baseline Runner |

### PA-GAP-001 completed

交付：

| 项 | 内容 |
|---|---|
| Ledger import | `project-ledger.json` 已追加 `PA-GAP-001` ~ `PA-GAP-030` 和 Phase A ~ G，`PA-GAP-001` 已作为当前任务启动 |
| Baseline runner | 新增 `examples/personal-assistant/src/baseline/assertions.ts`、`fixtures.ts`、`runner.ts` 和 `examples/personal-assistant/scripts/run-baseline.mjs` |
| Deterministic fixtures | 覆盖 WebChat 真实连接、搜索/浏览/邮件/日历 mock connector、审批、记忆纠错、自动提醒、媒体 fallback 和 timeout 场景 |
| Baseline test | 新增 `tests/personal-assistant-baseline.test.mjs`，复用 runner 并验证 artifact 完整性 |
| Accepted summary | 新增 `.neurocore/baselines/personal-assistant/accepted-baseline.json`，大型 run artifact 目录由 `.gitignore` 排除 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |
| `node examples/personal-assistant/scripts/run-baseline.mjs --mode deterministic --artifact-dir .neurocore/baselines/personal-assistant/pa-gap-001-deterministic --update-accepted` | 通过，run id `pa-bl-001-2026-04-27T15-53-36-881Z-deterministic` |
| `npm run pa:accept -- PA-GAP-001` | 通过 |
| `node --test tests/personal-assistant-web-chat.test.mjs tests/personal-assistant-gateway.test.mjs` | 通过，14 项回归 |
| `node --test tests/personal-assistant-e2e.test.mjs tests/personal-assistant-approval.test.mjs` | 通过，11 项回归 |
| `node --test tests/personal-assistant-proactive.test.mjs tests/personal-assistant-memory-search.test.mjs` | 通过，6 项回归 |

指标：

| 指标 | 数值 |
|---|---:|
| Assertions | 66 / 66 passed |
| Main + scenario turns | 22 |
| p50 latency | `203ms` |
| p95 latency | `243ms` |
| Max latency | `244ms` |
| Search calls | 2 |
| Browser calls | 1 |
| Email sends | 1，且仅在 approval 后 |
| Calendar/reminder calls | 1 |
| Schedule count | 1 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-001` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-002` Install, onboarding, daemon and autostart |

### PA-GAP-002 completed

交付：

| 项 | 内容 |
|---|---|
| Root CLI | 新增 `scripts/neurocore.mjs`，支持 `neurocore assistant <command>` 产品入口 |
| Assistant CLI | 新增 `examples/personal-assistant/scripts/assistant.mjs`，提供 `setup/start/serve/stop/status/install-daemon` |
| Setup | 在指定 `--home` 下生成 `.neurocore/.personal-assistant/app.local.json`、SQLite 路径、WebChat 配置和 proactive 默认配置 |
| Daemon start | `start` 会自动补齐缺失配置、启动 detached `serve` 进程、写 pid/log，并等待 `/health` 通过 |
| Stop/status | `status` 查询 pid 和 WebChat health；`stop` 发送 SIGTERM 并清理 pid |
| Autostart | `install-daemon` 可生成 launchd plist 或 systemd user service 文件 |
| Bootstrap reasoner | 无外部 OpenAI-compatible token 时可用本地 bootstrap reasoner 完成安装链路 health 验收 |
| Test | 新增 `tests/personal-assistant-onboarding.test.mjs`，在临时 HOME 中验证 setup/start/status/stop/install-daemon 和 start 自动 setup |

验收：

| 命令 | 结果 |
|---|---|
| `node --check scripts/neurocore.mjs && node --check examples/personal-assistant/scripts/assistant.mjs` | 通过 |
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-onboarding.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |
| `npm run pa:accept -- PA-GAP-002` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-002` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-003` Doctor, health and config dry-run |

### PA-GAP-003 completed

交付：

| 项 | 内容 |
|---|---|
| Health command | `neurocore assistant health` 查询 WebChat `/health`，失败时返回机器可读错误 |
| Doctor command | `neurocore assistant doctor` 输出 JSON 风险报告，覆盖 provider、SQLite、端口、审批、外部 DM allowlist 和 sandbox |
| Config dry-run | `neurocore assistant config --dry-run` 输出解析后的配置，并对 token、secret、bearer、api key 字段脱敏 |
| Timeout hardening | health probe 增加超时控制，避免被非 assistant 服务占用端口时挂起 |
| Test | 新增 `tests/personal-assistant-doctor.test.mjs`，用临时 HOME 和端口占用 fixture 验证诊断链路 |

验收：

| 命令 | 结果 |
|---|---|
| `node --check scripts/neurocore.mjs && node --check examples/personal-assistant/scripts/assistant.mjs` | 通过 |
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-doctor.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-onboarding.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-003` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-004` Real CLI/TUI product entry |

### PA-GAP-004 completed

交付：

| 项 | 内容 |
|---|---|
| CLI/TUI entry | `neurocore assistant chat` 和 `neurocore assistant tui` 可进入交互式个人助理 shell |
| Gateway reuse | CLI shell 通过 `CliAdapter.receiveText()` 进入同一套 `IMGateway`、`ConversationRouter`、`CommandHandler` 和 runtime |
| Streaming output | CLI channel capabilities 升级为 `streaming=true`、`edits=true`，Gateway 对 CLI 转发 runtime status 和 token stream edit |
| Multiline input | 支持 triple quotes 和 trailing backslash 两种多行输入 |
| Slash autocomplete | shell completer 从 `CommandHandler.listCommandSchemas()` 生成 `/status`、`/stop` 等补全，不复制命令业务逻辑 |
| Interrupt | Ctrl+C 在空闲输入时取消当前输入，在运行中请求 `/stop` |
| Test | 新增 `tests/personal-assistant-cli-shell.test.mjs`，覆盖 shell 多行、status stream、slash completion 和伪终端 Ctrl+C |

验收：

| 命令 | 结果 |
|---|---|
| `node --check scripts/neurocore.mjs && node --check examples/personal-assistant/scripts/assistant.mjs` | 通过 |
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-cli-shell.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，8 项测试 |
| `node --test tests/personal-assistant-onboarding.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-004` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-005` Session UX commands |

### PA-GAP-005 completed

交付：

| 项 | 内容 |
|---|---|
| Command schemas | `CommandHandler` 新增 `/retry`、`/undo`、`/personality`、`/insights`、`/trace` |
| Retry | `/retry` 从 trace 中读取上一条用户输入，并显式重放该输入 |
| Undo | `/undo` checkpoint 当前 session 并清除当前 chat route，下一条消息进入新会话 |
| Personality | `/personality` 支持 show/set/reset 当前 session 的 personality override |
| Insights | `/insights` 汇总 session state、cycle、trace、event、tool、failure 和 last action |
| Trace | `/trace [on|off|last]` 支持查看 trace 摘要与切换 session trace visibility |
| Safety | 除显式 `/retry` 外，新增命令只读写会话/路由元数据，不进入模型调用 |
| Tests | 扩展 `tests/personal-assistant-e2e.test.mjs`，覆盖 schema 注册、Web/CLI 一致性和非 retry 命令不触发模型 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，7 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，8 项测试 |
| `node --test tests/personal-assistant-cli-shell.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-onboarding.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-005` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-006` DM pairing, allowlist and home channel |

### PA-GAP-006 completed

交付：

| 项 | 内容 |
|---|---|
| Pairing manager | 新增 `PairingManager`，支持 pairing code create/consume、未配对阻断、撤销和 home channel |
| SQLite identity store | `SqlitePlatformUserLinkStore` 扩展 pairing codes、home channels、identity audit events |
| Gateway block | `IMGateway` 在外部 DM 未配对时只允许 `/pair`，其他消息只返回 pairing prompt，不进入 runtime |
| Commands | `CommandHandler` 新增 `/pair`、`/unpair`、`/sethome` |
| Config | 个人助理配置新增 `identity.require_pairing*` 与 pairing code TTL |
| Test | 新增 `tests/personal-assistant-pairing.test.mjs`，覆盖 block、pair、sethome、runtime entry、unpair、audit |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-pairing.test.mjs` | 通过，1 项测试 |
| `node --test tests/personal-assistant-telegram.test.mjs tests/personal-assistant-slack.test.mjs tests/personal-assistant-discord.test.mjs tests/personal-assistant-email-adapter.test.mjs` | 通过，12 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，7 项测试 |
| `node --test tests/personal-assistant-gateway.test.mjs` | 通过，8 项测试 |
| `node --test tests/personal-assistant-cli-shell.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-onboarding.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-006` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-007` Model selection, fallback and health check |

### PA-GAP-007 completed

交付：

| 项 | 内容 |
|---|---|
| Provider registry | `@neurocore/sdk-node` 新增 OpenAI-compatible provider registry，支持 default provider、fallback chain、provider summary 和 health probe |
| Model router | 新增 `OpenAICompatibleModelRouterReasoner`，按 session metadata / input metadata 选择 provider，主 provider 429/timeout 等失败时自动尝试 fallback provider |
| Reasoner compatibility | `OpenAICompatibleReasoner` 保留默认本地 fallback 行为，仅新增可测试 fetch 注入和严格错误透传开关 |
| Config | 个人助理配置新增 `models.default_provider_id` 与 `models.providers[]`，兼容旧 `openai` / `.neurocore/llm.local.json` 单 provider 配置 |
| Commands | `/model` 扩展为 status、`use <provider_id>`、`reset`、`health [provider_id]`、`audit` |
| Session scope | `/model use` 只写当前 session 的 `personal_assistant.model_provider_id`，并写 `model_audit`；router 自动 fallback 事件写入 `model_provider_router.events` |
| Tests | 新增 `tests/personal-assistant-model-router.test.mjs` 覆盖 429 fallback、health failure mode、session-only switch 和 audit |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-model-router.test.mjs` | 通过，3 项测试 |
| `node --test tests/reasoner.test.mjs` | 通过，10 项测试 |
| `node --test tests/personal-assistant-config.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，7 项测试 |
| `node --test tests/personal-assistant-doctor.test.mjs` | 通过，2 项测试 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-007` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-008` Credential vault and least-secret privilege |

### PA-GAP-008 completed

交付：

| 项 | 内容 |
|---|---|
| Credential vault | 新增 `InMemoryCredentialVault`，支持 secret ref、scope allowlist、短期 lease、lease/deny audit |
| Scoped refs | 个人助理启动链路把 model、web search、IM channel secret 注册为 `personal-assistant://...` ref，并按 `model:*`、`tool:web_search`、`channel:*` scope lease |
| Tool lease | `web_search` 支持 `apiKeyRef + credentialVault`，工具调用时按 `tool:web_search` scope 获取临时凭据 |
| Model/channel lease | model provider registry 与 Telegram/Slack/Discord/Feishu adapter auth 在启动时从 vault 按 scope lease，而不是把 secret 放进 artifact-facing metadata |
| Artifact redactor | baseline artifact 写入复用统一 credential redactor，覆盖 secret-key 字段、known secret、Bearer token、常见 API key token |
| Sandbox deny-by-default | sandbox execution 在进入 provider runner 前过滤 secret-like env key，默认不注入 `*_TOKEN`、`*_SECRET`、`*_API_KEY` 等环境变量 |
| Tests | 新增 `tests/personal-assistant-credential-vault.test.mjs`，覆盖授权 lease、拒绝越权 scope、web_search lease、sandbox env 过滤和 artifact redaction |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-credential-vault.test.mjs` | 通过，4 项测试 |
| `node --test tests/personal-assistant-config.test.mjs` | 通过，4 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，7 项测试 |
| `node --test tests/personal-assistant-model-router.test.mjs` | 通过，3 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-008` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-009` Product-level file tools |

### PA-GAP-009 completed

交付：

| 项 | 内容 |
|---|---|
| Workspace boundary | 新增 governed workspace file toolset，所有路径解析到配置的 workspace root 内，阻断 `../` 越界访问 |
| File operations | 支持 `workspace_file_read/list/search/diff/write/edit/apply_patch/rollback`，写入类操作返回 diff、hash、bytes 和 rollback_id |
| Rollback | 每次 mutation 记录内存 rollback record，rollback 可恢复旧内容或删除新建文件，并返回恢复 diff 与 hash |
| Approval | `write/edit/apply_patch/rollback` 标记为 high side effect，真实 session 链路在写文件前进入 pending approval，审批后才落盘 |
| Config | 个人助理配置新增 `files.enabled/workspace_root/max_file_bytes/max_search_results` 及对应环境变量 |
| Tests | 新增 `tests/personal-assistant-file-tools.test.mjs` 覆盖临时 workspace 读改查 diff 回滚、越界阻断和审批前不落盘 |

验收：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过 |
| `node --test tests/personal-assistant-file-tools.test.mjs` | 通过，2 项测试 |
| `node --test tests/personal-assistant-approval.test.mjs` | 通过，5 项测试 |
| `node --test tests/personal-assistant-e2e.test.mjs` | 通过，7 项测试 |
| `node --test tests/personal-assistant-baseline.test.mjs` | 通过，1 项测试 |
| `npm run pa:accept -- PA-GAP-009` | 通过 |

状态：

| 项 | 内容 |
|---|---|
| Ledger | `PA-GAP-009` 已通过 `pa:accept`，待本次提交持久化 completed 状态 |
| 下一项 | `PA-GAP-010` Terminal background process management |
