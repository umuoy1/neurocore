# 个人助理代码落地细化（Code-First）

> 本文档是 `04_1_independent-milestones.md` 的实现层补充，目标不是再次描述产品愿景，而是把当前最短路径压到**可直接开工写代码**的粒度。
>
> 适用范围：
> - 当前优先级：`PA-M1`、`PA-M2`、`PA-M3`
> - 约束来源：**以当前仓库真实代码接口为准**
> - 使用方式：作为包脚手架、文件拆分、PR 切分和测试编排的直接输入
>
> 本文档优先级高于 `02_personal-assistant-architecture.md` 和 `03_implementation-plan.md` 中的示意性代码片段；如果示意片段与当前 SDK 接口冲突，以本文为准。

---

## 1. 当前实现目标

当前不追求一次性把整个 personal assistant 产品线全部做完，而是先落一个**可持续迭代的最短代码闭环**：

```text
PA-M1 对话入口 MVP
  + PA-M2 事务执行最小闭环
  + PA-M3 主动提醒最小闭环
```

这条路径的代码目标是：

- 用户可通过 `Web Chat` 和 `飞书` 两个入口与 assistant 对话
- assistant 可调用 `web_search / web_browser / email_read / calendar_read`
- 高副作用操作可走审批闭环
- session 可跨消息、跨 runtime 重连
- 主动任务可通过 heartbeat / cron 触发
- 以上路径都有顶层测试和 demo 启动脚本

---

## 2. 以当前代码为准的实现事实

下面这些点会直接影响怎么写代码，不能再按旧文档的理想接口理解。

| 主题 | 当前真实情况 | 直接实现结论 |
|---|---|---|
| `AgentBuilder.createSession()` | 每次都会新建一个 `AgentRuntime` 实例 | 若要跨消息重连 session，**必须配置共享 `RuntimeStateStore`** |
| `AgentBuilder.connectSession()` | 会通过 `runtime.getSession(sessionId)` 尝试重连 | 只有在共享 `RuntimeStateStore` 存在时，这个重连才可靠 |
| `CreateSessionCommand.overrides` | 类型里有，但当前 runtime 未消费 | **不能依赖 per-session profile override** |
| `configurePolicy()` | 当前只支持 `blockedTools` / `requiredApprovalTools` | 不能把它当成通用 policy/approval 配置入口 |
| `approval_policy.allowed_approvers` | runtime 支持读取，`AgentBuilder` 已提供 `configureApprovalPolicy()` | 如需要限制 approver，直接走 builder 正式配置入口 |
| 高副作用审批 | `CycleEngine` 默认会注入 `DefaultPolicyProvider`，高副作用动作会触发 `warn` | `sideEffectLevel: "high"` 的工具天然可进审批链 |
| 输入归一化 | `runtime-server` 会自动补 `input_id / created_at`；embedded 模式不会 | IM Gateway 走 embedded 路径时必须自带 `UserInput` 工厂 |
| 持久化恢复 | SQL-first 路径下，runtime snapshot 只持久化 goals / trace / approvals；memory 与 checkpoints 走独立 SQLite stores | 若要跨 runtime 保留记忆与 checkpoint，必须使用默认 SQL-first 路径或显式配置 SQLite memory/checkpoint persistence |
| 事件恢复 | hydrated session 会清空历史 `eventBus` | **不能把 event history 当持久化来源**，重启后要基于 snapshot / trace / session state 恢复 |
| 多 Agent | 当前可用路径是 `configureMultiAgent()` + `InProcessAgentMesh` | `PA-M5` 前不必自己重做 delegation 基建 |

---

## 3. 直接实现时的架构取舍

### 3.1 当前阶段采用 `embedded + persistent state store`

当前最直接可实施的路线不是先把 personal assistant 架在 `runtime-server` 之上，而是：

- `IM Gateway` 直接持有 `AgentBuilder`
- 通过 `useRuntimeStateStore(() => new SqliteRuntimeStateStore(...))` 获得持久化 session
- 每条消息到来时：
  - 新对话：`createSession(...)`
  - 老对话：`connectSession(sessionId).runText(...)` 或 `resume(...)`

这样做的原因：

1. 少一层 HTTP/REST 序列化和 server 生命周期管理
2. 直接复用 `AgentSessionHandle` 的 `runText / resume / approve / reject / checkpoint`
3. 当前 repo 已有 `SqliteRuntimeStateStore` / `FileRuntimeStateStore`，不需要新发明 runtime persistence

### 3.2 持久化统一用 SQLite，先不要做分布式

建议当前阶段统一采用一个本地 SQLite 文件，例如：

```text
.neurocore/personal-assistant.db
```

使用方式：

- `runtime-core` 通过 `SqliteRuntimeStateStore` 持久化 `runtime_sessions`
- `im-gateway` 自己维护：
  - `conversation_routes`
  - `approval_bindings`
  - `platform_user_links`
  - `notification_outbox`
- `proactive-engine` 自己维护：
  - `schedules`
  - `heartbeat_runs`

原因：

- 现成
- 单机 local-first
- 足够支撑当前产品线
- 后续要迁移到 hosted runtime 时再抽象 store SPI

### 3.3 当前阶段直接实现为 `examples/personal-assistant/` 独立应用

建议做法：

- 所有个人助理代码都放在 `examples/personal-assistant/`
- 在应用内部按 `im-gateway / connectors / proactive / app` 分目录
- 只复用 `@neurocore/*` 核心包，不新增 personal assistant 专用 workspace package

建议新增：

- `examples/personal-assistant/README.md`
- `examples/personal-assistant/src/main.ts`
- `examples/personal-assistant/scripts/dev-web-chat.mjs`
- `examples/personal-assistant/scripts/dev-feishu.mjs`

后续只有在这些模块被证明值得跨项目复用时，才考虑把其中一部分下沉为 package。

---

## 4. 代码目录与文件拆解

### 4.1 仓库级改动

第一批必改文件：

- `examples/personal-assistant/README.md`
- `examples/personal-assistant/package.json` 或独立脚本说明
- 如采用本地 tsconfig：`examples/personal-assistant/tsconfig.json`

当前方案**不要求**新增 workspace package、`tsconfig` reference 或 `paths` 映射。

### 4.2 `examples/personal-assistant/src/im-gateway`

建议文件树：

```text
examples/personal-assistant/
└── src/
    ├── im-gateway/
    │   ├── types.ts
    │   ├── input/
    │   │   └── input-factory.ts
    │   ├── adapter/
    │   │   ├── im-adapter.ts
    │   │   ├── web-chat.ts
    │   │   └── feishu.ts
    │   ├── conversation/
    │   │   ├── session-mapping-store.ts
    │   │   ├── sqlite-session-mapping-store.ts
    │   │   ├── platform-user-link-store.ts
    │   │   ├── sqlite-platform-user-link-store.ts
    │   │   └── conversation-router.ts
    │   ├── approval/
    │   │   ├── approval-binding-store.ts
    │   │   └── sqlite-approval-binding-store.ts
    │   ├── command/
    │   │   └── command-handler.ts
    │   ├── notification/
    │   │   └── notification-dispatcher.ts
    │   ├── runtime/
    │   │   └── assistant-runtime-factory.ts
    │   └── gateway.ts
```

职责边界：

- `input-factory.ts`
  - 统一生成 embedded runtime 所需的 `UserInput`
- `session-mapping-store.ts`
  - `(platform, chat_id) -> session_id`
- `platform-user-link-store.ts`
  - `(platform, sender_id) <-> canonical_user_id`
- `approval-binding-store.ts`
  - `platform_message_id -> { session_id, approval_id }`
- `command-handler.ts`
  - `/new`, `/reset`, `/status`, `/history`
- `assistant-runtime-factory.ts`
  - 创建带共享 `SqliteRuntimeStateStore` 的 `AgentBuilder`

### 4.3 `examples/personal-assistant/src/connectors`

建议文件树：

```text
examples/personal-assistant/
└── src/
    ├── connectors/
    │   ├── types.ts
    │   ├── shared/
    │   │   ├── fetch-json.ts
    │   │   ├── timeout.ts
    │   │   └── html-to-text.ts
    │   ├── search/
    │   │   └── web-search.ts
    │   ├── browser/
    │   │   └── web-browser.ts
    │   ├── email/
    │   │   ├── email-read.ts
    │   │   └── email-send.ts
    │   ├── calendar/
    │   │   ├── calendar-read.ts
    │   │   └── calendar-write.ts
    │   └── knowledge-base/
    │       └── placeholder.ts
```

当前阶段只必须实现：

- `web-search.ts`
- `web-browser.ts`
- `email-read.ts`
- `calendar-read.ts`

可以先留空或 stub：

- `email-send.ts`
- `calendar-write.ts`

### 4.4 `examples/personal-assistant/src/proactive`

建议文件树：

```text
examples/personal-assistant/
└── src/
    ├── proactive/
    │   ├── types.ts
    │   ├── heartbeat/
    │   │   └── heartbeat-scheduler.ts
    │   ├── scheduler/
    │   │   └── cron-scheduler.ts
    │   ├── event-source/
    │   │   └── event-source.ts
    │   ├── store/
    │   │   └── sqlite-schedule-store.ts
    │   └── proactive-engine.ts
```

当前阶段不需要做复杂 event bus，只要：

- `setInterval` 心跳
- cron 表达式调度
- 从注册的 checks 生成主动 session

### 4.5 `examples/`

建议新增：

```text
examples/
└── personal-assistant/
    ├── README.md
    ├── src/
    │   ├── app/
    │   │   ├── create-personal-assistant.ts
    │   │   └── assistant-config.ts
    │   └── main.ts
    └── scripts/
        ├── dev-web-chat.mjs
        └── dev-feishu.mjs
```

用途：

- `scripts/dev-web-chat.mjs`
  - Web Chat + search/browser + embedded runtime
- `scripts/dev-feishu.mjs`
  - 飞书 + Web Chat + approval callback + read-only proactive checks

---

## 5. 需要先写的薄封装

这些不是“大功能”，但如果不先补，后面每个包都会重复造轮子。

### 5.1 `createUserInput()`

```ts
import type { UserInput } from "@neurocore/protocol";

export function createUserInput(
  content: string,
  metadata?: Record<string, unknown>
): UserInput {
  return {
    input_id: `inp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    created_at: new Date().toISOString(),
    metadata
  };
}
```

原因：

- embedded 模式不会像 `runtime-server` 那样自动补齐 `input_id / created_at`
- IM adapter、proactive session、approval resume 都会用到它

### 5.2 `AssistantRuntimeFactory`

```ts
export interface AssistantRuntimeFactoryOptions {
  dbPath: string;
  buildAgent: () => AgentBuilder;
}

export class AssistantRuntimeFactory {
  private readonly builder: AgentBuilder;

  public constructor(options: AssistantRuntimeFactoryOptions) {
    this.builder = options.buildAgent();
    this.builder.useRuntimeStateStore(
      () => new SqliteRuntimeStateStore({ filename: options.dbPath })
    );
  }

  public getBuilder(): AgentBuilder {
    return this.builder;
  }
}
```

关键点：

- `AgentBuilder` 可以复用
- `RuntimeStateStore` 必须是**共享持久化存储**
- 不要每次消息来都 new 一个不同配置的 builder

### 5.3 `configureApprovalPolicy()`

当前 SDK 已有正式 builder 配置入口：

```ts
builder.configureApprovalPolicy({
  allowed_approvers: approverIds
});
```

更细粒度的 tenant/risk allow-list 也直接在这里配置，不再直改 `profile`。

---

## 6. 关键运行流按代码拆解

### 6.1 消息进入主链路

```text
IMAdapter.onMessage(msg)
  -> CommandHandler.tryHandle(msg)
     -> 若命中命令，直接返回
  -> ConversationRouter.resolve(msg)
     -> create session 或 connect session
  -> handle.runText(msg.content.text, metadata)
  -> 若结果有 pending approval，写 ApprovalBindingStore
  -> NotificationDispatcher.sendResponse(...)
```

`ConversationRouter.resolve()` 建议返回：

```ts
interface ResolvedConversation {
  session_id: string;
  handle: AgentSessionHandle;
  created: boolean;
  resumed_from_checkpoint: boolean;
}
```

### 6.2 session 路由规则

建议第一版明确而简单：

1. 先按 `(platform, chat_id)` 查 `conversation_routes`
2. 若未命中，创建 session
3. 若命中但 session 已终态：
   - 新建 session
   - 更新映射
4. 若命中且 session `waiting / escalated / hydrated / suspended`：
   - 优先 `connectSession(sessionId)`
5. 若命中但长时间无活动：
   - 先 `checkpoint()`
   - 再新建 session

第一版不做太复杂的 session merge。

### 6.3 审批卡片回调

审批不是只靠 IM 回调文本猜测，而要有显式 binding：

```text
ApprovalBindingStore
  platform_message_id
  -> session_id
  -> approval_id
  -> platform
  -> chat_id
```

飞书卡片按钮回调到来时：

1. 用 `platform_message_id` 查 binding
2. `builder.connectSession(session_id)`
3. `handle.approve({ approval_id, approver_id })` 或 `handle.reject(...)`
4. 更新原消息或发送 follow-up 通知

### 6.4 主动任务

主动任务不是直接发通知，而是：

```text
Heartbeat/Cron
  -> CheckResult[]
  -> createSession({ session_mode: "async" })
  -> runText("系统检测到如下事项 ... 请判断是否需要通知用户")
  -> 若结果是 respond / ask_user / approval
  -> NotificationDispatcher 发送
```

这点非常重要：主动行为仍然必须走 NeuroCore cycle，而不是在 scheduler 里硬编码业务文本。

---

## 7. 按 PR 可实施的分解

下面的顺序是当前最推荐的直接开工顺序。

### PR-1：`examples/personal-assistant/` 脚手架

改动：

- 新增 `examples/personal-assistant/README.md`
- 新增 `examples/personal-assistant/src/main.ts`
- 新增 `examples/personal-assistant/scripts/dev-web-chat.mjs`
- 新增 `examples/personal-assistant/scripts/dev-feishu.mjs`

验收：

- `npm run typecheck` 仍可通过
- 示例应用可以从 `@neurocore/*` 核心包正常 import

### PR-2：`im-gateway` 核心路由与输入工厂

**目标**：打通 `createUserInput -> create/connect session -> runText`

改动：

- `types.ts`
- `input/input-factory.ts`
- `conversation/*`
- `runtime/assistant-runtime-factory.ts`
- `gateway.ts`

测试：

- 新 session 创建
- 老 session reconnect
- 终态 session 重建
- 无共享 state store 时的失败路径不作为支持场景

### PR-3：`web_search` / `web_browser`

**目标**：assistant 有第一批实用工具。

改动：

- `service-connectors/src/shared/*`
- `service-connectors/src/search/web-search.ts`
- `service-connectors/src/browser/web-browser.ts`

约束：

- 第一版只做只读工具
- 不上 headless browser
- `web_browser` 先输出“可消费文本摘要”，不要把完整网页渲染当目标

### PR-4：Web Chat 入口与本地 E2E

**目标**：不依赖第三方 IM，先闭本地开发环。

改动：

- `adapter/web-chat.ts`
- `notification/notification-dispatcher.ts`
- `examples/personal-assistant/scripts/dev-web-chat.mjs`

测试：

- WebSocket 收发消息
- 本地对话可重复连接
- search/browser 可在对话中被调用

### PR-5：飞书 Adapter 与审批绑定

**目标**：接通正式 IM 入口和 approval callback。

改动：

- `adapter/feishu.ts`
- `approval/*`
- `command/command-handler.ts`
- `examples/personal-assistant/scripts/dev-feishu.mjs`

测试：

- 飞书消息归一化
- `/new /reset /status`
- approval binding 写入与回调恢复

### PR-6：事务读能力

**目标**：收敛 `PA-M2` 的只读事务面。

改动：

- `email-read.ts`
- `calendar-read.ts`
- assistant 组装脚本中注册工具

测试：

- 查询邮件
- 查询日程
- tool result 能回流成最终 respond

### PR-7：主动引擎最小闭环

**目标**：实现 `PA-M3` 的 heartbeat + cron 最小闭环。

改动：

- `proactive-engine/src/types.ts`
- `heartbeat/heartbeat-scheduler.ts`
- `scheduler/cron-scheduler.ts`
- `proactive-engine.ts`

测试：

- heartbeat 定时触发
- triggered check 创建 proactive session
- 定时摘要通知链路

### PR-8：高副作用事务与审批

**目标**：把事务能力从只读扩到可执行。

改动：

- `email-send.ts`
- `calendar-write.ts`
- 飞书卡片审批更新

测试：

- `email_send` 进入审批流
- 审批通过后动作恢复执行
- 审批拒绝后 session 留在可继续状态

---

## 8. 测试文件建议

沿用仓库当前习惯，测试放在根目录 `tests/`。

建议新增：

```text
tests/
├── personal-assistant-gateway.test.mjs
├── personal-assistant-connectors.test.mjs
├── personal-assistant-approval.test.mjs
├── personal-assistant-proactive.test.mjs
└── personal-assistant-e2e.test.mjs
```

每个测试文件的重点：

- `personal-assistant-gateway.test.mjs`
  - route create/connect/rotate
  - command intercept
  - state-store-backed reconnect

- `personal-assistant-connectors.test.mjs`
  - search/browser schema
  - timeout/failure surface
  - sideEffectLevel 正确性

- `personal-assistant-approval.test.mjs`
  - pending approval 持久化
  - callback -> approve/reject -> resume
  - approver allow-list

- `personal-assistant-proactive.test.mjs`
  - heartbeat
  - cron
  - proactive session output -> notification

- `personal-assistant-e2e.test.mjs`
  - Web Chat 入口全链路
  - search/browser 问答
  - read-only proactive check

---

## 9. 当前文档与代码之间必须显式修正的点

下面这些地方，写代码时必须按“修正后的理解”执行：

### 9.1 不要依赖 `CreateSessionCommand.overrides`

它目前没接到 runtime 主链路里。

直接做法：

- 当前需要不同 profile 时，创建不同 builder
- 或者在组装期显式调用 builder 配置方法，例如 `configureRuntime()`、`configureMemory()`、`configureApprovalPolicy()`

### 9.2 不要把 `configurePolicy()` 当成通用审批配置

它当前只包了一层 `ToolPolicyProvider`。

直接做法：

- 需要某个工具强制审批：`requiredApprovalTools`
- 需要高副作用动作默认审批：靠 `DefaultPolicyProvider` + `sideEffectLevel: "high"`
- 需要 approver allow-list：`configureApprovalPolicy()`

### 9.3 不要把历史 events 当恢复源

`hydratePersistedSession()` 会把 event bus 用空数组重置。

直接做法：

- 恢复依赖 `session + approvals + trace_records`
- 界面态或 adapter 回复态如果要恢复，自己查 binding store / trace

### 9.4 第一版不要上 headless browser

这会把 `PA-M1` 从“可交付工具层”拖成“复杂抓取平台”。

第一版 `web_browser` 的目标是：

- fetch URL
- 提取 title
- 转成可总结的文本
- 返回 links

足够支撑搜索后二跳阅读。

---

## 10. 非阻塞但值得排进后续的 core 补强

这些不是当前 personal assistant 开工的阻塞项，但如果要让产品层代码更干净，值得后续补回核心仓库：

1. `CreateSessionCommand.overrides` 真正接入 runtime
2. `sdk-core` 提供 `createUserInput()` 官方 helper
3. `runtime-core` 支持事件历史持久化
4. `sdk-core` 提供 `connectOrCreateSession()` 高层 helper

这些增强都不应成为当前实现前置条件，但应作为“减少产品层补丁代码”的明确 backlog。

---

## 11. 当前最推荐的开工口径

如果今天就开始写代码，推荐顺序是：

1. 先建包和路径
2. 先做 `im-gateway + shared state store + Web Chat`
3. 再做 `search/browser`
4. 再补飞书和审批
5. 再补 read-only proactive
6. 最后再补 write connectors

也就是说，当前最先要追求的不是“功能列表看起来完整”，而是：

**让一条最小真实链路稳定跑通，并且跨消息、跨重启、跨审批都不会断。**

只要这条链路成立，后面的 email/calendar/proactive/knowledge 都能在同一个骨架上继续长出来。
