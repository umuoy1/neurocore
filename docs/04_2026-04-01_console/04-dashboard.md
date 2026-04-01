# Dashboard（FR-50）

## 页面路由

`/dashboard`

## 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ NeuroCore Console    [tenant: acme ▼]    [user: admin ▼]    [● WS] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ [Active Sessions] [Total Cycles] [Error Rate] [Avg Latency] [Eval %]│
│      12               3,847         2.1%         342ms       94.2%  │
│  ↑+2 since 5s      ↑+47 /min     ↓-0.3%      ↓-12ms       ↑+1.2%  │
│                                                                      │
├─────────────────────────────┬────────────────────────────────────────┤
│ Cycle Throughput (1h)       │ Latency Distribution                   │
│ [Recharts AreaChart]       │ [Recharts BarChart: p50/p95/p99]       │
│ x: time (1m intervals)     │ grouped by agent_id                    │
│ y: cycles/minute           │                                        │
│ Live updating via WS       │                                        │
├─────────────────────────────┼────────────────────────────────────────┤
│ Session State Distribution  │ Health Status                         │
│ [Recharts PieChart]        │ Runtime:  [●] OK                      │
│ running: 12, completed: 45 │ Store:    [●] OK                      │
│ waiting: 3, failed: 2      │ WebSocket:[●] Connected               │
│                             │ Uptime: 48h 23m                       │
│                             │ Version: 0.1.0                        │
├─────────────────────────────┴────────────────────────────────────────┤
│ Live Event Feed (last 50)                                            │
│ 14:23:01  session.created     sess_abc123  tenant_acme              │
│ 14:23:02  cycle.started       sess_abc123  cycle_001                │
│ 14:23:03  proposal.submitted  sess_abc123  reasoner, action, 0.92   │
│ 14:23:04  action.executed     sess_abc123  call_tool, succeeded     │
│ ...                                                                  │
│ [Event type filter ▼] [⏸ Pause]                                     │
└──────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### MetricCard（x5）

五张指标卡片，水平排列：

| 卡片 | 数据源 | 实时更新 | 点击行为 |
|---|---|---|---|
| Active Sessions | `metrics.active_sessions` | WS `metrics` 通道 | → `/sessions?state=running` |
| Total Cycles | `metrics.total_cycles_executed` | WS `metrics` 通道 | 无 |
| Error Rate | 推算 `(error_count / total_cycles)` | WS `metrics` 通道 | → `/sessions?state=failed` |
| Avg Latency | `metrics.average_latency_ms` | WS `metrics` 通道 | 无 |
| Eval Pass Rate | `metrics.eval_pass_rate` | WS `evals` 通道 | → `/evals` |

每张卡片显示：
- 当前值（大字体）
- 变化趋势（与前值对比的 ↑↓ + delta）
- 迷你 sparkline（最近 20 个采样点）

### ThroughputChart

- **图表类型**：Recharts `<AreaChart>`
- **X 轴**：时间（1 分钟间隔）
- **Y 轴**：cycles/minute
- **数据源**：`GET /v1/metrics/timeseries?metric=cycles_executed&window={timeRange}&interval=1m`
- **交互**：时间范围选择器（1h / 6h / 24h / 7d），hover 显示 tooltip
- **实时**：每 5s 追加新数据点（来自 WS `metrics` 通道的增量）

### LatencyChart

- **图表类型**：Recharts `<BarChart>` 分组
- **X 轴**：agent_id
- **Y 轴**：延迟 ms
- **柱形**：p50（蓝）、p95（橙）、p99（红）
- **数据源**：`GET /v1/metrics/latency?window={timeRange}`

### SessionDistributionChart

- **图表类型**：Recharts `<PieChart>`
- **数据**：按 `SessionState` 分组的 session 数量
- **颜色**：running=蓝, completed=绿, waiting=黄, failed=红, suspended=灰, escalated=橙
- **数据源**：从 `GET /v1/sessions` 客户端聚合
- **交互**：点击扇区跳转 `/sessions?state={state}`

### HealthPanel

显示三项健康指标：
- Runtime 健康状态（`GET /healthz`）
- WebSocket 连接状态（客户端本地状态）
- Uptime 和版本号

### LiveEventFeed

- **数据源**：WS `events` 通道，缓冲最近 50 条
- **显示**：时间戳、事件类型（颜色编码）、session_id、摘要信息
- **交互**：
  - 事件类型下拉筛选（从 `NeuroCoreEventType` 全集选择）
  - 暂停/恢复按钮
  - 点击行跳转对应 session 详情页

## 数据刷新策略

| 组件 | 初始加载 | 实时更新 | 手动刷新 |
|---|---|---|---|
| Metric Cards | `GET /v1/metrics` | WS `metrics` 每 5s | — |
| Throughput Chart | `GET /v1/metrics/timeseries` | WS 追加数据点 | 时间范围切换 |
| Latency Chart | `GET /v1/metrics/latency` | — | 时间范围切换 |
| Session Distribution | `GET /v1/sessions` | WS `events` | — |
| Health Panel | `GET /healthz` | WS `metrics` | — |
| Live Event Feed | — | WS `events` 实时 | — |
