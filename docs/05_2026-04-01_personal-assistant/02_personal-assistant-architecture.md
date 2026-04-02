# 个人助理架构设计

> 基于 NeuroCore 当前代码状态（MVP + M5.1~M9 全部交付），设计个人助理 Agent 的技术架构。
> 设计原则：**NeuroCore 是引擎，个人助理是产品** — 不修改核心包，只在其上构建。
> IM 平台：仅实现飞书 Adapter（IMAdapter SPI 保留多平台扩展能力）。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Personal Assistant Layer                     │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    IM Gateway                              │  │
│  │                飞书 │ Web Chat                             │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │ UnifiedMessage                       │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │               Conversation Router                          │  │
│  │  (platform, chat_id) → session_id 映射                     │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │               Proactive Engine                             │  │
│  │  Heartbeat │ Cron Scheduler │ Event Source │ Notifier     │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │            Service Connectors (as NeuroCore Tools)         │  │
│  │  Email │ Calendar │ Search │ Browser │ Files               │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ defineAgent() + runText()
┌───────────────────────────┴─────────────────────────────────────┐
│                    NeuroCore Runtime（不改）                      │
│  CycleEngine │ SessionManager │ ToolGateway                     │
│  MemoryProviders │ MetaController │ WorkspaceCoordinator         │
│  TaskDelegator │ AgentRegistry │ InterAgentBus                  │
│  DeviceRegistry │ WorldStateGraph │ PredictionStore             │
└─────────────────────────────────────────────────────────────────┘
```

**关键约束**：个人助理首先作为 `examples/` 下的独立应用实现，不新增 workspace package；不修改 `protocol / runtime-core / sdk-core` 等核心包。所有集成通过已有的 SPI 接口完成（`Tool`、`MemoryProvider`、`Sensor`/`Actuator`）。

---

## 2. 应用结构

```
examples/
└── personal-assistant/
    ├── README.md
    ├── package.json                 # 如需要独立依赖与启动脚本，可在 examples 层维护
    ├── src/
    │   ├── app/
    │   │   ├── create-personal-assistant.ts
    │   │   └── assistant-config.ts
    │   ├── im-gateway/
    │   │   ├── types.ts
    │   │   ├── adapter/
    │   │   │   ├── im-adapter.ts
    │   │   │   ├── feishu.ts
    │   │   │   └── web-chat.ts
    │   │   ├── conversation/
    │   │   │   ├── conversation-router.ts
    │   │   │   └── session-mapping-store.ts
    │   │   ├── notification/
    │   │   │   └── notification-dispatcher.ts
    │   │   └── gateway.ts
    │   ├── proactive/
    │   │   ├── types.ts
    │   │   ├── heartbeat/
    │   │   │   └── heartbeat-scheduler.ts
    │   │   ├── scheduler/
    │   │   │   └── cron-scheduler.ts
    │   │   ├── event-source/
    │   │   │   └── event-source.ts
    │   │   └── proactive-engine.ts
    │   ├── connectors/
    │   │   ├── types.ts
    │   │   ├── search/
    │   │   │   └── web-search.ts
    │   │   ├── browser/
    │   │   │   └── web-browser.ts
    │   │   ├── email/
    │   │   │   ├── email-read.ts
    │   │   │   └── email-send.ts
    │   │   ├── calendar/
    │   │   │   ├── calendar-read.ts
    │   │   │   └── calendar-write.ts
    │   │   └── files/
    │   │       └── local-files.ts
    │   └── main.ts
    └── scripts/
        ├── dev-web-chat.mjs
        └── dev-feishu.mjs
```

---

## 3. 核心组件设计

### 3.1 IM Gateway

#### 3.1.1 类型定义

```typescript
type IMPlatform = "feishu" | "web";

type MessageContent =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
  | { type: "image"; url: string; caption?: string }
  | { type: "file"; url: string; filename: string };

interface UnifiedMessage {
  message_id: string;
  platform: IMPlatform;
  chat_id: string;
  sender_id: string;
  timestamp: string;
  content: MessageContent;
  reply_to?: string;
  metadata: Record<string, unknown>;
}

interface IMAdapterConfig {
  auth: Record<string, string>;
  webhook_url?: string;
  allowed_senders?: string[];
  rate_limit?: { messages_per_minute: number };
}
```

#### 3.1.2 IMAdapter SPI

```typescript
interface IMAdapter {
  readonly platform: IMPlatform;
  start(config: IMAdapterConfig): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }>;
  editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void>;
  onMessage(handler: (msg: UnifiedMessage) => void): void;
  typingIndicator(chatId: string): Promise<void>;
}
```

每个 IM 平台实现此接口，负责协议适配和消息归一化。当前仅实现飞书和 Web Chat，但 SPI 保持可扩展。

#### 3.1.3 飞书 Adapter

**技术要点**：

| 维度 | 方案 |
|---|---|
| 接收方式 | 长连接 WebSocket（推荐）或 Webhook 回调 |
| 发送方式 | 飞书 IM API（`POST /im/v1/messages`） |
| SDK | `@larksuiteoapi/node-sdk` 官方 SDK |
| 消息格式 | text / post（富文本）/ interactive（卡片）|
| 长任务处理 | 卡片更新模式（先发送"思考中..."卡片，完成后更新内容）|
| 文件限制 | 30MB |
| 确认超时 | 无硬性限制 |

**飞书特有能力**：

- **消息卡片（Interactive Card）**：审批请求可用卡片按钮（"批准" / "拒绝"），比纯文本交互更自然
- **群聊 @mention**：通过 `mentions` 字段识别 @机器人 消息
- **事件订阅**：通过长连接接收 `im.message.receive_v1` 事件

**飞书 Adapter 实现**：

```typescript
import * as lark from "@larksuiteoapi/node-sdk";

class FeishuAdapter implements IMAdapter {
  readonly platform: IMPlatform = "feishu";
  private client: lark.Client;
  private wsClient?: lark.WSClient;

  async start(config: IMAdapterConfig): Promise<void> {
    this.client = new lark.Client({
      appId: config.auth.app_id,
      appSecret: config.auth.app_secret,
    });

    // 长连接模式（无需公网 endpoint）
    this.wsClient = new lark.WSClient({
      appId: config.auth.app_id,
      appSecret: config.auth.app_secret,
      eventDispatcher: new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          const msg = this.normalizeMessage(data);
          this.messageHandler?.(msg);
        },
      }),
    });
    await this.wsClient.start();
  }

  async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: this.toFeishuMsgType(content),
        content: JSON.stringify(this.toFeishuContent(content)),
      },
    });
    return { message_id: resp.data?.message_id ?? "" };
  }

  async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(this.toFeishuContent(content)),
      },
    });
  }
}
```

#### 3.1.4 ConversationRouter

核心职责：将 `(platform, chat_id)` 映射到 NeuroCore `session_id`。

```typescript
interface ConversationRouter {
  resolveOrCreate(msg: UnifiedMessage, agent: AgentBuilder): Promise<{
    session_id: string;
    session_handle: AgentSessionHandle;
    is_new: boolean;
  }>;
  getSessionForUser(userId: string, platform: IMPlatform): string | undefined;
}
```

**映射策略**：

| 场景 | 行为 |
|---|---|
| 新 `chat_id` 首次发消息 | `agent.createSession()`，记录映射 |
| 活跃 session（30min 内有活动） | `session_handle.runText(msg)` |
| 不活跃 session（>30min） | `agent.createSession()`，新 session；旧 session 做 checkpoint |
| 跨通道（同一 `user_id`，飞书 ↔ Web Chat） | 新 session 注入旧 session 的 episodic memory 摘要 |

#### 3.1.5 IMGateway 主类

```typescript
class IMGateway {
  registerAdapter(adapter: IMAdapter, config: IMAdapterConfig): void;
  setAgent(agent: AgentBuilder): void;
  start(): Promise<void>;
  stop(): Promise<void>;

  pushNotification(userId: string, content: MessageContent, options?: {
    priority?: "silent" | "normal" | "urgent";
    platform?: IMPlatform;
  }): Promise<void>;
}
```

**内部流程**：

```
IMAdapter.onMessage(msg)
    → IMGateway.handleMessage(msg)
        → ConversationRouter.resolveOrCreate(msg, agent)
            → session_handle.runText(msg.content)
                → NeuroCore CycleEngine 运行
            → 响应文本
        → adapter.sendMessage(chatId, response)
```

#### 3.1.6 主 Agent 自主编排的子 Agent 模型

个人助理不应被设计成固定的 `search-agent -> writer-agent -> formatter-agent` 三段流水线。那种组合最多只能算某一次任务里的临时角色排列，而不是产品架构本身。

更准确的模型是：

| 概念 | 定义 |
|---|---|
| 主 Agent | 面向用户的统一入口，持有根 Goal、用户偏好、预算、审批责任和最终输出责任 |
| 子 Agent | 围绕当前子 Goal 临时获得上下文和权限的工作角色 |
| Agent Catalog | 一组按 capability / domain / tool scope 描述的可选 worker 模板或长期注册实例 |
| Delegation Envelope | 主 Agent 下发给子 Agent 的 `goal + context slice + constraints + timeout + permission scope` |

**编排原则**：

- 主 Agent 自主决定是否需要委派，而不是由产品代码预设固定子 Agent 数量。
- 子 Agent 的选择依据是能力匹配、工具域、预算、延迟、风险和当前负载，而不是角色名字本身。
- 同一个用户请求，在不同上下文下可产生不同子 Agent 组合。
- 主 Agent 可以先委派一个 worker，再根据返回结果继续二次分解或改派其他 worker。
- 对子 Agent 暴露的是裁剪后的局部上下文，而不是主会话的全部记忆和全部工具权限。

**运行时决策输入**：

- Goal 是否可分解，以及是否存在明显独立子任务
- 每个子任务需要的 capability / domain / tool scope
- 任务风险级别，是否需要 verifier 或审批
- 当前预算、延迟目标和 worker 负载
- 结果是否需要多路交叉验证

**子 Agent 生命周期（个人助理视角）**：

| 阶段 | 含义 |
|---|---|
| available | worker 模板或注册实例可被选择 |
| selected | 主 Agent 在当前 cycle 里选中其承担某个子 Goal |
| delegated-session-created | 为本次子任务创建 delegated session |
| running | 子 Agent 在自己的 session 中执行 |
| completed / failed / timeout / rejected | 返回执行结果、错误或超时 |
| aggregated | 主 Agent 汇总、审阅并决定是否继续委派 |
| recycled | 本次子任务结束；长期 worker 回到 idle，临时角色退出 |

**当前代码落点**：

- 当前 M9 已支持主 Agent 发出 `delegate` 动作，并将子 Agent 结果作为 observation 回流到下一轮推理。
- 当前实现最贴近“长期注册 worker + delegated session”的模型；未来个人助理层可以在此之上增加“临时角色模板”和更细的权限注入，而不改变主 Agent 的编排契约。

#### 3.1.7 Web Chat Adapter

内置 WebSocket 聊天，无需第三方 IM 即可使用：

```
ws://localhost:3001/chat
    │
    ├── 客户端连接 → 分配 chat_id → 映射到 session
    ├── 收到文本 → UnifiedMessage → IMGateway 处理
    └── 推送响应 → WebSocket send
```

### 3.2 Proactive Engine

#### 3.2.1 类型定义

```typescript
type NotificationPriority = "silent" | "normal" | "urgent";

interface HeartbeatCheck {
  name: string;
  description: string;
  execute(): Promise<CheckResult>;
}

interface CheckResult {
  triggered: boolean;
  summary: string;
  priority: NotificationPriority;
  payload?: Record<string, unknown>;
}

interface ScheduleEntry {
  id: string;
  cron: string;
  task_description: string;
  notification_platform?: IMPlatform;
  enabled: boolean;
}

interface ProactiveAction {
  type: "notify" | "run_task";
  content: string;
  priority: NotificationPriority;
  target_user: string;
  target_platform?: IMPlatform;
  source: "heartbeat" | "schedule" | "event";
}
```

#### 3.2.2 ProactiveEngine 主类

```typescript
class ProactiveEngine {
  setAgent(agent: AgentBuilder): void;
  setGateway(gateway: IMGateway): void;

  registerHeartbeat(checks: HeartbeatCheck[], interval_ms?: number): void;
  registerSchedule(entry: ScheduleEntry): void;
  registerEventSource(name: string, subscribe: (handler: (event: ExternalEvent) => void) => () => void): void;

  start(): Promise<void>;
  stop(): Promise<void>;
}
```

#### 3.2.3 运行机制

关键设计：Proactive Engine **不直接执行业务逻辑**，而是创建一个无用户输入的 NeuroCore session，让 Agent 通过 CycleEngine 自主决策。

**心跳流**：

```
HeartbeatScheduler (每 30min)
    │
    ▼
执行所有 HeartbeatCheck
    ├── 检查邮件 (email_read Tool)
    ├── 检查日历 (calendar_read Tool)
    └── 检查跟进任务 (episodic memory recall)
    │
    ▼
CheckResult.triggered === true?
    │ 是
    ▼
创建 proactive session（无用户输入）
    → agent.createSession({ mode: "async" })
    → session_handle.runText("你刚才检查了以下事项：[checkResults]，判断是否需要通知用户")
        │
        ▼ Agent 通过 CycleEngine 运行
        ├── 调用 Tool 获取详情
        ├── 决策是否通知、通知内容、优先级
        └── respond → "明天 14:00 会议改为 15:00"
    │
    ▼
IMGateway.pushNotification(userId, agentResponse, priority)
```

**定时任务流**：

```
CronScheduler ("0 9 * * *" — 每天早上 9 点)
    │
    ▼
创建 proactive session
    → session_handle.runText("执行定时任务：[task_description]")
        │
        ▼ Agent 通过 CycleEngine 运行
        ├── 搜索今日新闻 → 汇总
        ├── 检查今日日程 → 列出
        └── respond → "今日摘要：..."
    │
    ▼
IMGateway.pushNotification(userId, summary)
```

### 3.3 Service Connectors

所有外部服务连接器实现为 `Tool`（`@neurocore/protocol` 定义的 `Tool` 接口），通过 `agent.registerTool()` 注册。**复用 ToolGateway 的 schema 校验、超时重试、执行指标、观测记录。**

#### 3.3.1 连接器清单

| 连接器 | Tool name | sideEffectLevel | 说明 | Phase |
|---|---|---|---|---|
| Web Search | `web_search` | none | Brave Search / SerpAPI | A |
| Web Browser | `web_browser` | none | URL → Markdown 转换 | A |
| Email Read | `email_read` | none | Gmail/Outlook 收件箱 | B |
| Email Send | `email_send` | high | 发送邮件（自动触发审批） | B |
| Calendar Read | `calendar_read` | none | Google/Apple Calendar 查询 | B |
| Calendar Write | `calendar_write` | medium | 创建/修改日程 | B |
| File Read | `file_read` | none | 读取本地/云端文件 | B |
| File Write | `file_write` | high | 写入文件（自动触发审批） | B |

#### 3.3.2 通用模式

每个连接器遵循同一模式：

```typescript
import type { Tool, ToolResult, ToolContext } from "@neurocore/protocol";

function createWebSearchTool(config: { api_key: string; provider: string }): Tool {
  return {
    name: "web_search",
    description: "搜索互联网获取信息",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        max_results: { type: "number", description: "最大结果数", default: 5 },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" },
            },
          },
        },
      },
    },
    async invoke(input: { query: string; max_results?: number }, ctx: ToolContext): Promise<ToolResult> {
      const results = await searchApi(input.query, input.max_results ?? 5, config);
      return {
        summary: `找到 ${results.length} 条搜索结果`,
        payload: { results },
      };
    },
  };
}
```

**关键收益**：
- `sideEffectLevel: "high"` 的工具（email_send、file_write）自动进入 Amygdala 审批流
- ToolGateway 的超时重试、执行指标、观测记录全部自动生效
- Agent trace 中可追溯每次外部调用

#### 3.3.3 认证模型

```typescript
interface ConnectorCredentials {
  search?: { provider: "brave" | "serpapi"; api_key: string };
  email?: { provider: "gmail" | "outlook"; credentials: Record<string, string> };
  calendar?: { provider: "google" | "apple"; credentials: Record<string, string> };
  files?: { base_path: string };
}
```

认证信息从环境变量或配置文件读取，不硬编码。OAuth 类凭证由用户在首次使用时完成授权流程。

---

## 4. Agent 组装

个人助理 Agent 的组装代码：

```typescript
import { defineAgent } from "@neurocore/sdk-core";
import { OpenAIReasoner } from "@neurocore/sdk-node";
import { createWebSearchTool, createWebBrowserTool } from "@neurocore/service-connectors";
import { createEmailReadTool, createEmailSendTool } from "@neurocore/service-connectors";
import { createCalendarReadTool, createCalendarWriteTool } from "@neurocore/service-connectors";
import { IMGateway } from "@neurocore/im-gateway";
import { FeishuAdapter } from "@neurocore/im-gateway/feishu";
import { WebChatAdapter } from "@neurocore/im-gateway/web-chat";
import { ProactiveEngine } from "@neurocore/proactive-engine";

const assistant = defineAgent({
  id: "personal-assistant",
  name: "NeuroCore Assistant",
  role: "个人助理：管理日程、信息检索、邮件处理、任务追踪",
  version: "0.1.0",
})
  .useReasoner(new OpenAIReasoner({ model: "gpt-4o" }))
  .withTokenBudget(128_000)
  .configureMemory({
    working_memory_enabled: true,
    episodic_memory_enabled: true,
    semantic_memory_enabled: true,
    procedural_memory_enabled: true,
    retrieval_top_k: 10,
  })
  .configurePolicy({
    default_policy: "warn",
    approval_policy: { allowed_approvers: [process.env.USER_ID!] },
  })
  .registerTool(createWebSearchTool({ api_key: process.env.SEARCH_API_KEY! }))
  .registerTool(createWebBrowserTool())
  .registerTool(createEmailReadTool(emailConfig))
  .registerTool(createEmailSendTool(emailConfig))
  .registerTool(createCalendarReadTool(calendarConfig))
  .registerTool(createCalendarWriteTool(calendarConfig));

const gateway = new IMGateway();
gateway.setAgent(assistant);
gateway.registerAdapter(new FeishuAdapter(), {
  auth: {
    app_id: process.env.FEISHU_APP_ID!,
    app_secret: process.env.FEISHU_APP_SECRET!,
  },
});
gateway.registerAdapter(new WebChatAdapter(), { auth: {}, webhook_url: `ws://localhost:3001/chat` });

const engine = new ProactiveEngine();
engine.setAgent(assistant);
engine.setGateway(gateway);
engine.registerHeartbeat([
  { name: "email_check", description: "检查新邮件", execute: checkNewEmails },
  { name: "calendar_check", description: "检查日程变更", execute: checkCalendarChanges },
], 30 * 60 * 1000);
engine.registerSchedule({ id: "morning_digest", cron: "0 9 * * *", task_description: "推送今日新闻摘要和日程", enabled: true });

await gateway.start();
await engine.start();
```

---

## 5. 数据流

### 5.1 用户消息处理

```
飞书: "今天有什么会议？"
    │
    ▼ FeishuAdapter
    │ 接收 im.message.receive_v1 事件 → UnifiedMessage{ platform: "feishu", content: { type: "text", text: "今天有什么会议？" } }
    │
    ▼ IMGateway.handleMessage()
    │
    ├─→ ConversationRouter.resolveOrCreate()
    │       → 查找 (feishu, chat_id) 映射
    │       → 找到活跃 session 或创建新 session
    │       → 返回 session_handle
    │
    ├─→ session_handle.runText("今天有什么会议？")
    │       │
    │       ▼ NeuroCore CycleEngine
    │       ├── Perceive: 解析意图 "查询今日日程"
    │       ├── Retrieve: episodic memory → 用户偏好 24h 制
    │       ├── Deliberate: 选中 calendar_read
    │       ├── Gate: sideEffect=none → 放行
    │       ├── Act: ToolGateway.execute(calendar_read, { date: "today" })
    │       ├── Observe: [{ time: "14:00", title: "项目评审" }]
    │       └── Respond: "今天有一个会议：14:00 项目评审"
    │
    └─→ FeishuAdapter.sendMessage(chatId, "今天有一个会议：14:00 项目评审")
```

### 5.2 主动通知

```
ProactiveEngine heartbeat (30min)
    │
    ├─→ HeartbeatCheck: email_check → CheckResult{ triggered: true, summary: "1 封重要邮件：会议时间变更" }
    │
    ▼ 创建 proactive session
    │
    ├─→ session_handle.runText("检查结果：1 封重要邮件关于会议时间变更。判断是否需要通知用户。")
    │       │
    │       ▼ Agent 通过 CycleEngine 运行
    │       ├── 调用 email_read 获取邮件详情
    │       ├── 调用 calendar_read 确认原日程
    │       └── Respond: "明天 14:00 的项目评审改为 15:00（张三通知）"
    │
    └─→ IMGateway.pushNotification(userId, response, "normal")
            → FeishuAdapter.sendMessage(...)
```

### 5.3 审批流（飞书卡片）

```
用户: "给张三发邮件确认会议时间"
    │
    ▼ Agent 决策: call_tool email_send
    │
    ▼ Amygdala: sideEffectLevel=high → PolicyProvider 返回 "block"
    │
    ▼ MetaController: 转为 ApprovalRequest
    │
    ▼ IMGateway → FeishuAdapter.sendMessage(chatId,
    │   消息卡片: "需要确认：发送邮件给张三，主题：确认会议时间"
    │   卡片按钮: [✓ 批准] [✗ 拒绝]
    │
    ▼ 用户点击 "批准"
    │
    ▼ session_handle.approve({ approval_id, decision: "approve" })
    │
    ▼ ToolGateway.execute(email_send, ...)
    │
    ▼ FeishuAdapter.editMessage(messageId, "邮件已发送 ✓")
```

### 5.4 跨通道会话（飞书 ↔ Web Chat）

```
Web Chat: "帮我调研 XX 技术"
    → Session A 创建
    → Agent 执行调研，返回结果
    → Session A 做 checkpoint

飞书 (同一 user_id): "继续刚才的调研"
    → ConversationRouter: 找到 user_id 关联的 Session A
    → Session A 已超时 → 创建 Session B
    → Session B 注入 Session A 的 episodic memory 摘要
    → Agent 从上下文继续
```

---

## 6. 与 NeuroCore 的集成点

| 个人助理组件 | NeuroCore 集成方式 | 复用的 SPI |
|---|---|---|
| IM Gateway | `AgentSessionHandle.runText()` / `runInput()` | SessionManager |
| ConversationRouter | `agent.createSession()` / `agent.connectSession()` | Session lifecycle |
| Proactive Engine | `AgentSessionHandle.runText()` (无用户输入) | CycleEngine |
| Service Connectors | `agent.registerTool()` | `Tool` SPI, ToolGateway |
| 安全门控 | 高 sideEffect → 自动进入审批流 | `PolicyProvider`, `ApprovalRequest` |
| 记忆积累 | 四层记忆自动运行 | `MemoryProvider` SPI |
| 技能复用 | episode → skill 自动提炼 | `SkillProvider`, `ProceduralMemory` |
| 多 Agent 委派 | Phase B 启用 | `TaskDelegator`, `InterAgentBus` |

**零修改**：个人助理不修改任何现有 NeuroCore 包。

---

## 7. 事件类型扩展

个人助理层新增事件类型，注册到 `@neurocore/protocol` 的 `NeuroCoreEventType`：

| 事件 | 说明 | Phase |
|---|---|---|
| `im.message_received` | IM 消息到达 | A |
| `im.message_sent` | IM 消息发出 | A |
| `proactive.heartbeat_fired` | 心跳触发 | B |
| `proactive.action_triggered` | 主动行为触发 | B |
| `proactive.notification_sent` | 主动通知发送 | B |
| `connector.invoked` | 外部服务调用 | A |

这些事件通过 `session_handle.subscribeToEvents()` 消费，可接入 trace 系统。

---

## 8. 部署模式

### 8.1 本地模式（推荐起步）

```
User Machine (macOS / Linux)
├── Node.js 进程
│   ├── NeuroCore Runtime (AgentRuntime)
│   ├── IM Gateway (同进程)
│   ├── Proactive Engine (同进程)
│   └── Service Connectors (API 调用)
├── SQLite 持久化 (session / memory / eval)
└── 配置文件 assistant.config.yaml
```

启动命令：`npx neurocore-assistant start --config ./assistant.config.yaml`

### 8.2 托管模式

```
Cloud Server
├── NeuroCore Runtime Server (runtime-server HTTP API)
├── IM Gateway 进程 (连接 runtime-server API)
├── Proactive Engine 进程 (连接 runtime-server API)
├── PostgreSQL + Redis 持久化
└── Nginx 反向代理 + TLS
```

IM Gateway 和 Proactive Engine 通过 `runtime-server` 的 HTTP API 与 NeuroCore 交互（`POST /v1/agents/{id}/sessions`、`POST /v1/sessions/{id}/inputs` 等）。

---

## 9. 配置模型

```yaml
# assistant.config.yaml
agent:
  id: personal-assistant
  model: gpt-4o
  token_budget: 128000
  system_prompt: |
    你是 NeuroCore 个人助理。帮助用户管理日程、检索信息、处理邮件。
    遵循用户偏好，主动但不打扰。

im:
  session_timeout_ms: 1800000  # 30min
  adapters:
    - platform: feishu
      enabled: true
      auth:
        app_id: ${FEISHU_APP_ID}
        app_secret: ${FEISHU_APP_SECRET}
    - platform: web
      enabled: true
      port: 3001

proactive:
  enabled: false  # Phase B 启用
  heartbeat_interval_ms: 1800000  # 30min
  checks:
    - email_check
    - calendar_check
  schedules:
    - cron: "0 9 * * *"
      task: "推送今日新闻摘要和日程"
      platform: feishu

connectors:
  search:
    provider: brave
    api_key: ${BRAVE_API_KEY}
  email:
    provider: gmail
    credentials:
      client_id: ${GMAIL_CLIENT_ID}
      client_secret: ${GMAIL_CLIENT_SECRET}
      refresh_token: ${GMAIL_REFRESH_TOKEN}
  calendar:
    provider: google
    credentials:
      client_id: ${GOOGLE_CAL_CLIENT_ID}
      client_secret: ${GOOGLE_CAL_CLIENT_SECRET}
      refresh_token: ${GOOGLE_CAL_REFRESH_TOKEN}

memory:
  retrieval_top_k: 10

policy:
  default: warn
  auto_approve: []
```

---

## 10. 依赖关系

```
                    protocol
                   ↗        ↖
          im-gateway    service-connectors    proactive-engine
                ↘            ↓                ↙
                   sdk-core / sdk-node
                        ↓
                   runtime-core
```

| 新包 | 依赖 |
|---|---|
| `im-gateway` | `@neurocore/protocol`, `@neurocore/sdk-core`, `@larksuiteoapi/node-sdk` |
| `service-connectors` | `@neurocore/protocol` |
| `proactive-engine` | `@neurocore/protocol`, `@neurocore/sdk-core`, `@neurocore/im-gateway` |

飞书 SDK（`@larksuiteoapi/node-sdk`）仅在 `feishu.ts` adapter 文件中引入，不污染主入口。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 飞书 API 变更或限流 | 消息收发中断 | Adapter SPI 解耦；长连接断线自动重连；指数退避重试 |
| 飞书应用审核/权限 | 功能受限 | 提前申请所需权限（im:message、im:chat 等）；最小权限原则 |
| LLM 调用成本失控 | 经济不可持续 | Amygdala cost_budget 门控 + 简单任务路由到小模型 |
| Proactive Engine 心跳累积延迟 | 通知不及时 | 检查超时硬截断（5s/check）；并行执行 checks |
| OAuth token 过期 | 连接器不可用 | 自动 refresh；失败时通过飞书通知用户重新授权 |
| 跨通道会话上下文丢失 | 体验断裂 | Session checkpoint + episodic memory 注入新 session |
