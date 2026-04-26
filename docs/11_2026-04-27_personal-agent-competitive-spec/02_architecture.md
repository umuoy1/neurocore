# Personal Agent Competitive Architecture

> 日期：2026-04-27
> 上位规格：[`01_openclaw-hermes-feature-map.md`](./01_openclaw-hermes-feature-map.md)
> 目标：把 OpenClaw / Hermes 对标功能压成 NeuroCore 可实现的个人助理架构边界。

---

## 1. 架构原则

| 原则 | 要求 |
|---|---|
| Runtime first | 个人助理不得绕过 `runtime-core / runtime-server / policy-core / memory-core` 重造一条执行链 |
| Gateway only at edge | WebChat、CLI、IM、Email、Webhook 只负责 ingress/egress，不拥有业务状态 |
| SQL-first durability | 会话、任务、记忆、审批、cron、hook、channel binding 都必须有可恢复持久化 |
| Unified command plane | slash command 在 CLI / WebChat / IM 中语义一致 |
| Every action traceable | tool、message send、cron、subagent、memory write 都必须进入 trace 或 task ledger |
| Test-oracle driven | 每个能力必须绑定 acceptance oracle 和测试命令，不能靠手测完成 |

---

## 2. 组件边界

| 组件 | 职责 | 禁止事项 |
|---|---|---|
| PersonalGateway | 统一 WebChat / CLI / IM / Email / Webhook ingress，做身份、渠道能力、消息规范化 | 不直接执行工具，不直接写长期记忆 |
| ConversationRouter | 把 channel/thread/user 映射到 runtime session，处理 handoff、resume、focus、home channel | 不持有模型 provider 逻辑 |
| CommandPlane | 解析 slash command，执行命令 schema 校验、权限检查和 dispatch | 不允许命令绕过 policy/approval |
| PersonalMemoryFacade | 统一显式个人记忆、session search、semantic card、recall bundle | 不允许以 prompt 文件作为事实源 |
| ToolControlPlane | 将工具集、审批、风险、沙箱、budget、trace 串成单一路径 | 不允许工具直接从 adapter 调用 |
| AutomationPlane | cron、heartbeat、webhook、background task、standing orders | 不允许不可追踪的后台执行 |
| ChannelRegistry | 管理 channel adapter、capabilities、home channel、delivery status | 不允许渠道私有状态影响 runtime 真相层 |
| AgentProfileRegistry | 管理个人/工作/家庭/开发 agent profile、workspace、memory scope、policy scope | 不允许跨 profile 泄露记忆或工具权限 |
| PersonalOpsConsole | 展示 session、task、cron、memory、tool、approval、subagent 的统一治理视图 | 不作为唯一控制入口，CLI/IM 必须可等价操作 |

---

## 3. 主数据模型

| 对象 | 关键字段 | 真相源 |
|---|---|---|
| `PersonalChannel` | `channel_id`, `kind`, `capabilities`, `auth_state`, `home_target` | Gateway store |
| `PersonalIdentity` | `identity_id`, `tenant_id`, `display_name`, `platform_refs`, `trust_level` | Gateway store |
| `ConversationRoute` | `route_id`, `channel_id`, `thread_ref`, `session_id`, `focus_agent_id`, `handoff_digest` | Conversation store |
| `PersonalCommand` | `command_id`, `schema`, `risk_level`, `handler_ref`, `allowed_channels` | Command registry |
| `PersonalTask` | `task_id`, `source`, `status`, `session_id`, `origin_channel`, `budget`, `result_ref` | Task ledger |
| `PersonalCron` | `cron_id`, `schedule`, `prompt`, `delivery_target`, `policy`, `last_run` | Automation store |
| `PersonalMemoryRecord` | `memory_id`, `type`, `subject`, `claim`, `evidence_refs`, `lifecycle`, `freshness` | Memory store |
| `ChannelDelivery` | `delivery_id`, `target`, `payload_hash`, `status`, `provider_message_id` | Gateway store |

---

## 4. 主流程

### 4.1 用户消息流程

1. Channel adapter 接收平台事件。
2. `PersonalGateway` 归一化为 `PersonalIngressMessage`。
3. `ConversationRouter` 解析 identity、channel、thread、focus agent 和 session。
4. Router 在终态/空闲 session 重开时生成 `conversation_handoff`。
5. `CommandPlane` 先尝试解析 slash command。
6. 普通消息进入 NeuroCore runtime session。
7. Runtime 执行 recall、reasoning、tool、approval、response。
8. Gateway 根据 channel capability 投递文本、文件、reaction、card 或 voice。
9. 重要事实进入 memory candidate pipeline。

### 4.2 slash command 流程

1. `CommandPlane` 根据命令 schema 解析参数。
2. 根据 identity、channel、agent profile 和 command risk 做 policy check。
3. 需要审批的命令进入 ApprovalCenter。
4. 命令 handler 只调用 runtime/tool/memory/task 的正式 SPI。
5. 命令结果进入当前会话 trace，并通过原渠道回传。

### 4.3 自动化流程

1. cron / heartbeat / webhook 创建 `PersonalTask`。
2. Task 绑定 origin channel、delivery target、agent profile、预算和 policy。
3. AutomationPlane 启动 runtime session 或恢复指定 session。
4. 执行过程全部进入 task ledger 和 trace。
5. 完成、失败、超时、取消都回写 task 状态。
6. 需要通知时通过 ChannelRegistry 投递。

### 4.4 子 Agent 流程

1. 主会话通过 CommandPlane 或 runtime action 创建 child task。
2. 子 Agent 获得独立 session、workspace、budget、tool policy。
3. 子 Agent 的结果只通过 task result contract 回流。
4. 主 Agent 验证结果后决定是否合并、继续或要求返工。
5. cascade stop 必须终止所有 child task 和后台工具。

---

## 5. 与现有代码对齐

| 现有位置 | 后续角色 |
|---|---|
| `examples/personal-assistant/src/im-gateway/` | P0 可保留为 PersonalGateway 第一版实现基础 |
| `examples/personal-assistant/src/memory/` | P0 接入 PersonalMemoryFacade，后续迁移到平台层 store |
| `examples/personal-assistant/src/proactive/` | P0/P1 升级为 AutomationPlane 的 heartbeat/cron 子集 |
| `packages/runtime-core` | 所有用户任务最终执行主链 |
| `packages/runtime-server` | Hosted Runtime、Console、治理 API 复用层 |
| `packages/memory-core` | typed memory、recall bundle、semantic card、LongMemEval 回归 |
| `packages/policy-core` | approval、risk、tool policy、channel policy |
| `packages/multi-agent` | subagent、agent registry、delegation、shared state |

---

## 6. 非目标

| 非目标 | 原因 |
|---|---|
| 直接复制 OpenClaw / Hermes 代码 | 目标是功能对标和架构超越，不引入外部实现耦合 |
| 单独做一个飞书机器人 | 对标对象是跨渠道 personal agent runtime |
| 用 prompt 文件替代数据库记忆 | 无法满足治理、检索、冲突和评测要求 |
| 无测试先堆功能 | 长任务会漂移，必须先有 acceptance oracle |
| 绕过 runtime-server 做私有后台任务 | 后台任务必须可审计、可恢复、可治理 |

