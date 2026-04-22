# 个人助理实施计划

> 基于 `02_personal-assistant-architecture.md` 的架构设计，制定分阶段、可施工的实施计划。
> IM 平台：仅实现飞书 Adapter + Web Chat。
> 每个里程碑包含明确的交付物、验收标准和依赖关系。
> 实现形态：**个人助理作为 `examples/personal-assistant/` 下的独立应用落地**，不新增 `packages/im-gateway` / `packages/proactive-engine` / `packages/service-connectors`。
>
> 2026-04-02 排期说明：
> - 个人助理是当前主优先级方向。
> - 近期仍以 Phase A 为主；M11 当前阶段已完成，个人助理后续只消费既有 Console / Hosted Runtime 能力，不再与“Console 准备工作”并行排期。
> - 完成当前阶段后，下一步转入 `docs/05_2026-04-01_memory-evolution/`。

---

## 1. 阶段总览

```
Phase A (基础能力) ─── M-PA-1 ~ M-PA-4 ─── 约 3~4 周
│  IM Gateway 核心 + 飞书 Adapter + Web Chat + 搜索/浏览器连接器 + Agent 组装
│  依赖：仅 NeuroCore 第一阶段（已有）
│
Phase B (进阶能力) ─── M-PA-5 ~ M-PA-8 ─── 约 4~6 周
│  主动引擎 + 邮件/日历连接器 + 跨通道会话
│  依赖：Phase A 完成 + NeuroCore 多 Agent (M9, 已有)
│
Phase C (高级能力) ─── M-PA-9 ~ M-PA-11 ── 约 6~8 周
   知识库 + 技能市场 + 多设备
   依赖：Phase B 完成
```

### 子 Agent 编排原则

- 个人助理不内置固定的 `search / writer / formatter` 三类子 Agent。
- `createPersonalAssistant()` 负责组装主 Agent、连接器和委派能力，不负责把未来任务写死成某条固定子 Agent 流程。
- 从 Phase B 起，主 Agent 应基于 Goal 分解、capability 匹配、工具域、预算和风险，自主决定是否委派、委派几个子 Agent、以及每个子 Agent 的权限边界。
- 产品层实现上更适合维护一个开放式 `worker catalog`，而不是硬编码少量角色名字。

---

## 2. Phase A：基础能力

### M-PA-1: IM Gateway 核心 + 飞书 Adapter + Web Chat

**交付物**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `examples/personal-assistant/src/im-gateway/types.ts` | `UnifiedMessage`、`IMPlatform`、`MessageContent`、`IMAdapterConfig` |
| 2 | `examples/personal-assistant/src/im-gateway/adapter/im-adapter.ts` | `IMAdapter` SPI 接口 |
| 3 | `examples/personal-assistant/src/im-gateway/adapter/feishu.ts` | 飞书 Bot — 基于 `@larksuiteoapi/node-sdk` |
| 4 | `examples/personal-assistant/src/im-gateway/adapter/web-chat.ts` | WebSocket 聊天服务（基于 `ws`） |
| 5 | `examples/personal-assistant/src/im-gateway/conversation/conversation-router.ts` | `ConversationRouter` — `(platform, chat_id) → session_id` 映射 |
| 6 | `examples/personal-assistant/src/im-gateway/conversation/session-mapping-store.ts` | `SessionMappingStore` — 持久化映射关系（InMemory + SQLite） |
| 7 | `examples/personal-assistant/src/im-gateway/notification/notification-dispatcher.ts` | `NotificationDispatcher` |
| 8 | `examples/personal-assistant/src/im-gateway/gateway.ts` | `IMGateway` 主类 |
| 9 | `examples/personal-assistant/src/main.ts` | 应用入口与装配 |
| 10 | `examples/personal-assistant/package.json` | 独立示例应用配置 |

**飞书 Adapter 实现要点**：

- 使用 `@larksuiteoapi/node-sdk` 官方 SDK
- **长连接模式**（推荐）：无需公网 IP，`lark.WSClient` 建立 WebSocket
- 事件订阅：`im.message.receive_v1`（收消息）、`card.action.callback`（卡片按钮回调）
- 消息发送：`client.im.message.create()`（文本）、`client.im.message.patch()`（更新卡片）
- 审批卡片：Interactive Card 按钮 → 回调 → 映射为 approval decision
- 支持命令识别：`/new`、`/reset`、`/status` 等（通过 `metadata.is_command` 标记）

**Web Chat Adapter 实现要点**：

- 基于 `ws` 库的 WebSocket 服务
- 每个连接分配唯一 `chat_id`
- 支持消息发送与编辑两类推送，前端通过 `Reasoner.streamText -> runtime.output -> edit` 原生文本流增量更新同一条 assistant 回复
- 暴露 `runtime.status` 运行状态流，至少覆盖 `session / memory_retrieval / reasoning / tool_execution / response_generation / approval`
- Web 页面把聊天消息与运行活动分开展示，用于本地开发测试与调试
- Hosted Runtime / SSE 订阅与飞书推送都复用同一套 `runtime.output / runtime.status` 事件，不保留单独的旧文本输出路径
- Web Chat 活动面板与 Console `SessionDetailPage` 均展示结构化 `phase/state/detail/data`，不再只显示最终文本

**ConversationRouter 细节**：

- `SessionMappingStore` 存储 `Map<(platform, chat_id), session_id>`
- 新消息 → 查找映射 → 活跃（30min 内）→ `connectSession().runText(msg)`
- 已超时 → checkpoint → 新建 session
- 未找到 → 新建 session → 记录映射

**验收标准**：

- AC-1.1：飞书 Bot 可收发文本消息，消息归一化为 `UnifiedMessage`
- AC-1.2：Web Chat 可通过 WebSocket 收发消息
- AC-1.2a：Web Chat 通过原生 `streamText` 文本流支持 assistant 文本增量编辑，前端无需等待最终整段回复
- AC-1.2b：Web Chat 通过 `runtime.status` 可实时展示 Agent 当前运行阶段、工具调用状态和检索/思考过程
- AC-1.2c：飞书 Adapter 复用同一套 `runtime.output / runtime.status` 活动流，工具执行、检索、审批与最终文本不再走独立消息路径
- AC-1.3：`ConversationRouter` 正确映射 `(platform, chat_id)` 到 session
- AC-1.4：超时 session 自动 checkpoint 并创建新 session
- AC-1.5：审批卡片按钮回调正确映射为 approval decision
- AC-1.6：命令（`/new`、`/reset`）正确拦截处理
- AC-1.7：adapter、router、mapping、checkpoint、approval、proactive、Hosted Runtime 与 Web Chat/Feishu 原生活动流均有 focused 回归覆盖

**依赖**：`@neurocore/protocol`、`@neurocore/sdk-core`、`@larksuiteoapi/node-sdk`、`ws`

---

### M-PA-2: Service Connectors 基础（Web Search + Web Browser）

**交付物**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `examples/personal-assistant/src/connectors/types.ts` | `ServiceConnectorConfig` 类型 |
| 2 | `examples/personal-assistant/src/connectors/search/web-search.ts` | `web_search` Tool — Brave Search API |
| 3 | `examples/personal-assistant/src/connectors/browser/web-browser.ts` | `web_browser` Tool — URL → Markdown |
| 4 | `examples/personal-assistant/src/app/create-personal-assistant.ts` | 连接器注册与主 Agent 装配 |
| 5 | `examples/personal-assistant/package.json` | 应用依赖配置 |

**`web_search` 实现细节**：

- 输入：`{ query: string, max_results?: number }`
- 输出：`{ results: Array<{ title, url, snippet }> }`
- `sideEffectLevel: "none"` — 无副作用，无需审批
- 调用 Brave Search API（`https://api.search.brave.com/res/v1/web/search`）
- 超时 10s，无重试（搜索幂等）

**`web_browser` 实现细节**：

- 输入：`{ url: string, format?: "markdown" | "text" }`
- 输出：`{ content: string, title: string, links?: string[] }`
- `sideEffectLevel: "none"` — 只读操作
- 使用 `fetch` + 简单 HTML→Markdown 转换
- 超时 15s

**验收标准**：

- AC-2.1：`web_search` 返回结构化搜索结果
- AC-2.2：`web_browser` 返回 URL 内容的 Markdown 格式
- AC-2.3：两个 Tool 可通过 `agent.registerTool()` 注册并执行
- AC-2.4：ToolGateway 正确记录执行指标（延迟、成功/失败）

**依赖**：`@neurocore/protocol`

---

### M-PA-3: Personal Assistant Agent 组装 + E2E 测试

**交付物**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `examples/personal-assistant/src/app/create-personal-assistant.ts` | Agent 组装函数 |
| 2 | `tests/personal-assistant-e2e.test.ts` | 端到端测试 |

**组装函数**：

```typescript
export function createPersonalAssistant(config: PersonalAssistantConfig): AgentBuilder {
  const agent = defineAgent({ ... })
    .useReasoner(...)
    .withTokenBudget(...)
    .configureMemory(...)
    .configurePolicy(...);

  if (config.connectors.search) agent.registerTool(createWebSearchTool(config.connectors.search));
  if (config.connectors.browser) agent.registerTool(createWebBrowserTool());
  // Phase B 追加 email/calendar

  return agent;
}
```

**组装原则**：

- Phase A 先把主 Agent、IM Gateway 和基础 connectors 跑通。
- 不在组装函数里硬编码 `search-agent`、`writer-agent`、`formatter-agent` 这类固定 worker 流程。
- 为 Phase B 预留 `delegation` 配置和 `worker catalog` 注入口；真正的子 Agent 选择由主 Agent 在运行时完成。

**E2E 测试场景**：

| # | 场景 | 验证点 |
|---|---|---|
| E2E-1 | 用户通过飞书发消息，Agent 回复 | 消息收发、session 创建、响应文本 |
| E2E-2 | 用户通过 Web Chat 发消息，Agent 回复 | WebSocket 收发、session 创建 |
| E2E-3 | Agent 调用 web_search 回答实时问题 | Tool 调用链、结果格式化 |
| E2E-4 | 100 轮对话不丢失关键信息 | 上下文压缩生效 |
| E2E-5 | 高风险操作触发审批卡片 | PolicyProvider → ApprovalRequest → 飞书卡片 → 按钮回调 → approve |
| E2E-6 | Web Chat → 飞书跨通道继续 | episodic memory 注入、上下文衔接 |
| E2E-7 | Skill 自动提炼和复用 | ProceduralMemory → 第二次执行走 skill-first |

**验收标准**（Phase A MVP）：

- AC-3.1：用户通过飞书发送消息，Agent 在 10s 内响应
- AC-3.2：用户通过 Web Chat 发送消息，Agent 响应
- AC-3.3：Agent 可通过 web_search 回答实时问题
- AC-3.4：100 轮对话上下文压缩有效（token usage 不超预算）
- AC-3.5：审批卡片交互正确触发和恢复
- AC-3.6：所有 Agent 行为在 trace 中可追溯

---

## 3. Phase B：进阶能力

**Phase B 的多 Agent 目标**：

- 引入开放式 `worker catalog`，用 capability / domain / tool scope 描述候选子 Agent。
- 主 Agent 在复杂任务、主动任务、长时任务里按需动态编排子 Agent，而不是只支持单一固定组合。
- 支持根据任务类型编排不同 worker，例如 research / verifier / inbox / calendar / reminder / formatter / retrieval / drafter，但这些都只是候选能力，不是产品写死角色。

### M-PA-4: Proactive Engine

**交付物**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `examples/personal-assistant/src/proactive/types.ts` | 类型定义 |
| 2 | `examples/personal-assistant/src/proactive/heartbeat/heartbeat-scheduler.ts` | 心跳调度器 |
| 3 | `examples/personal-assistant/src/proactive/scheduler/cron-scheduler.ts` | Cron 定时调度 |
| 4 | `examples/personal-assistant/src/proactive/event-source/event-source.ts` | 外部事件源 SPI |
| 5 | `examples/personal-assistant/src/proactive/proactive-engine.ts` | ProactiveEngine 主类 |
| 6 | `examples/personal-assistant/src/main.ts` | 与 gateway / agent 的接线 |
| 7 | `examples/personal-assistant/package.json` | 独立示例应用配置 |

**HeartbeatScheduler 细节**：

```typescript
class HeartbeatScheduler {
  private checks: HeartbeatCheck[];
  private intervalMs: number;
  private timer?: NodeJS.Timer;

  start(): void {
    this.timer = setInterval(() => this.runChecks(), this.intervalMs);
  }

  private async runChecks(): Promise<ProactiveAction[]> {
    const results = await Promise.allSettled(
      this.checks.map(c => c.execute().catch(() => ({ triggered: false, summary: "error", priority: "silent" as const })))
    );
    return results
      .filter(r => r.status === "fulfilled" && r.value.triggered)
      .map(r => r.value)
      .map(this.toProactiveAction);
  }
}
```

**ProactiveEngine.runProactiveSession()**：

1. 收集 triggered checks / cron tasks
2. 创建 proactive session：`agent.createSession({ mode: "async", user_id: targetUser })`
3. 注入 check results 作为 context：`session_handle.runText(checkSummary)`
4. Agent 通过 CycleEngine 决策是否通知用户
5. Agent 响应通过 `IMGateway.pushNotification()` 推送到飞书

**验收标准**：

- AC-4.1：心跳每 30min 触发，执行所有注册的 checks
- AC-4.2：triggered check 生成 proactive session，Agent 自主决策
- AC-4.3：Cron 定时任务按时触发
- AC-4.4：通知通过 IM Gateway 推送到飞书
- AC-4.5：8+ 个单元测试覆盖调度、超时、通知逻辑

---

### M-PA-5: Email + Calendar Connectors

**交付物**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `examples/personal-assistant/src/connectors/email/email-read.ts` | `email_read` Tool |
| 2 | `examples/personal-assistant/src/connectors/email/email-send.ts` | `email_send` Tool |
| 3 | `examples/personal-assistant/src/connectors/calendar/calendar-read.ts` | `calendar_read` Tool |
| 4 | `examples/personal-assistant/src/connectors/calendar/calendar-write.ts` | `calendar_write` Tool |

**Email Read 细节**：

- 输入：`{ query?: string, max_results?: number, unread_only?: boolean }`
- 输出：`{ emails: Array<{ from, subject, date, body_preview, has_attachments }> }`
- `sideEffectLevel: "none"`
- Gmail：Gmail API (`gmail.users.messages.list` + `get`)
- Outlook：Microsoft Graph API (`/me/messages`)

**Email Send 细节**：

- 输入：`{ to: string[], subject: string, body: string, cc?: string[] }`
- 输出：`{ message_id: string, sent_at: string }`
- `sideEffectLevel: "high"` — 自动触发审批流 → 飞书审批卡片

**Calendar Read/Write 细节**：

- Read：`{ start_date?, end_date?, max_results? }` → events 列表
- Write：`{ title, start_time, end_time, location?, attendees? }` → event_id
- Read `sideEffectLevel: "none"`，Write `sideEffectLevel: "medium"`

**验收标准**：

- AC-5.1：`email_read` 返回收件箱邮件列表
- AC-5.2：`email_send` 触发审批流，用户在飞书卡片确认后才发送
- AC-5.3：`calendar_read` 返回指定日期范围的日程
- AC-5.4：`calendar_write` 可创建新日程

---

### M-PA-6: 跨通道会话 + 命令体系

**交付物**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `examples/personal-assistant/src/im-gateway/conversation/cross-platform-linker.ts` | 跨通道 user_id 关联 |
| 2 | `examples/personal-assistant/src/im-gateway/command/command-handler.ts` | 命令拦截与处理 |

**跨通道关联**：

- 维护 `Map<user_id, Array<{ platform, chat_id }>>` 映射
- 新 session 创建时，查找同一 user_id 的历史 session
- 提取历史 session 的 episodic memory（最近 N 条）注入新 session
- 飞书 ↔ Web Chat 上下文无缝衔接

**命令体系**：

| 命令 | 处理 |
|---|---|
| `/new` | 强制新建 session |
| `/reset` | checkpoint + 新建 session |
| `/status` | 返回 session state / goal / budget 摘要 |
| `/history` | 列出 user_id 关联的历史 session |
| `/skills` | 查询 ProceduralMemory 已学习技能 |

**验收标准**：

- AC-6.1：用户在 Web Chat 开始对话，在飞书追问，Agent 知道之前聊过什么
- AC-6.2：跨通道上下文注入不影响 token budget（有压缩机制）
- AC-6.3：所有命令正确拦截并返回结果，不传入 NeuroCore session

---

### M-PA-7: Phase B E2E 测试

**测试场景**：

| # | 场景 | 验证点 |
|---|---|---|
| E2E-8 | 心跳触发邮件检查 → 飞书主动通知 | Proactive Engine 全流程 |
| E2E-9 | 定时任务（每日 9 点摘要） | CronScheduler + 飞书通知推送 |
| E2E-10 | "发邮件给张三" → 飞书审批卡片 → 按钮确认 → 发送 | email_send + 飞书卡片交互 |
| E2E-11 | Web Chat → 飞书跨通道继续对话 | episodic memory 注入 |

---

## 4. Phase C：高级能力

### M-PA-8: 知识库

**交付物**：

- `examples/personal-assistant/src/connectors/knowledge-base/`
  - `knowledge-base-tool.ts` — `knowledge_search` Tool
  - `document-ingester.ts` — PDF/Markdown/TXT 文档摄入
  - `vector-store.ts` — 向量存储（基于 SQLite + embedding API）

**实现要点**：

- 用户通过飞书上传文件 → 分块 → embedding → 存储到向量索引
- `knowledge_search` Tool 输入 `{ query, top_k }` → 语义搜索返回相关片段
- `sideEffectLevel: "none"` — 只读

---

### M-PA-9: 技能市场

**交付物**：

- `examples/personal-assistant/src/skills/` — 预置技能包
  - `daily-briefing.ts` — 每日简报技能（新闻 + 日程 + 天气）
  - `email-digest.ts` — 邮件摘要技能
  - `meeting-notes.ts` — 会议纪要技能
  - `task-tracker.ts` — 任务跟踪技能

---

### M-PA-10: Multi-Device 集成

**交付物**：

- 利用现有 `@neurocore/device-core` 的 Sensor/Actuator SPI
- 实现 Device Connectors：
  - `clipboard-sync.ts` — 跨设备剪贴板同步（Actuator）
  - `notification-relay.ts` — 通知转发到手机（Actuator）
  - `file-watcher.ts` — 本地文件变化监听（Sensor）

---

### M-PA-11: Phase C E2E 测试

| # | 场景 | 验证点 |
|---|---|---|
| E2E-12 | 通过飞书上传 PDF → 知识库问答 | 文档摄入 + 语义搜索 |
| E2E-13 | 技能自动提炼（连续执行 3 次类似任务） | SkillPromoter + skill-first 路径 |
| E2E-14 | 飞书 + Web Chat + 多设备协同 | 全链路集成 |

---

## 5. 测试策略

| 层级 | 范围 | 运行方式 |
|---|---|---|
| 单元测试 | adapter/router/connector 独立逻辑 | `test:unit` — CI 必过 |
| 集成测试 | IM Gateway + NeuroCore Runtime 交互 | `test:integration` — mock 飞书 API |
| E2E 测试 | 完整用户场景（飞书 → Agent → Tool → 响应） | `test:e2e` — 本地运行 |
| 飞书 Live 测试 | 真实飞书 Bot 收发消息 | `test:feishu-live` — 手动触发 |

**mock 策略**：

- 飞书 SDK：mock `IMAdapter`（直接注入 `UnifiedMessage`），或 mock `@larksuiteoapi/node-sdk`
- 外部 API：mock `fetch`（拦截 HTTP 请求）
- NeuroCore Runtime：使用真实 Runtime（不 mock）

---

## 6. 依赖关系图

```
M-PA-1 (Gateway 核心 + 飞书 + Web Chat)
    │
    ├── M-PA-2 (Service Connectors) ──┐
    │                                  │
                           M-PA-3 (组装 + E2E) ← Phase A 完成
                                      │
                       ┌──────────────┤
                       │              │
                M-PA-4 (Proactive)  M-PA-5 (Email/Calendar)
                       │              │
                M-PA-6 (跨通道 + 命令) ──┤
                                      │
                           M-PA-7 (Phase B E2E) ← Phase B 完成
                                      │
                       ┌──────┬───────┼───────┐
                       │      │       │       │
                   M-PA-8  M-PA-9  M-PA-10  M-PA-11
                   (知识库) (技能) (多设备) (E2E) ← Phase C 完成
```

---

## 7. 快速启动（Phase A 第一步）

Phase A 的最小可行路径：

1. **创建 `examples/personal-assistant/`**：作为独立示例应用目录
2. **实现飞书 Adapter**：`@larksuiteoapi/node-sdk` 长连接模式
3. **实现 Web Chat Adapter**：`ws` 库，用于本地开发测试
4. **实现 `examples/personal-assistant/src/connectors/`**：先做 `web_search` Tool
5. **组装 Agent**：`defineAgent()` + `registerTool(web_search)` + `registerTool(web_browser)`
6. **跑通 E2E-1**：飞书消息 → Agent → 飞书回复

这一步完成后，就有一个可以通过飞书对话的、能搜索互联网的个人助理。
