# OpenClaw / Hermes 对标个人助理 Agent 功能规格

> 日期：2026-04-27
> 目标：调研并固化一个新的个人助理 agent 对标规格，要求功能覆盖 OpenClaw 与 Hermes Agent，并在记忆、上下文连续性、治理、自动化、多 Agent 和评测水位上超过它们。
> 边界：本文档是新的对标规格，不放入既有 `docs/05_2026-04-01_personal-assistant/` 产品线文档；后续实现计划可从本文档拆分 P0 / P1 / P2。

---

## 1. 调研来源

主要来源：


| 项目                                  | 来源                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenClaw                            | [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)                                                                   |
| OpenClaw docs: channels             | [https://docs.openclaw.ai/channels](https://docs.openclaw.ai/channels)                                                                         |
| OpenClaw docs: gateway architecture | [https://docs.openclaw.ai/concepts/architecture](https://docs.openclaw.ai/concepts/architecture)                                               |
| OpenClaw docs: tools/plugins        | [https://docs.openclaw.ai/tools](https://docs.openclaw.ai/tools)                                                                               |
| OpenClaw docs: memory               | [https://docs.openclaw.ai/concepts/memory](https://docs.openclaw.ai/concepts/memory)                                                           |
| OpenClaw docs: automation           | [https://docs.openclaw.ai/automation](https://docs.openclaw.ai/automation)                                                                     |
| OpenClaw docs: sandboxing           | [https://docs.openclaw.ai/gateway/sandboxing](https://docs.openclaw.ai/gateway/sandboxing)                                                     |
| OpenClaw docs: browser              | [https://docs.openclaw.ai/tools/browser](https://docs.openclaw.ai/tools/browser)                                                               |
| OpenClaw docs: web tools            | [https://docs.openclaw.ai/tools/web](https://docs.openclaw.ai/tools/web)                                                                       |
| OpenClaw docs: sub-agents           | [https://docs.openclaw.ai/tools/subagents](https://docs.openclaw.ai/tools/subagents)                                                           |
| Hermes Agent                        | [https://github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)                                                   |
| Hermes docs: CLI                    | [https://hermes-agent.nousresearch.com/docs/user-guide/cli](https://hermes-agent.nousresearch.com/docs/user-guide/cli)                         |
| Hermes docs: messaging              | [https://hermes-agent.nousresearch.com/docs/user-guide/messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)             |
| Hermes docs: tools                  | [https://hermes-agent.nousresearch.com/docs/user-guide/features/tools](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools)   |
| Hermes docs: memory                 | [https://hermes-agent.nousresearch.com/docs/user-guide/features/memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) |
| Hermes docs: skills                 | [https://hermes-agent.nousresearch.com/docs/user-guide/features/skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) |
| Hermes docs: MCP                    | [https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)       |
| Hermes docs: cron                   | [https://hermes-agent.nousresearch.com/docs/user-guide/features/cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)     |
| Hermes docs: security               | [https://hermes-agent.nousresearch.com/docs/user-guide/security](https://hermes-agent.nousresearch.com/docs/user-guide/security)               |


调研口径：


| 口径          | 说明                                                                     |
| ----------- | ---------------------------------------------------------------------- |
| 功能一致        | 用户可通过 CLI / Web / IM 使用同类能力，agent 可调用同类工具，并具备同类后台运行、记忆、自动化和安全边界        |
| 更强大         | 不只复制功能数量，还要在长期记忆质量、会话连续性、任务治理、可观测性、回归评测、策略安全和多 Agent 编排上形成更严格闭环        |
| 不以单一聊天渠道为目标 | OpenClaw / Hermes 的核心不是“一个飞书机器人”，而是一个长期在线、跨渠道、可执行、可扩展的个人 agent runtime |


---

## 2. 产品定义

新的个人助理 agent 应定义为：

> 一个本地优先、长期在线、跨渠道接入、可执行工具、可持久记忆、可主动自动化、可多 Agent 并行、可审计治理，并能随用户长期使用持续改进的个人 AI 操作系统入口。

它至少包含五条主链：


| 主链           | 目标                                                                   |
| ------------ | -------------------------------------------------------------------- |
| Conversation | 用户在任意渠道发起消息，agent 能保持连续上下文、流式回复、必要时执行工具并交付结果                         |
| Memory       | 显式记忆、会话记忆、长期事实、偏好、技能、知识库统一召回，且不会被 compaction 或 session 结束打断          |
| Action       | 文件、终端、浏览器、Web、消息、媒体、外部 API、MCP 和设备能力以可控工具方式执行                        |
| Automation   | cron、heartbeat、webhook、background task、standing orders 让 agent 能主动工作 |
| Governance   | DM pairing、审批、沙箱、权限、日志、trace、评测和回放保证个人助理不会失控                         |


---

## 3. 功能总清单


| 功能域                        | OpenClaw / Hermes 已体现的能力                                                                                 | NeuroCore 等价目标                                                         | NeuroCore 更强目标                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Runtime / Gateway          | 长驻 gateway daemon；CLI、WebChat、TUI、mac app、gateway API；服务安装与自启动                                           | Hosted Runtime + Personal Gateway，支持 CLI/WebChat/Console/IM 统一入口       | Gateway 成为 runtime-server 的产品化外壳，共享 auth、trace、approval、session store、task ledger         |
| 会话管理                       | `/new`、`/reset`、`/retry`、`/undo`、`/stop`、`/status`、session resume、session search                         | 所有入口共享 SessionManager，支持恢复、终止、重试、撤销、状态查询                               | 每个渠道和 cron/subagent 都有 `conversation_handoff`，避免短上下文丢失                                    |
| 上下文压缩                      | auto compaction、manual `/compact`、不同 compaction model、identifier preservation                            | 接入 context compression 和手动压缩命令                                         | compaction 前自动 memory flush，压缩后有 recall bundle 对照和回归测试                                    |
| 多渠道消息                      | WhatsApp、Telegram、Slack、Discord、Signal、iMessage/BlueBubbles、Feishu、LINE、Matrix、Teams、WeChat、QQ、WebChat 等 | 统一 IMAdapter SPI，至少覆盖 WebChat、Feishu/Lark、Telegram、Slack、Discord、Email | 渠道能力协商：thread、reaction、media、voice、streaming、group policy、home channel                    |
| 群聊/DM 策略                   | DM pairing、allowlist、group routing、channel binding                                                       | 未授权用户不进入主链；支持允许列表和配对流程                                                 | per-channel / per-agent / per-user policy，审计所有授权变更                                        |
| 模型系统                       | OpenAI、OpenRouter、Anthropic、Nous、NVIDIA、Kimi、MiniMax、HF、Ollama、OpenAI-compatible                         | Reasoner provider 支持多 provider、多模型、会话级 model override                  | auth profile、fallback chain、per-tool/per-job model policy、local/remote model health check |
| CLI/TUI                    | 多行输入、slash command autocomplete、状态条、token/cost、interrupt、background session                              | 提供 `neurocore assistant` CLI 和 WebChat 等价命令                            | CLI/Web/IM 命令语义一致，支持局部中断、排队、恢复和多任务面板                                                      |
| Slash commands             | `/model`、`/personality`、`/skills`、`/usage`、`/background`、`/cron`、`/approve`、`/deny` 等                    | 建立个人助理命令注册表                                                            | 命令以 schema + policy 注册，自动暴露到所有渠道，并能被 Console 管理                                           |
| 工具系统                       | typed tools、toolsets、allow/deny、tool profiles、tool result sanitization                                   | ToolGateway 支持工具组、工具策略、按 agent/channel 限制                              | 工具执行统一 trace、approval、sandbox、budget、risk scoring、loop detection                          |
| 文件工具                       | read/write/edit/apply_patch、workspace root、agent workspace                                               | workspace-scoped 文件工具                                                  | workspace policy、diff preview、rollback、patch 审批                                           |
| 终端工具                       | terminal/exec、background process、process poll/wait/log/kill/write                                        | ToolGateway 执行 shell，支持 background process                             | 沙箱后端可切换，本地/Docker/SSH/remote provider，命令风险分级和审批                                           |
| 浏览器工具                      | 独立 agent browser profile，导航、点击、输入、截图、PDF、snapshot；可接真实登录浏览器                                              | 浏览器 connector + 浏览器自动化工具                                               | browser session 与 task/session 生命周期绑定，自动清理、可审计、可回放                                        |
| Web 工具                     | web_search、web_fetch、X search、多 provider、缓存                                                              | Web search/fetch connector                                             | 搜索结果引用规范、事实核验策略、recency policy、来源可信度评分                                                    |
| 媒体能力                       | image analyze/generate、TTS、voice transcription、music/video/PDF/OCR                                       | 图片理解、TTS/STT、PDF/OCR 作为可选 tools                                        | 多模态 artifact store，媒体摘要可进入记忆和知识库，敏感媒体权限治理                                                 |
| 消息发送                       | `message` / `send_message` 可向任意渠道发送                                                                      | send tool 支持目标渠道和收件人                                                   | 防误发审批、收件人确认、草稿模式、发送后可追踪 delivery status                                                   |
| 记忆文件                       | OpenClaw `MEMORY.md`、daily notes、`DREAMS.md`；Hermes `MEMORY.md` / `USER.md`                              | 显式 `/remember`、`/forget`、`/correct`、`/memories`                        | SQL-first typed memory，schema 化事实、偏好、证据、来源、时效、冲突                                          |
| 会话搜索                       | Hermes SQLite FTS5 session search + LLM summarization；OpenClaw session tools                             | 所有会话进入持久化 search index                                                 | hybrid semantic + keyword + time-aware search，LongMemEval 稳定回归                            |
| 语义记忆                       | OpenClaw hybrid search、memory wiki；Hermes 外部 memory providers                                            | semantic card + recall bundle                                          | provenance-rich wiki，claim/evidence/freshness/contradiction，用户可审阅                         |
| 自动记忆                       | memory flush、dreaming、background consolidation、skill learning nudges                                     | 重要事实自动候选提取                                                             | 候选必须过置信度、重复、冲突、隐私、注入扫描，再进入长期记忆                                                            |
| 自学习技能                      | Hermes 复杂任务后生成 skill，使用中改进 skill                                                                         | ProceduralSkillSpec 与技能触发                                              | skill 生成、验证、回归、评分、废弃和回滚形成闭环                                                               |
| 技能生态                       | AgentSkills `SKILL.md`、Skills Hub、外部目录、平台/toolset gating                                                 | 支持 AgentSkills 兼容技能目录                                                  | 技能索引、安装、隔离、审计、冲突检测、自动 slash command                                                       |
| 插件系统                       | OpenClaw plugin 可注册渠道、模型、工具、技能、speech、media、hooks；Hermes 插件/外部 provider                                  | Plugin SPI 覆盖 tools/channel/model/memory/hooks                         | 插件权限 manifest、安装前扫描、运行时隔离、版本迁移                                                            |
| MCP                        | stdio/HTTP MCP、启动时 discovery、tools include/exclude、dynamic list refresh                                  | MCP client 接入工具注册表                                                     | MCP tool 细粒度权限、credential filtering、资源/prompt 安全策略和审计                                     |
| 自动化 cron                   | one-shot、recurring、cron expression、自然语言调度、pause/resume/run/remove、delivery                               | 内建 scheduler + task runner                                             | cron 与 runtime session/task/trace/approval 统一，防递归创建 runaway jobs                          |
| Heartbeat                  | 周期性主会话 turn，用于 inbox/calendar/notification 检查                                                            | 主会话周期性自检                                                               | heartbeat checklist + due-only task + 用户状态感知 + 静默跳过规则                                     |
| Webhooks                   | HTTP hook、token 鉴权、path mapping、Gmail/PubSub                                                             | webhook ingress 映射 agent action                                        | webhook payload untrusted policy、session key 边界、专用 token、审计                               |
| Background tasks           | detached task ledger，task lifecycle，push completion                                                      | background task store，支持 list/show/cancel/notify                       | 统一记录 subagent、cron、hook、CLI、ACP，支持 lost reconciliation 和 failure notification             |
| Task Flow                  | durable multi-step flow、revision tracking                                                                | 复杂任务流状态机                                                               | goal tree / task flow / subagent result 统一治理                                              |
| Standing orders            | 注入每个 session 的长期操作指令                                                                                     | agent-level standing instructions                                      | standing order 带权限边界、失效条件、审计和用户确认                                                         |
| 多 Agent profile            | 多 agent、多 workspace、多账号/channel binding                                                                  | Agent profile + route binding                                          | 每个 agent 独立 memory/tool/channel/policy，支持个人/工作/家庭隔离                                       |
| 子 Agent                    | spawn、list、kill、log、info、send、steer、nested depth、completion push                                         | Multi-agent delegate + child session                                   | 子 Agent 有目标、状态、预算、工具策略、结果校验、cascade stop、task ledger                                      |
| 代码工作流                      | git worktree、Claude Code/Codex/OpenCode skill、PR/issue workflow                                          | code agent skills + repo tools                                         | 多 worker 并行、变更隔离、CI 自修复、PR review trace                                                   |
| 研究/训练                      | batch trajectory generation、trajectory compression、RL environments                                       | eval runner + trace export                                             | 真实个人助理轨迹可脱敏、可 replay、可转训练/eval 数据                                                         |
| 沙箱                         | Docker、SSH、OpenShell、Daytona、Modal、Singularity；workspace access 控制                                       | Tool sandbox provider SPI                                              | 按工具/agent/channel/任务风险动态选择沙箱，敏感 secret 不进入沙箱默认环境                                          |
| 安全审批                       | dangerous command approval、DM pairing、container isolation                                                | ApprovalCenter + policy-core                                           | 多级风险、命令解释、最小可批准 action、超时撤销、审批人身份审计                                                       |
| Prompt/memory injection 防护 | memory entry 扫描、tool result 清洗、session history safety filtering                                          | memory/tool/session 输入安全过滤                                             | 对 memory、MCP、web、message、file、browser 同一套 untrusted-content 标记和治理                         |
| 设备/节点                      | macOS/iOS/Android/headless nodes，camera/screen/location/canvas commands                                  | device-core sensor/actuator connector                                  | 设备能力声明、配对、最小权限、用户在场感知                                                                     |
| Canvas/UI                  | OpenClaw live Canvas、agent-editable HTML/CSS/JS                                                          | Console/Web artifact surface                                           | Canvas artifact 可版本化、可预览、可回滚、可被 agent 更新                                                  |
| 可观测性                       | lifecycle/assistant/tool stream、status、token/cost/duration、task audit                                    | runtime events、trace、metrics、Console                                   | 每轮从输入、记忆、工具、审批、输出到记忆写回全链路可回放                                                              |
| 运营命令                       | doctor、update、config get/set、gateway restart、health/status                                               | CLI/Console 管理入口                                                       | schema-aware config patch、dry-run、回滚、环境诊断和安全评分                                            |
| 迁移                         | Hermes 可迁移 OpenClaw data                                                                                 | 从旧个人助理配置/记忆导入                                                          | 可从 OpenClaw/Hermes/markdown/SQLite/JSON 导入，并做去重和 provenance 标注                            |


---

## 4. 用户可见命令清单

### 4.1 会话命令


| 命令                        | 目标行为                               |
| ------------------------- | ---------------------------------- |
| `/new` / `/reset`         | 开始新会话或重置当前会话                       |
| `/retry`                  | 重试上一轮输入，保留上下文                      |
| `/undo`                   | 删除上一组 user/assistant/tool exchange |
| `/stop`                   | 中断当前运行，终止工具和子任务                    |
| `/status`                 | 显示会话、模型、token、工具、任务、记忆状态           |
| `/usage`                  | 显示 token、成本、上下文占用和压缩建议             |
| `/compact [instructions]` | 手动压缩上下文，支持额外压缩指令                   |
| `/title <name>`           | 命名当前会话                             |
| `/sessions`               | 列出、搜索、恢复历史会话                       |


### 4.2 模型和人格命令


| 命令                        | 目标行为                      |
| ------------------------- | ------------------------- |
| `/model`                  | 查看或切换当前模型                 |
| `/model <provider:model>` | 设置当前 session 的模型 override |
| `/reasoning <low          | medium                    |
| `/personality <name>`     | 切换人格/语气                   |
| `/tools`                  | 查看当前可用工具和受限原因             |
| `/toolset <name>`         | 切换工具集                     |


### 4.3 记忆命令


| 命令                        | 目标行为           |
| ------------------------- | -------------- |
| `/remember <text>`        | 写入显式个人记忆       |
| `/forget <id              | query>`        |
| `/correct <old> -> <new>` | 修正已有记忆并保留审计    |
| `/memories [query]`       | 查询当前用户记忆       |
| `/memory-search <query>`  | 检索长期记忆和历史会话    |
| `/memory-review`          | 查看候选记忆、冲突和待确认项 |


### 4.4 技能命令


| 命令                       | 目标行为         |
| ------------------------ | ------------ |
| `/skills`                | 列出可用技能       |
| `/skills search <query>` | 搜索本地/远程技能    |
| `/skills install <name>` | 安装技能         |
| `/skills audit`          | 检查技能风险、依赖、冲突 |
| `/<skill-name>`          | 激活指定技能并执行任务  |


### 4.5 自动化和任务命令


| 命令                     | 目标行为                       |
| ---------------------- | -------------------------- |
| `/background <prompt>` | 创建后台 agent 任务              |
| `/tasks`               | 查看后台任务面板                   |
| `/tasks cancel <id>`   | 取消后台任务                     |
| `/cron add ...`        | 创建 one-shot 或 recurring 任务 |
| `/cron list`           | 查看任务                       |
| `/cron pause           | resume                     |
| `/heartbeat status`    | 查看周期性主会话检查状态               |


### 4.6 审批和安全命令


| 命令                 | 目标行为                                    |
| ------------------ | --------------------------------------- |
| `/approve <id>`    | 批准待执行高风险动作                              |
| `/deny <id>`       | 拒绝待执行动作                                 |
| `/pair <code>`     | 授权新 DM 用户或设备                            |
| `/allow <user      | channel>`                               |
| `/block <user      | channel>`                               |
| `/security status` | 查看 pairing、sandbox、approval、secret 暴露风险 |


### 4.7 多 Agent 命令


| 命令                        | 目标行为                   |
| ------------------------- | ---------------------- |
| `/agents`                 | 列出 agent profile 和在线状态 |
| `/focus <agent            | session>`              |
| `/unfocus`                | 取消聚焦                   |
| `/subagents spawn <task>` | 启动子 Agent              |
| `/subagents list`         | 查看子 Agent              |
| `/subagents send          | steer                  |


---

## 5. 平台与渠道清单

### 5.1 P0 渠道


| 渠道            | 原因                                 |
| ------------- | ---------------------------------- |
| WebChat       | 本地开发和最小端到端验证入口                     |
| CLI           | 运维、开发、自动化和无 UI 环境入口                |
| Feishu / Lark | 当前产品线已有基础，适合继续收口                   |
| Telegram      | 配置简单、个人助理使用高频、适合外部可复现              |
| Email         | 个人助理核心场景，适合 webhook/cron/heartbeat |


### 5.2 P1 渠道


| 渠道             | 原因                     |
| -------------- | ---------------------- |
| Slack          | 工作场景主流                 |
| Discord        | 社区和个人 bot 场景主流         |
| WhatsApp       | OpenClaw 重点渠道，全球个人聊天场景 |
| Signal         | 隐私场景                   |
| WeChat / WeCom | 中文个人/工作场景关键渠道          |
| DingTalk       | 中文工作场景                 |


### 5.3 P2 渠道


| 渠道                                   | 原因          |
| ------------------------------------ | ----------- |
| Matrix / Mattermost / Nextcloud Talk | 自托管和团队场景    |
| iMessage / BlueBubbles               | Apple 生态    |
| LINE / QQ / Teams / Google Chat      | 覆盖更多地区和企业平台 |
| SMS / Voice Call                     | 高触达提醒、语音交互  |
| Home Assistant                       | 家庭自动化入口     |


---

## 6. 比 OpenClaw / Hermes 更强的设计约束


| 约束                | 说明                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------- |
| 不允许短上下文断裂         | 同一 chat 的终态 session 重开、cron 回调、subagent 回传、channel thread 切换都必须带 handoff 摘要和最近消息          |
| 不允许记忆只靠 prompt 文件 | Prompt 文件可作为导出视图，但事实源必须是 SQL-first typed memory，带 provenance、lifecycle、conflict、freshness |
| 不允许工具无治理          | 所有 tool call 必须进入 trace，可被 approval、sandbox、budget、risk policy 统一拦截                       |
| 不允许后台任务不可追踪       | cron、hook、background、subagent、CLI detached run 都必须进入统一 task ledger                        |
| 不允许只做功能 smoke     | 每个功能域必须有 focused regression、E2E smoke、artifact 输出和可回放 trace                               |
| 不允许渠道割裂           | WebChat、CLI、IM、cron、webhook 共享同一 session/memory/tool/policy 语义                            |
| 不允许 MCP 无边界       | MCP server 必须有工具过滤、secret 过滤、资源/提示注入防护、动态刷新审计                                             |
| 不允许记忆越积越脏         | 记忆写入必须有去重、冲突、注入、隐私、过期和人工确认机制                                                              |


---

## 7. 实现优先级建议

### P0：个人助理最小强闭环


| 编号        | 任务                                                  | 验收                                                                          |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| PA2-P0-01 | 新 Personal Gateway 抽象，统一 WebChat / CLI / IM ingress | 任意入口进入同一 ConversationRouter 和 runtime session                               |
| PA2-P0-02 | 会话连续性协议，覆盖终态 session 重开和短指代                         | 复现“刚才那个模型”场景不丢上下文                                                           |
| PA2-P0-03 | 显式个人记忆与 SQL-first recall bundle 接通                  | `/remember`、`/forget`、`/correct`、`/memories` 在 WebChat/CLI/IM 等价            |
| PA2-P0-04 | 基础工具审批和命令风险分级                                       | 高风险 shell/send_message/webhook 默认需要审批                                       |
| PA2-P0-05 | 最小 cron + background task ledger                    | 可创建提醒/后台任务，完成后回到原渠道并可审计                                                     |
| PA2-P0-06 | 基础 slash command registry                           | `/new`、`/status`、`/stop`、`/model`、`/usage`、`/compact`、`/approve`、`/deny` 可用 |
| PA2-P0-07 | Web search/fetch + browser connector 第一版            | 能搜索、打开网页、引用来源、输出可验证结果                                                       |


### P1：达到 OpenClaw / Hermes 主能力水位


| 编号        | 任务                                          | 验收                                          |
| --------- | ------------------------------------------- | ------------------------------------------- |
| PA2-P1-01 | Telegram / Slack / Discord / Email adapters | 多渠道同时运行，消息路由和 home channel 正常               |
| PA2-P1-02 | Skills registry + AgentSkills 兼容加载          | `SKILL.md` 可索引、激活、命令化、审计                    |
| PA2-P1-03 | MCP client + tool filtering                 | stdio/HTTP MCP 可接入，支持 include/exclude       |
| PA2-P1-04 | 子 Agent 生命周期与任务面板                           | spawn/list/steer/kill/log/info，结果 push 回主会话 |
| PA2-P1-05 | hybrid memory search + session search       | 历史会话和显式记忆可统一搜索                              |
| PA2-P1-06 | Docker/SSH sandbox provider                 | exec/file/browser 进入可配置隔离环境                 |
| PA2-P1-07 | heartbeat 和 standing orders                 | 周期性主会话检查、长期操作指令注入                           |


### P2：超过 OpenClaw / Hermes


| 编号        | 任务                                | 验收                                                     |
| --------- | --------------------------------- | ------------------------------------------------------ |
| PA2-P2-01 | 记忆 wiki / claim evidence layer    | 长期知识有证据、冲突、时效和审计                                       |
| PA2-P2-02 | dreaming / consolidation pipeline | 自动候选记忆经评分和人工审阅进入长期记忆                                   |
| PA2-P2-03 | 自动技能生成和技能回归                       | 复杂任务后生成技能，并用测试验证后启用                                    |
| PA2-P2-04 | 多 Agent profile + channel binding | 家庭/工作/开发 agent 独立 workspace、memory、policy              |
| PA2-P2-05 | 轨迹数据与 benchmark                   | 个人助理真实任务可 replay、脱敏、转 eval/training artifact           |
| PA2-P2-06 | 全渠道媒体和语音                          | STT/TTS/image/PDF/OCR/voice call 跨渠道可用                 |
| PA2-P2-07 | Console 统一治理视图                    | session、task、memory、tool、approval、cron、subagent 全链路可视化 |


---

## 8. 后续拆文档建议

本文只固化对标功能清单。后续可新建以下文档，仍放在本目录下：


| 文档                               | 目的                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `02_architecture.md`             | 把上面的功能域压成 NeuroCore Personal Gateway / Agent Runtime / Memory / Tool / Channel 架构 |
| `03_p0_implementation_plan.md`   | 只拆 P0，明确文件、SPI、测试和验收                                                              |
| `04_channel_adapter_spec.md`     | 独立定义 IM / Email / WebChat / CLI adapter 协议                                        |
| `05_command_and_task_spec.md`    | 统一 slash command、cron、heartbeat、background task、approval                          |
| `06_memory_and_learning_spec.md` | 统一个人显式记忆、session search、semantic card、dreaming、skill learning                     |


