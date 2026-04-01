# Multi-Agent 面板

## 页面路由

- `/agents` — 多智能体总览
- `/agents/:agentId` — 单智能体详情（过滤视图）

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ Multi-Agent                                    [Refresh]             │
├──────────────────────────────────────────────────────────────────────┤
│ Agent Registry (4 agents)                                            │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ agent_01  planner  v1.0  [idle]   load: 2/5   Uptime: 48h      │ │
│ │ capabilities: planning,delegation   domains: general             │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ agent_02  coder    v1.2  [busy]   load: 4/4   Uptime: 12h      │ │
│ │ capabilities: coding,testing        domains: software            │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ agent_03  reviewer v1.0  [busy]   load: 1/3   Uptime: 6h       │ │
│ │ capabilities: code_review           domains: software            │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ agent_04  data     v1.1  [idle]   load: 0/5   Uptime: 2h       │ │
│ │ capabilities: data_analysis         domains: analytics           │ │
│ └──────────────────────────────────────────────────────────────────┘ │
├────────────────────────────┬─────────────────────────────────────────┤
│ Active Delegations (3)     │ Coordination                           │
│ deleg_01: planner → coder  │ Strategy: hierarchical                 │
│   status: running, 5m ago │ Workers: coder, reviewer               │
│ deleg_02: planner → review │ Assignments:                           │
│   status: accepted, 2m ago│   coder → "Implement feature"          │
│ deleg_03: planner → data   │   reviewer → "Review PR"              │
│   status: timeout, 10m ago │                                        │
├────────────────────────────┴─────────────────────────────────────────┤
│ Heartbeat Monitor                                                    │
│ agent_01: [OK] 5s ago    agent_02: [OK] 8s ago                     │
│ agent_03: [OK] 3s ago    agent_04: [WARN] last: 45s ago            │
├──────────────────────────────────────────────────────────────────────┤
│ Auction History (when applicable)                                    │
│ Auction: deleg_03    Status: completed                              │
│ Bids: agent_02: $0.05 conf:0.8 | agent_04: $0.03 conf:0.9 [WIN]   │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### AgentRegistryTable

Agent 列表，来自 `AgentDescriptor[]`。

| 列 | 字段 | 说明 |
|---|---|---|
| Agent ID | `agent_id` | 可点击过滤 |
| Name | `name` | — |
| Version | `version` | — |
| Status | `status` | 彩色徽章（见下表） |
| Load | `current_load / max_capacity` | 进度条 |
| Capabilities | `capabilities[].name` | 标签列表 |
| Domains | `domains[]` | 标签列表 |
| Last Heartbeat | `last_heartbeat_at` | 相对时间 |
| Registered | `registered_at` | 相对时间 |

**Status 颜色**：

| Status | 颜色 |
|---|---|
| `registering` | 灰色 |
| `idle` | 绿色 |
| `busy` | 蓝色 |
| `draining` | 黄色 |
| `unreachable` | 橙色 |
| `terminated` | 红色 |

点击 Agent ID 或 Name → 页面过滤为该 Agent 的委派和协调数据。

### DelegationTimeline

委派请求/响应流程展示。

每条委派显示：
- `delegation_id`
- source_agent_id → target_agent_id（或 capabilities 描述）
- `mode` 标签（unicast / broadcast / auction）
- `status` 彩色标签
- `goal.title` — 委派的目标
- `timeout_ms` — 超时设置
- `created_at` — 创建时间
- 如有 response：assigned_agent、result.status

可按 status 筛选：pending / accepted / running / completed / failed / timeout。

### CoordinationView

当前协调策略和任务分配。

显示内容：
- `strategy_name`（hierarchical / peer_to_peer / market_based）
- `assignments[]`：每条分配显示 agent_id、sub_goal.title、priority、dependencies
- `reasoning`（策略选择的理由）

### AuctionPanel

当委派 mode 为 `auction` 时展示拍卖详情。

每条拍卖显示：
- `delegation_id`
- `status`（started / completed）
- `bids[]`：每条 bid 显示 agent_id、estimated_duration_ms、estimated_cost、confidence、reasoning
- `selected_bid` 高亮标记 [WIN]

### HeartbeatMonitor

Agent 心跳状态网格。

每行显示：
- Agent name
- 状态指示器：OK（绿）/ WARN（黄）/ LOST（红）
- `last_heartbeat_at` 相对时间
- 心跳间隔 `heartbeat_interval_ms`

**状态判断**：
- OK：距上次心跳 < `heartbeat_interval_ms * heartbeat_timeout_multiplier`
- WARN：超过间隔但未达 max_misses
- LOST：连续 max_misses 次未收到

## 数据源

需要新增后端 API：

| 数据 | API | 说明 |
|---|---|---|
| Agent 列表 | `GET /v1/agents-registry` | 返回 `AgentDescriptor[]` |
| 委派列表 | `GET /v1/delegations` | 返回 `DelegationRequest[]` |
| 委派详情 | `GET /v1/delegations/:id` | 含 `DelegationResponse` |
| 协调状态 | `GET /v1/coordination` | 返回当前协调上下文 |

实时更新通过 WS `agents` 和 `delegations` 通道。

## 交互

- 点击 Agent → 过滤该 Agent 的委派和协调
- 点击 Delegation → 展开完整 request/response 详情
- 点击 Auction → 展开所有 bids
- 按 status 筛选委派列表
- 心跳监控实时更新

## 组件结构

```
MultiAgentDashboardPage
  ├── AgentRegistryTable
  │    └── AgentStatusCard (per agent)
  ├── DelegationTimeline
  │    └── DelegationCard (mode badge, status, goal)
  ├── CoordinationView
  │    └── TaskAssignment (sub_goal, dependencies)
  ├── AuctionPanel
  │    └── BidCard (cost, confidence, reasoning)
  └── HeartbeatMonitor
       └── HeartbeatRow (agent name + status indicator)
```
