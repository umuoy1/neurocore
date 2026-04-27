# Personal Assistant Gap Requirements And Execution Plan

> 日期：2026-04-27
> 目标：把 OpenClaw / Hermes 对标差距与个人助理应有能力整理成可执行需求表和完整计划。每个目标必须按“分析、执行、验收”推进，不能只写实现描述。

---

## 1. 执行原则

| 原则 | 要求 |
|---|---|
| 分析先行 | 每个需求开工前必须核对现有代码、文档、测试、真实产品路径，输出明确差距 |
| 执行闭环 | 实现必须覆盖入口、状态、持久化、权限、可观测、测试，不接受只补局部函数 |
| 真实验收 | 验收必须通过用户可见入口或完整 runner，不能只调用内部函数 |
| Baseline 门禁 | 涉及个人助理主链路的功能必须进入 `PA-BL-001` 或其扩展场景 |
| 安全优先 | 授权、审批、secret、消息发送、终端、MCP、浏览器、webhook 的失败即 blocker |
| 文档同步 | 每完成一项必须更新 progress log、acceptance oracle 或 roadmap 中对应状态 |

状态定义：

| 状态 | 含义 |
|---|---|
| `missing` | 当前没有可用产品能力 |
| `skeleton` | 有类型、接口、mock 或局部实现，但不能作为真实用户能力交付 |
| `partial` | 有可运行实现，但缺少产品入口、真实平台联调、持久化、安全或完整验收 |
| `covered` | 已有实现和 focused tests，但仍需进入 baseline 或生产化验收 |

---

## 2. 需求表

| ID | 需求 | 对标来源 / 个人助理理由 | 当前状态 | 优先级 | 验收门槛 |
|---|---|---|---|---|---|
| PA-GAP-001 | 产品级 Baseline Runner | 个人助理必须有完整回归门禁；当前只有设计规格 | covered | P0 | `PA-BL-001` deterministic runner 12 轮主链路 + S1~S12 全过 |
| PA-GAP-002 | 安装、onboarding、daemon、自启动 | OpenClaw `onboard --install-daemon`，Hermes setup | covered | P0 | 新用户一条命令完成配置、启动守护进程、重启后仍可用 |
| PA-GAP-003 | doctor / health / config dry-run | OpenClaw `doctor` 和运维诊断 | covered | P0 | 能发现危险 DM policy、缺失 token、端口冲突、SQLite 权限、provider 超时配置 |
| PA-GAP-004 | 真实 CLI/TUI 产品 | Hermes TUI、多行输入、autocomplete、interrupt | covered | P0 | `neurocore assistant` 可交互聊天，支持 slash autocomplete、history、streaming status |
| PA-GAP-005 | 会话 UX 命令 | OpenClaw/Hermes `/retry`、`/undo`、`/personality`、`/insights`、`/trace` | covered | P0 | WebChat/CLI/IM 语义一致，命令不误触模型，trace 可证明 |
| PA-GAP-006 | DM pairing、allowlist、home channel | OpenClaw/Hermes DM pairing、安全默认 | covered | P0 | 未授权消息不进 runtime，`/pair` 后才绑定 canonical user，审计记录完整 |
| PA-GAP-007 | 模型选择、fallback、health check | Hermes `hermes model`，OpenClaw model failover | partial | P0 | 可在会话中切换模型，provider 失败自动 fallback，所有切换可审计 |
| PA-GAP-008 | 凭据保险箱 / secret 最小权限 | 个人助理应管理 OAuth/API key/MCP secret | missing | P0 | token 不进 artifact，不进默认沙箱，工具按作用域取临时凭据 |
| PA-GAP-009 | 产品级文件工具 | OpenClaw workspace/files，Hermes terminal workflows | partial | P0 | read/write/edit/diff/rollback/approval 全链路通过真实 workspace 验收 |
| PA-GAP-010 | 终端后台进程管理 | Hermes streaming tool output、process poll/wait/kill | skeleton | P0 | 可启动、查看日志、写 stdin、等待、kill，异常后无孤儿进程 |
| PA-GAP-011 | 真实浏览器 profile | OpenClaw browser profile、截图、PDF、登录态浏览器 | partial | P0 | 浏览器 session 与 task 绑定，截图/snapshot/PDF 有 artifact，结束自动清理 |
| PA-GAP-012 | 通用 webhook + Gmail Pub/Sub | OpenClaw webhooks/Gmail PubSub | partial | P0 | webhook token 鉴权、payload untrusted、可路由到 session/task、可审计 |
| PA-GAP-013 | 通知策略 | 个人助理需要 quiet hours、priority、fallback channel | skeleton | P0 | urgent/normal/silent、勿扰、升级通知、跨渠道 fallback 均可测 |
| PA-GAP-014 | 用户数据和隐私控制台 | 个人助理必须能查看/导出/删除记忆和轨迹 | partial | P0 | 用户可导出、删除、冻结 memory/trace/tool records，生成审计 |
| PA-GAP-015 | 任务板产品化 | Hermes background tasks，个人助理长期任务 | partial | P0 | 用户可查看任务目标、状态、产物、失败原因、重试、取消、关联 trace |
| PA-GAP-016 | 技能市场和安装审计 | Hermes Skills Hub，OpenClaw ClawHub | partial | P1 | 搜索/安装/审计/启用/禁用技能，权限和风险可见 |
| PA-GAP-017 | OpenClaw/Hermes 迁移器 | Hermes 支持迁移 OpenClaw 数据 | missing | P1 | 可导入 persona、memory、skills、allowlist、channels，支持 dry-run 和去重 |
| PA-GAP-018 | WhatsApp / Signal / WeChat / Matrix / Teams | OpenClaw 多渠道覆盖 | missing | P1 | 每个渠道至少通过配对、收发、审批、handoff、记忆注入 smoke |
| PA-GAP-019 | 语音 STT/TTS 和 push-to-talk | OpenClaw mac/iOS/Android voice，Hermes voice memo | skeleton | P1 | voice 输入转写入 runtime，TTS 输出可投递，失败有文本 fallback |
| PA-GAP-020 | 桌面/移动节点 | OpenClaw macOS/iOS/Android/headless nodes | missing | P1 | 节点配对、能力声明、权限、camera/screen/voice/canvas 至少一条 E2E |
| PA-GAP-021 | Canvas / artifact surface | OpenClaw live Canvas | missing | P1 | agent 可生成、更新、版本化、预览、回滚 HTML/Canvas artifact |
| PA-GAP-022 | 个人知识库接入 | 个人助理需要本地/云盘/Obsidian/Notion/PDF/OCR | partial | P1 | 文档 ingestion、索引、引用、权限、删除和重新索引可验证 |
| PA-GAP-023 | 联系人和关系图谱 | 个人助理需要理解同事/家人/客户/群关系 | missing | P1 | contact graph 可查询、授权、用于消息发送确认和记忆 scope |
| PA-GAP-024 | 多 profile 产品入口 | 工作/家庭/开发/财务模式隔离 | partial | P1 | 用户可切换 profile，memory/tool/channel/policy 隔离，错误跨域为 0 |
| PA-GAP-025 | 高级沙箱后端 | Hermes Daytona/Modal/Singularity | partial | P1 | local/docker/ssh 之外至少接入一个 remote/serverless backend 并通过任务恢复验收 |
| PA-GAP-026 | MCP 产品化治理 | Hermes MCP integration | partial | P1 | MCP server discovery、include/exclude、secret filtering、untrusted result 标记、动态刷新审计 |
| PA-GAP-027 | 自学习技能闭环产品化 | Hermes built-in learning loop | partial | P1 | 从成功 workflow 生成候选技能，经回归验证后启用，失败可 rollback |
| PA-GAP-028 | 轨迹训练数据流水线 | Hermes batch trajectory / RL env | partial | P2 | batch generation、compression、redaction、eval/training artifact 全链路 |
| PA-GAP-029 | 备份、恢复、同步、加密 | 个人助理长期数据必须可迁移和恢复 | covered | P2 | 一键备份/恢复，跨设备同步冲突可处理，敏感数据加密 |
| PA-GAP-030 | Home Assistant / IoT | OpenClaw/Hermes messaging 和设备生态延伸 | missing | P2 | 家庭自动化工具有授权、dry-run、approval、状态回读和审计 |

---

## 3. 完整执行计划

### Phase A：Baseline 与产品外壳

目标：先让个人助理具备“可测、可启动、可诊断、可回归”的产品外壳。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| A1 | PA-GAP-001 Baseline Runner | deterministic `PA-BL-001` 通过并输出 artifact |
| A2 | PA-GAP-002 安装/onboarding/daemon | 一条命令完成安装和自启动 |
| A3 | PA-GAP-003 doctor/health/config dry-run | doctor 能发现 10 类典型配置问题 |
| A4 | PA-GAP-004 真实 CLI/TUI | CLI/TUI 与 WebChat 跑通同一 baseline 子集 |

### Phase B：会话、身份、安全和模型

目标：补齐 OpenClaw/Hermes 的日常个人助理入口体验和安全默认。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| B1 | PA-GAP-005 会话 UX 命令 | `/retry`、`/undo`、`/personality`、`/insights`、`/trace` 跨入口一致 |
| B2 | PA-GAP-006 DM pairing / home channel | 未配对用户 0 进入 runtime |
| B3 | PA-GAP-007 模型选择/fallback/health | provider failure 不影响下一轮对话 |
| B4 | PA-GAP-008 凭据保险箱 | token 0 泄漏，sandbox 默认无 secret |

### Phase C：执行工具和外部事件

目标：让个人助理真正能安全执行文件、终端、浏览器、webhook、通知和任务。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| C1 | PA-GAP-009 文件工具 | diff/rollback/approval 可通过真实 workspace 验收 |
| C2 | PA-GAP-010 终端后台进程 | start/log/wait/kill/write 全链路 |
| C3 | PA-GAP-011 浏览器 profile | 登录态、安全清理、截图 artifact 可验证 |
| C4 | PA-GAP-012 webhook/Gmail PubSub | untrusted payload 进入 policy，事件可路由 |
| C5 | PA-GAP-013 通知策略 | quiet hours 和 fallback channel 生效 |
| C6 | PA-GAP-015 任务板 | task UI/API 可恢复、重试、取消、追踪 |

### Phase D：数据、记忆、知识库和隐私

目标：从“会记住”升级为“用户能治理自己的长期数据”。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| D1 | PA-GAP-014 用户数据和隐私控制台 | export/delete/freeze 可从 UI/API 执行 |
| D2 | PA-GAP-022 知识库接入 | 文件/云文档/PDF/OCR ingestion 和引用可验收 |
| D3 | PA-GAP-023 联系人关系图谱 | 关系图谱影响消息发送和 memory scope |
| D4 | PA-GAP-024 多 profile 产品入口 | profile 隔离通过跨域泄漏测试 |

### Phase E：渠道、语音、端侧和 Canvas

目标：达到 OpenClaw 的跨设备、多渠道、语音和可视化水位。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| E1 | PA-GAP-018 扩展渠道 | WhatsApp/Signal/WeChat/Matrix/Teams 分批通过 smoke |
| E2 | PA-GAP-019 STT/TTS | 语音输入输出可用且有 fallback |
| E3 | PA-GAP-020 桌面/移动节点 | 节点配对和至少一个端侧能力 E2E |
| E4 | PA-GAP-021 Canvas/artifact surface | artifact 可版本化、预览、回滚 |

### Phase F：生态、迁移、沙箱和自学习

目标：达到并超过 Hermes 的可扩展和自学习水位。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| F1 | PA-GAP-016 技能市场 | 安装、审计、启用、禁用技能全链路 |
| F2 | PA-GAP-017 迁移器 | OpenClaw/Hermes dry-run 和真实导入通过 |
| F3 | PA-GAP-025 高级沙箱后端 | remote/serverless backend 可恢复任务 |
| F4 | PA-GAP-026 MCP 产品化治理 | 动态刷新、secret filtering、untrusted marker 全过 |
| F5 | PA-GAP-027 自学习技能闭环 | 候选技能验证、启用、回滚全链路 |

### Phase G：长期数据、训练和家庭自动化

目标：形成长期个人 AI 系统，不只是聊天工具。

| 顺序 | 需求 | 退出条件 |
|---|---|---|
| G1 | PA-GAP-028 轨迹训练数据流水线 | batch trajectory -> redaction -> eval/training artifact |
| G2 | PA-GAP-029 备份恢复同步加密 | 备份恢复和跨设备同步冲突处理 |
| G3 | PA-GAP-030 Home Assistant / IoT | 家庭自动化 dry-run、approval、审计全链路 |

---

## 4. 每个功能的分析、执行、验收过程

### PA-GAP-001：产品级 Baseline Runner

| 阶段 | 过程 |
|---|---|
| 分析 | 对照 `09_personal-assistant-baseline-test.md`，列出 12 轮主链路和 S1~S12 场景当前已有测试覆盖、缺失 artifact、缺失 driver |
| 执行 | 新增 baseline runner、deterministic fixture、artifact writer、verdict schema、accepted baseline summary |
| 验收 | 运行 `node --test tests/personal-assistant-baseline.test.mjs`，检查 `.neurocore/baselines/personal-assistant/*/verdict.json` 全 pass |

### PA-GAP-002：安装、onboarding、daemon、自启动

| 阶段 | 过程 |
|---|---|
| 分析 | 梳理当前 `npm run demo:personal-assistant:web` 需要的手工步骤、配置文件、端口、DB、provider token |
| 执行 | 新增 `neurocore assistant setup/start/stop/status/install-daemon`，生成本地配置并支持 launchd/systemd user service |
| 验收 | 在临时 HOME 中执行 setup；重启 daemon 后 WebChat health 通过；删除配置后 setup 可重跑 |

### PA-GAP-003：doctor / health / config dry-run

| 阶段 | 过程 |
|---|---|
| 分析 | 枚举配置风险：token 缺失、provider 慢、端口占用、DB 不可写、DM open、approval 关闭、sandbox 缺失 |
| 执行 | 新增 doctor checks、config dry-run、risk report、修复建议和 JSON 输出 |
| 验收 | 注入坏配置 fixture，doctor 必须发现每类风险；JSON report 可被测试解析 |

### PA-GAP-004：真实 CLI/TUI 产品

| 阶段 | 过程 |
|---|---|
| 分析 | 对比当前 `CliAdapter.receiveText()` 与 Hermes TUI 能力：多行、历史、autocomplete、interrupt、status、stream output |
| 执行 | 新增交互式 CLI/TUI，复用 Gateway/CommandHandler，不复制业务逻辑 |
| 验收 | 通过 pseudo-terminal 测试输入多行消息、slash autocomplete、Ctrl+C interrupt、status stream |

### PA-GAP-005：会话 UX 命令

| 阶段 | 过程 |
|---|---|
| 分析 | 检查 CommandHandler 当前命令，定义 `/retry`、`/undo`、`/personality`、`/insights`、`/trace` 的状态语义 |
| 执行 | 命令 schema 注册，WebChat/CLI/IM 共用；实现上一轮 replay、exchange rollback、persona override、usage insight、trace toggle |
| 验收 | 同一 chat 在 WebChat 和 CLI 执行命令，session state、history、trace、output 一致 |

### PA-GAP-006：DM pairing、allowlist、home channel

| 阶段 | 过程 |
|---|---|
| 分析 | 审计 `allowed_senders`、`PlatformUserLinkStore`、channel binding，找出未授权消息进入 runtime 的路径 |
| 执行 | 实现 pairing code、`/pair`、`/sethome`、allow/block 命令、授权 audit |
| 验收 | 未授权 sender 只收到 pairing prompt；配对后才创建 route；撤销后无法继续进入 runtime |

### PA-GAP-007：模型选择、fallback、health check

| 阶段 | 过程 |
|---|---|
| 分析 | 梳理 `OpenAICompatibleReasoner`、本地配置、超时、extraBody、模型切换缺口 |
| 执行 | 增加 provider registry、session model override、fallback chain、health probe、`/model` 扩展 |
| 验收 | mock 主 provider 429/timeout，自动 fallback；`/model` 切换只影响当前 scope 并写 audit |

### PA-GAP-008：凭据保险箱 / secret 最小权限

| 阶段 | 过程 |
|---|---|
| 分析 | 查找配置、artifact、sandbox、MCP、tool args 中 secret 流动路径 |
| 执行 | 新增 vault abstraction、secret ref、scoped credential lease、artifact redactor、sandbox deny-by-default |
| 验收 | grep artifacts 不出现 token；sandbox 环境不含默认 secret；工具只能读取授权 scope secret |

### PA-GAP-009：产品级文件工具

| 阶段 | 过程 |
|---|---|
| 分析 | 定义 workspace root、文件权限、diff preview、rollback、审批边界 |
| 执行 | 实现 read/write/edit/apply_patch/list/search 工具和 policy，写入 trace 和 artifact |
| 验收 | 在临时 workspace 完成读改回滚；高风险路径写入必须先审批；diff 与最终文件一致 |

### PA-GAP-010：终端后台进程管理

| 阶段 | 过程 |
|---|---|
| 分析 | 对比当前 sandbox exec 与 Hermes process lifecycle，定义 process id、日志、stdin、kill、timeout |
| 执行 | 新增 background process store 和工具：start/poll/log/write/wait/kill |
| 验收 | 启动长进程、读取增量日志、写 stdin、kill 后无残留进程；失败写入 task ledger |

### PA-GAP-011：真实浏览器 profile

| 阶段 | 过程 |
|---|---|
| 分析 | 审计当前 browser connector 是否只 fetch 文本，定义真实浏览器 profile、截图、PDF、cookie、清理边界 |
| 执行 | 接入 browser session provider，提供 navigate/click/type/screenshot/pdf/snapshot 工具 |
| 验收 | 使用本地测试页完成登录态导航和截图；session 结束后 profile 清理；untrusted 内容标记保留 |

### PA-GAP-012：通用 webhook + Gmail Pub/Sub

| 阶段 | 过程 |
|---|---|
| 分析 | 梳理 runtime-server webhook 与 personal gateway webhook 缺口，定义 path、token、payload schema |
| 执行 | 新增 webhook ingress、Gmail Pub/Sub adapter、route mapping、policy screening |
| 验收 | 伪造无 token 请求被拒；合法 webhook 创建 task/session；payload 被标记 untrusted |

### PA-GAP-013：通知策略

| 阶段 | 过程 |
|---|---|
| 分析 | 列出现有 `NotificationPriority` 与实际投递缺口，定义 quiet hours、fallback、dedupe、escalation |
| 执行 | 新增 notification policy store、delivery planner、channel fallback、dedupe key |
| 验收 | quiet hours 内 normal 静默、urgent 可升级；主渠道失败后 fallback；重复提醒被合并 |

### PA-GAP-014：用户数据和隐私控制台

| 阶段 | 过程 |
|---|---|
| 分析 | 梳理 memory、session、trace、tool、approval、artifact 存储位置和删除依赖 |
| 执行 | 新增 data subject API：export/delete/freeze/list-retention，Console 页面接入 |
| 验收 | 对测试用户导出完整数据；删除后 recall/search/trace 不再返回；audit 保留删除事实 |

### PA-GAP-015：任务板产品化

| 阶段 | 过程 |
|---|---|
| 分析 | 对照 `BackgroundTaskLedger` 和 governance console，定义用户可见任务字段、状态转换和失败恢复 |
| 执行 | 持久化 task ledger、任务详情 API、retry/cancel/resume、产物链接、失败通知 |
| 验收 | 创建 cron/subagent/webhook 三类任务，任务板能查看、取消、重试，并关联 trace |

### PA-GAP-016：技能市场和安装审计

| 阶段 | 过程 |
|---|---|
| 分析 | 对照 AgentSkills、Skills Hub/ClawHub，审计当前 registry 能力和安装缺口 |
| 执行 | 新增 skill source、search/install/update/remove/audit、permission manifest、版本 pin |
| 验收 | 从 fixture registry 安装技能；风险权限展示；禁用后不能触发；升级失败可回滚 |

### PA-GAP-017：OpenClaw/Hermes 迁移器

| 阶段 | 过程 |
|---|---|
| 分析 | 定义可迁移对象：persona、memory、skills、allowlist、channels、API key refs、workspace instructions |
| 执行 | 新增 dry-run importer、mapping report、dedupe、provenance、conflict handling |
| 验收 | 使用 synthetic OpenClaw/Hermes HOME 导入；dry-run 不写入；真实导入后 memory/skills/profile 可查询 |

### PA-GAP-018：WhatsApp / Signal / WeChat / Matrix / Teams

| 阶段 | 过程 |
|---|---|
| 分析 | 每个渠道确认 API、鉴权、消息模型、thread/reaction/media/approval 能力 |
| 执行 | 分批新增 adapter，全部接入统一 Gateway、pairing、allowed sender、delivery fallback |
| 验收 | 每渠道通过收发、短上下文 handoff、approval request、media fallback smoke |

### PA-GAP-019：语音 STT/TTS 和 push-to-talk

| 阶段 | 过程 |
|---|---|
| 分析 | 审计当前 audio/voice attachment，只保留 transcript 字段但无真实 STT/TTS |
| 执行 | 接入 STT/TTS provider SPI、voice command、push-to-talk event、文本 fallback |
| 验收 | fixture 音频转写进入 runtime；回复生成音频并投递；STT/TTS 失败时文本可用 |

### PA-GAP-020：桌面/移动节点

| 阶段 | 过程 |
|---|---|
| 分析 | 定义 node pairing、capability manifest、device permission、camera/screen/location/canvas 命令 |
| 执行 | 新增 node gateway protocol 和最小 headless/node simulator，再接桌面或移动端 |
| 验收 | simulator 完成配对、声明能力、执行一个 screen/camera mock command，审计权限 |

### PA-GAP-021：Canvas / artifact surface

| 阶段 | 过程 |
|---|---|
| 分析 | 定义 Canvas artifact 类型、版本、权限、预览、回滚、与 WebChat/Console 的展示关系 |
| 执行 | 新增 artifact store、canvas renderer、agent update tool、diff/version API |
| 验收 | agent 创建并修改 HTML artifact；用户可预览、回滚；恶意脚本被 sandbox/CSP 限制 |

### PA-GAP-022：个人知识库接入

| 阶段 | 过程 |
|---|---|
| 分析 | 列出本地目录、Obsidian、Notion、Google Drive、PDF/OCR 的最小接入路径和权限 |
| 执行 | 新增 document ingestion、index、citation、delete/reindex、permission scope |
| 验收 | 导入 fixture 文档，问答必须带 citation；删除后检索不到；OCR/PDF 进入 artifact |

### PA-GAP-023：联系人和关系图谱

| 阶段 | 过程 |
|---|---|
| 分析 | 定义 contact、organization、relationship、channel identity、trust level 和 consent |
| 执行 | 新增 contact graph store、resolver、message confirmation policy、memory scope binding |
| 验收 | “发给老板”必须解析到唯一联系人或要求澄清；错误联系人不发送；关系变更有 audit |

### PA-GAP-024：多 profile 产品入口

| 阶段 | 过程 |
|---|---|
| 分析 | 审计已有 profile registry/channel binding，确认用户如何创建、切换、查看 profile |
| 执行 | 新增 `/agents`、`/profile`、Console profile UI、policy template、memory/tool isolation |
| 验收 | 工作/家庭 profile 间 memory/tool/channel 不串；切换后 route 和 audit 正确 |

### PA-GAP-025：高级沙箱后端

| 阶段 | 过程 |
|---|---|
| 分析 | 对比 local/docker/ssh 与 Daytona/Modal/Singularity 的持久化、成本、恢复、安全边界 |
| 执行 | 选择一个 remote/serverless backend 先接入 SandboxProvider，支持 hibernate/resume metadata |
| 验收 | 创建远程任务，服务重启后恢复环境，secret 不默认注入，费用/生命周期可见 |

### PA-GAP-026：MCP 产品化治理

| 阶段 | 过程 |
|---|---|
| 分析 | 审计当前 MCP client 的 discovery、include/exclude、secret、untrusted result、刷新能力 |
| 执行 | 新增 MCP server registry、credential policy、dynamic refresh、resource/prompt safety、audit |
| 验收 | 接入 fixture MCP server；禁用工具不可调用；返回 prompt injection 被标记 untrusted |

### PA-GAP-027：自学习技能闭环产品化

| 阶段 | 过程 |
|---|---|
| 分析 | 审计 AutoSkillManager 是否接入真实 workflow、review、registry、回归执行 |
| 执行 | 从 trajectory/workflow 自动提候选，生成 regression，人工或策略审核后启用 |
| 验收 | 3 次成功 workflow 生成 candidate；验证通过后可触发；失败版本可 rollback |

### PA-GAP-028：轨迹训练数据流水线

| 阶段 | 过程 |
|---|---|
| 分析 | 对齐 Hermes batch trajectory、RL env，梳理当前 trajectory export 和 eval-core 缺口 |
| 执行 | 新增 batch runner、trajectory compression、redaction policy、dataset manifest、eval adapter |
| 验收 | 生成 N 条脱敏 trajectory，可 replay，可转 eval/training artifact，schema 校验通过 |

### PA-GAP-029：备份、恢复、同步、加密

| 阶段 | 过程 |
|---|---|
| 分析 | 梳理 SQLite、artifact、skills、config、vault、profile 的备份依赖和冲突模型 |
| 执行 | 新增 backup/export、restore dry-run、encryption、sync conflict resolver |
| 验收 | 在新临时 HOME restore 后 baseline 子集通过；冲突报告可读；敏感备份加密 |

### PA-GAP-030：Home Assistant / IoT

| 阶段 | 过程 |
|---|---|
| 分析 | 定义 Home Assistant 认证、entity discovery、dry-run、危险动作审批、状态回读 |
| 执行 | 新增 HA connector/toolset，接入 policy、approval、trace、contact/location context |
| 验收 | fixture HA server 中执行开灯 dry-run、审批后执行、状态回读、错误 entity 不执行 |

---

## 5. 统一验收命令矩阵

| 阶段 | 必须命令 |
|---|---|
| 每项开工前 | `npm run pa:plan-check` |
| 每项基础回归 | `npm run build` |
| Gateway/命令/渠道 | `node --test tests/personal-assistant-gateway.test.mjs tests/personal-assistant-web-chat.test.mjs` |
| 安全/审批 | `node --test tests/personal-assistant-approval.test.mjs tests/policy-governance.test.mjs` |
| 自动化/任务 | `node --test tests/personal-assistant-proactive.test.mjs` |
| 记忆/知识库 | `node --test tests/personal-assistant-e2e.test.mjs tests/personal-assistant-memory-search.test.mjs` |
| 子 Agent/沙箱/MCP | 对应 focused tests + `node --test tests/runtime.test.mjs` |
| 产品级收口 | `node --test tests/personal-assistant-baseline.test.mjs` |
| Live provider 收口 | `PERSONAL_ASSISTANT_LIVE_BASELINE=1 node examples/personal-assistant/scripts/run-baseline.mjs` |

---

## 6. 进入实施前的下一步

| 顺序 | 动作 | 输出 |
|---|---|---|
| 1 | 已将 PA-GAP-001 ~ PA-GAP-030 导入 `project-ledger.json` | 机器可读任务队列 |
| 2 | 已执行 PA-GAP-001 | Baseline runner 和 accepted baseline |
| 3 | 已执行 PA-GAP-003 | doctor、health、config dry-run 和诊断回归 |
| 4 | 已执行 PA-GAP-004 | 交互式 CLI/TUI、slash autocomplete、多行输入、status stream 和 Ctrl+C interrupt |
| 5 | 每完成一项更新本文档状态列 | 从 `missing/skeleton/partial` 前移到 `covered` |
| 6 | Phase 收口后提交并 push | 可恢复长任务 checkpoint |
