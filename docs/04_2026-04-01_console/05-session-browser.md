# Session 浏览器（FR-51）

## 页面路由

- `/sessions` — Session 列表
- `/sessions/:sessionId` — Session 详情

## Session 列表页

### 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ Sessions                                         [＋ New Session]   │
├──────────────────────────────────────────────────────────────────────┤
│ State: [All ▼] Agent: [All ▼] Tenant: [acme ▼] Date: [━━━●━━]     │
│ Search: [________________]                                          │
├──────────────────────────────────────────────────────────────────────┤
│ State │ Session ID    │ Agent   │ Mode  │ Cycles │ Ep │ Approval │ Created   │ Actions │
│ ●run  │ sess_abc123   │ planner │ sync  │ 12     │ 3  │ —        │ 14:20:05 │ [Cancel]│
│ ●wait │ sess_def456   │ coder   │ async │ 8      │ 2  │ pending  │ 14:18:30 │         │
│ ●done │ sess_ghi789   │ planner │ sync  │ 25     │ 5  │ —        │ 14:15:00 │         │
│ ●fail │ sess_jkl012   │ data    │ sync  │ 3      │ 0  │ —        │ 14:10:22 │         │
├──────────────────────────────────────────────────────────────────────┤
│ Showing 1-20 of 156                    [< Prev] 1 2 3 ... 8 [Next>]│
└──────────────────────────────────────────────────────────────────────┘
```

### 筛选栏

| 筛选器 | 数据源 | 说明 |
|---|---|---|
| State | `SessionState` 枚举 | 多选：created/hydrated/running/waiting/suspended/escalated/completed/failed/aborted |
| Agent | 从 sessions 聚合 | 单选下拉 |
| Tenant | auth context | 管理员可见 |
| Date Range | 日期选择器 | 创建时间范围 |
| Search | 自由文本 | 匹配 session_id 或 agent_id |

### 表格列

| 列 | 字段 | 说明 |
|---|---|---|
| State | `session.state` | 彩色圆点 + 文字 |
| Session ID | `session.session_id` | 可点击链接 → 详情页 |
| Agent | `agent_id` | — |
| Mode | `session.session_mode` | sync/async/stream 标签 |
| Cycles | trace 数量 | — |
| Episodes | episode 数量 | — |
| Approval | `pending_approval` | pending 显示黄色 badge |
| Created | `session.created_at` | 相对时间 |
| Actions | — | running 状态显示 Cancel 按钮 |

### 实时更新

- 订阅 WS `events` 通道
- `session.created` → 新行前置插入，高亮闪烁
- `session.state_changed` → 对应行 state 更新
- `session.completed` / `session.failed` → 对应行 state 更新

## Session 详情页

### 布局

三栏布局（宽屏），窄屏堆叠：

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back    Session: sess_abc123          [Send Input] [Cancel]       │
├────────────┬──────────────────────────┬──────────────────────────────┤
│ Info Panel │ Goal Tree + Memory       │ Timeline + Events           │
│            │                          │                              │
│ Agent:     │ Goals                    │ Cycle Timeline               │
│ planner    │ ● Generate report  45%  │ [==C1==][===C2===][=C3=]... │
│            │   ○ Collect data 100%    │                              │
│ Tenant:    │   ○ Analyze      60%    │ Events (live)                │
│ acme       │   ○ Format        0%    │ 14:23:01 session.created     │
│            │                          │ 14:23:02 cycle.started       │
│ Mode: sync │ Working Memory           │ 14:23:03 proposal.submitted  │
│ Cycles: 12 │ mem_01: Sales (0.95)    │ 14:23:04 action.executed     │
│            │ mem_02: Growth (0.88)    │ ...                          │
│ Budget     │ mem_03: Target (0.82)   │                              │
│ Tokens:    │                          │ [View Full Traces →]         │
│ [████░░] 60%                          │ [View Replay →]              │
│ Cost:      │                          │                              │
│ [███░░░] 45%│                         │                              │
│ Cycles:    │                          │                              │
│ [██████] 100%                        │                              │
│            │                          │                              │
│ Policy     │                          │                              │
│ Risk: normal│                         │                              │
│ Level: none│                          │                              │
│            │                          │                              │
│ Approval   │                          │                              │
│ [none]     │                          │                              │
├────────────┴──────────────────────────┴──────────────────────────────┤
│ [Traces] [Goals] [Memory] [Episodes] [Replay]                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 左栏 — Info Panel

**基本信息卡片**：agent_id, tenant_id, session_mode, current_cycle_id, created_at, last_active_at

**BudgetGauge**：三组水平进度条：
- Token: `token_budget_used / token_budget_total`
- Cost: `cost_budget_used / cost_budget_total`
- Cycle: `cycle_used / cycle_limit`
- 颜色：< 70% 绿，70-90% 橙，> 90% 红

**PolicyBadge**：risk_mode 标签、escalation_level 指示器、blocked_tools 列表

**Approval 状态**：若 `pending_approval` 存在，显示卡片含 action 摘要和快速 Approve/Reject 按钮

### 中栏 — Goal Tree + Memory

- **Goal Tree**：可折叠的层级视图，节点按 status 着色，显示 progress 进度条
- **Working Memory**：最近 N 条记录，按 relevance 降序，每条显示 summary 和 relevance 值

### 右栏 — Timeline + Events

- **Mini Timeline**：比例宽度条形图，每段代表一个 cycle，宽度按 duration 比例
- **Event Stream**：实时事件流（WS `session:{id}` 通道），最近 100 条

### 底部操作栏

| 按钮 | 行为 |
|---|---|
| Traces | → `/sessions/:id/traces` |
| Goals | → `/sessions/:id/goals` |
| Memory | → `/sessions/:id/memory` |
| Episodes | → 展开完整 episode 列表 |
| Replay | → 打开 replay 模式 |
| Send Input | 弹出文本输入框，调用 `POST /v1/sessions/:id/inputs` |
| Cancel | 确认对话框，调用 `POST /v1/sessions/:id/cancel` |

### 数据源

| 组件 | API |
|---|---|
| Info Panel | `GET /v1/sessions/:id` |
| Goals | `session.goals` from session detail |
| Working Memory | `session.working_memory` from session detail |
| Timeline | `GET /v1/sessions/:id/traces` |
| Events (历史) | `GET /v1/sessions/:id/events` |
| Events (实时) | WS `session:{id}` 通道 |
