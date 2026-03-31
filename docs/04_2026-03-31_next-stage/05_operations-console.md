# D. 运营控制台 — 详细设计

> FR-50 ~ FR-55 · Milestone 11
> 基于 2026-03-31 代码状态，NeuroCore 运营控制台的完整设计方案。

## 1. 概述

### 1.1 目标

运营控制台为 NeuroCore 提供 Web UI，覆盖三个核心场景：

1. **运维监控** — 实时查看 Agent 运行状态、session 生命周期、cycle 执行指标
2. **问题诊断** — 通过 trace 可视化、replay 回放和 prediction error 追踪定位认知链路异常
3. **配置管理** — Agent 配置编辑、策略模板管理、预算设置、审批策略配置

运营控制台独立于方向 A（多 Agent）、B（世界模型）、C（强化学习），但随着这三个方向的推进，控制台将逐步扩展对应的管理界面。

### 1.2 设计原则

| 原则 | 说明 |
|---|---|
| API-first | 控制台所有操作均通过 REST/WebSocket API 完成，不绕过 runtime-server |
| 零侵入 | 不修改 runtime-core 内部逻辑，仅扩展 runtime-server 的 API 层 |
| 渐进式 | 首版聚焦只读监控和基本操作，后续再叠加高级编辑和自动化能力 |
| 多租户隔离 | UI 层严格按 tenant_id 隔离数据，复用现有 ApiKeyAuthenticator 体系 |

### 1.3 与现有后端的关系

运营控制台建立在 runtime-server 已有的 API 基础上。当前已具备的端点：

| 端点 | 用途 |
|---|---|
| `GET /healthz` | 健康检查（active_sessions, uptime_seconds, version） |
| `GET /v1/metrics` | 全局指标（session/cycle/eval/SSE 计数） |
| `GET /v1/sessions` | 会话列表（支持 tenant_id/state 筛选、分页） |
| `GET /v1/sessions/:id` | 会话详情 |
| `GET /v1/sessions/:id/replay` | 完整 replay 数据 |
| `GET /v1/sessions/:id/replay/:cycleId` | 单 cycle trace 详情 |
| `GET /v1/sessions/:id/traces` | trace 记录列表 |
| `GET /v1/sessions/:id/events` | 事件列表 |
| `GET /v1/sessions/:id/events/stream` | SSE 实时事件流 |
| `GET /v1/sessions/:id/workspace/:cycleId` | Workspace 快照 |
| `GET /v1/sessions/:id/episodes` | Episode 列表 |
| `GET /v1/approvals` | 审批列表（支持 tenant_id/status 筛选） |
| `POST /v1/approvals/:id/decision` | 审批决策 |
| `GET /v1/evals/runs` | Eval run 列表 |
| `GET /v1/evals/runs/:id` | Eval run 详情 |
| `GET /v1/evals/compare` | Eval 对比（run_a vs run_b） |
| `GET /v1/webhooks/deliveries` | Webhook 投递记录 |

控制台在此基础上新增时序聚合、配置管理和 WebSocket 实时推送等 API。

---

## 2. 需求分解 (FR-50 ~ FR-55)

### FR-50: Dashboard 概览

| 字段 | 内容 |
|---|---|
| **ID** | FR-50 |
| **标题** | Dashboard 概览 — 实时指标展示 |
| **描述** | 提供全局仪表盘页面，展示活跃 session 数、cycle 执行率、错误率、延迟分布等核心指标的实时视图 |
| **优先级** | P0 |
| **依赖** | 现有 `GET /v1/metrics`、`GET /healthz`、新增时序聚合 API |

**验收标准：**

1. Dashboard 页面展示至少 5 个核心指标卡片：活跃 session 数、总 cycle 执行数、错误率、平均延迟、eval 通过率
2. 指标数据每 5 秒自动刷新
3. 支持时间范围选择器（最近 1h / 6h / 24h / 7d）
4. Health 状态指示灯，反映 runtime 健康状态
5. 实时事件流面板，展示最近 50 条系统事件

### FR-51: Session 浏览器

| 字段 | 内容 |
|---|---|
| **ID** | FR-51 |
| **标题** | Session 浏览器 — 会话列表与详情 |
| **描述** | 提供会话列表、搜索、筛选和详情页面，支持实时跟踪正在运行的 session |
| **优先级** | P0 |
| **依赖** | 现有 `GET /v1/sessions`、`GET /v1/sessions/:id`、SSE 事件流 |

**验收标准：**

1. 会话列表支持按 tenant_id、state、agent_id、时间范围筛选
2. 支持分页和排序（按创建时间、最后活跃时间）
3. 会话详情页展示：基本信息、goal tree、budget state、policy state
4. 运行中的 session 支持实时事件流展示
5. 支持从列表页一键跳转到 trace 可视化

### FR-52: Trace 可视化

| 字段 | 内容 |
|---|---|
| **ID** | FR-52 |
| **标题** | Trace 可视化 — 认知周期时间线 |
| **描述** | 以时间线形式可视化认知周期的完整链路，支持 cycle 级别钻取，展示各阶段耗时和数据流转 |
| **优先级** | P0 |
| **依赖** | 现有 `GET /v1/sessions/:id/replay`、`GET /v1/sessions/:id/workspace/:cycleId` |

**验收标准：**

1. 水平时间线展示 session 的所有 cycle
2. 每个 cycle 可展开查看阶段分解：Perceive → Propose → Evaluate → Decide → Act → Observe → Learn
3. 展示 proposal 竞争过程（competition_log 可视化）
4. 展示 prediction vs observation 对比（prediction_error 高亮）
5. 点击任意 cycle 可查看完整 workspace snapshot

### FR-53: Eval 仪表盘

| 字段 | 内容 |
|---|---|
| **ID** | FR-53 |
| **标题** | Eval 仪表盘 — 评估管理与结果分析 |
| **描述** | 提供 eval run 管理界面，支持结果对比、趋势图和回归检测 |
| **优先级** | P1 |
| **依赖** | 现有 `GET /v1/evals/runs`、`GET /v1/evals/compare`、新增时序聚合 API |

**验收标准：**

1. Eval run 列表展示 pass/fail 率、耗时、case 数量
2. 支持两个 run 的并排对比（复用 `GET /v1/evals/compare`）
3. 趋势图展示 pass 率随时间的变化曲线
4. 当 pass 率低于阈值时显示回归警告
5. 支持从 eval 结果直接跳转到关联 session 的 trace

### FR-54: 审批管理

| 字段 | 内容 |
|---|---|
| **ID** | FR-54 |
| **标题** | 审批管理 — 审批队列与历史 |
| **描述** | 提供待审批队列、一键审批/拒绝操作、审批历史和审计日志 |
| **优先级** | P1 |
| **依赖** | 现有 `GET /v1/approvals`、`POST /v1/approvals/:id/decision` |

**验收标准：**

1. 待审批队列实时更新，展示 action 详情和风险评估
2. 支持一键 approve / reject，附带可选 comment
3. 审批历史列表支持按 tenant_id、时间范围、审批人筛选
4. 展示审批相关的完整上下文（cycle workspace snapshot）
5. 审批操作产生 audit log 条目

### FR-55: 配置管理

| 字段 | 内容 |
|---|---|
| **ID** | FR-55 |
| **标题** | 配置管理 — Agent 配置与策略编辑 |
| **描述** | 提供 Agent Profile 编辑、策略模板管理、预算设置和工具权限管理界面 |
| **优先级** | P2 |
| **依赖** | 新增配置 CRUD API |

**验收标准：**

1. Agent Profile 编辑器支持 JSON 格式编辑与表单编辑两种模式
2. 编辑器提供 schema 校验和错误提示
3. 策略模板库支持创建、编辑、删除和复制操作
4. 预算配置（cost_budget、max_cycles、max_runtime_ms）支持在线修改
5. 工具权限管理支持 tool_refs 的增删和 blocked_tools 配置

---

## 3. 架构设计

### 3.1 前后端架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React + TypeScript SPA                         │  │
│  │  ┌───────────┬──────────┬──────────┬────────┬───────────┐  │  │
│  │  │ Dashboard │ Sessions │  Traces  │ Evals  │  Config   │  │  │
│  │  │  (FR-50)  │ (FR-51)  │ (FR-52)  │(FR-53) │ (FR-54/55)│  │  │
│  │  └─────┬─────┴────┬─────┴────┬─────┴───┬────┴─────┬─────┘  │  │
│  │        │          │          │         │          │          │  │
│  │  ┌─────┴──────────┴──────────┴─────────┴──────────┴─────┐  │  │
│  │  │              State Management (Zustand)               │  │  │
│  │  └─────┬───────────────────────────────────────────┬─────┘  │  │
│  │        │ REST (fetch)                              │ WS     │  │
│  └────────┼───────────────────────────────────────────┼────────┘  │
└───────────┼───────────────────────────────────────────┼──────────┘
            │                                           │
            ▼                                           ▼
┌───────────────────────────────────────────────────────────────────┐
│                    runtime-server (Node.js)                       │
│  ┌─────────────────────┐  ┌───────────────────────────────────┐  │
│  │   REST API Layer     │  │      WebSocket Server             │  │
│  │  (existing + new)    │  │  (upgrade from SSE to WS)         │  │
│  └──────────┬──────────┘  └──────────────┬────────────────────┘  │
│             │                            │                       │
│  ┌──────────┴────────────────────────────┴────────────────────┐  │
│  │                  Request Handler                           │  │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Sessions │  │  Metrics  │  │  Evals   │  │ Configs  │  │  │
│  │  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └────┬─────┘  │  │
│  └───────┼──────────────┼──────────────┼─────────────┼────────┘  │
│          ▼              ▼              ▼             ▼            │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │                    runtime-core                            │    │
│  │  CycleEngine · AgentRuntime · TraceRecorder · MetaCtrl    │    │
│  └───────────────────────────────────────────────────────────┘    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │                      Stores                                │    │
│  │  RuntimeStateStore · TraceStore · EvalStore · ConfigStore  │    │
│  └───────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 技术选型

| 层级 | 选型 | 理由 |
|---|---|---|
| 前端框架 | React 19 + TypeScript | 生态成熟，组件库丰富，适合数据密集型管理后台 |
| 构建工具 | Vite | 开发体验好，HMR 快，与 monorepo 集成简单 |
| 状态管理 | Zustand | 轻量、TypeScript 友好、无 boilerplate |
| 路由 | React Router v7 | 支持 data loading、lazy routes |
| UI 组件 | Ant Design 5 | 企业级管理后台标准方案，表格/表单组件完善 |
| 图表 | Apache ECharts | 支持时序图、柱状图、热力图、自定义时间线 |
| 实时通信 | WebSocket (native) | 替代 SSE，支持双向通信和多频道订阅 |
| HTTP 客户端 | fetch (built-in) | 浏览器原生，无需额外依赖 |
| 代码编辑器 | Monaco Editor | 支持 JSON/YAML schema 校验，与 VS Code 一致的编辑体验 |

### 3.3 API 扩展

现有 API 已覆盖大部分数据读取需求。需要新增的 API 分为四类：

#### 3.3.1 WebSocket 实时推送

| 端点 | 用途 |
|---|---|
| `GET /v1/ws` | WebSocket 升级端点，替代 SSE 实现多频道实时推送 |

#### 3.3.2 时序聚合指标

| 端点 | 用途 |
|---|---|
| `GET /v1/metrics/timeseries` | 按时间窗口聚合的指标（session 创建数、cycle 执行数、错误数、延迟分布） |
| `GET /v1/metrics/latency` | 延迟分位数（p50/p95/p99），按 agent_id 分组 |

#### 3.3.3 配置 CRUD

| 端点 | 用途 |
|---|---|
| `GET /v1/agents` | 已注册 Agent 列表（id, name, version） |
| `GET /v1/agents/:id/profile` | Agent Profile 详情 |
| `PUT /v1/agents/:id/profile` | 更新 Agent Profile |
| `GET /v1/policies` | 策略模板列表 |
| `POST /v1/policies` | 创建策略模板 |
| `PUT /v1/policies/:id` | 更新策略模板 |
| `DELETE /v1/policies/:id` | 删除策略模板 |

#### 3.3.4 审计日志

| 端点 | 用途 |
|---|---|
| `GET /v1/audit-logs` | 操作审计日志（支持按 tenant_id、操作类型、时间范围筛选） |

### 3.4 页面设计

#### 3.4.1 Dashboard 概览 (FR-50)

**布局结构：**

```
┌──────────────────────────────────────────────────────────────┐
│  NeuroCore Console          [tenant selector]    [user menu] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ Active  │ │  Total  │ │  Error  │ │  Avg    │ │ Eval  │ │
│  │Sessions │ │ Cycles  │ │  Rate   │ │ Latency │ │ Pass% │ │
│  │   12    │ │  3,847  │ │  2.1%   │ │  342ms  │ │ 94.2% │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘ │
│                                                              │
│  ┌──────────────────────────────┐ ┌────────────────────────┐ │
│  │  Cycle Throughput (time)     │ │  Health Status         │ │
│  │  ┌──────────────────────┐   │ │  ● Runtime    OK       │ │
│  │  │  ▂▃▅▇█▇▅▃▅▇█▇▅▃▂▃  │   │ │  ● Store     OK       │ │
│  │  │  ──────────────────  │   │ │  ● WebSocket OK       │ │
│  │  └──────────────────────┘   │ │  Uptime: 48h 23m      │ │
│  └──────────────────────────────┘ └────────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Recent Events (live)                                    │ │
│  │  14:23:01  session.created       sess_abc123  tenant_x   │ │
│  │  14:23:02  cycle.started         sess_abc123  cycle_001  │ │
│  │  14:23:03  action.executed       sess_abc123  call_tool  │ │
│  │  14:23:04  observation.recorded  sess_abc123  success    │ │
│  │  ...                                                     │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**数据来源：**

| 组件 | 数据源 |
|---|---|
| 指标卡片 | `GET /v1/metrics` 轮询 + `GET /healthz` |
| 吞吐量图表 | `GET /v1/metrics/timeseries?window=1h&interval=1m` |
| Health 状态 | `GET /healthz` |
| 实时事件 | WebSocket 订阅 `channel: "events"` |

#### 3.4.2 Session 浏览器 (FR-51)

**列表视图：**

```
┌──────────────────────────────────────────────────────────────┐
│  Sessions                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [State ▼] [Agent ▼] [Tenant ▼] [Date Range] [Search]  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────┬──────────┬─────────┬────────┬────────┬──────────┐ │
│  │State │Session ID│ Agent   │Tenant  │Cycles  │ Created  │ │
│  ├──────┼──────────┼─────────┼────────┼────────┼──────────┤ │
│  │●run  │sess_a12  │planner  │acme    │   7    │ 14:20:01 │ │
│  │●done │sess_b34  │coder    │acme    │  12    │ 14:15:33 │ │
│  │●wait │sess_c56  │reviewer │beta    │   3    │ 14:10:22 │ │
│  │●fail │sess_d78  │planner  │gamma   │   5    │ 13:58:10 │ │
│  └──────┴──────────┴─────────┴────────┴────────┴──────────┘ │
│  Showing 1-20 of 156                          [< 1 2 3 .. >]│
└──────────────────────────────────────────────────────────────┘
```

**详情视图：**

```
┌──────────────────────────────────────────────────────────────┐
│  Session: sess_a12                          [← Back to List] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Basic Info ──────────────────────────────────────────┐   │
│  │ Agent: planner v1.0   Tenant: acme   Mode: sync      │   │
│  │ State: running   Started: 2026-03-31 14:20:01        │   │
│  │ Budget: 1200/5000 tokens   Cost: $0.024/$1.00        │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Goal Tree ───────────────────────────────────────────┐   │
│  │  ▼ [active] Generate quarterly report                  │   │
│  │    ├─ [done] Collect sales data                        │   │
│  │    ├─ [active] Analyze trends                          │   │
│  │    │   └─ [pending] Validate outliers                  │   │
│  │    └─ [pending] Format output                          │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Timeline ────────────────────────────────────────────┐   │
│  │  [Cycle 1]──[Cycle 2]──[Cycle 3]──[Cycle 4]──▶ live   │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Working Memory ──────────────────────────────────────┐   │
│  │  mem_01: Sales Q1 = $1.2M  (relevance: 0.95)         │   │
│  │  mem_02: Target growth 15% (relevance: 0.88)          │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  [View Traces]  [View Events]  [View Replay]                 │
└──────────────────────────────────────────────────────────────┘
```

#### 3.4.3 Trace 可视化 (FR-52)

**时间线视图：**

```
┌──────────────────────────────────────────────────────────────┐
│  Trace: sess_a12                                             │
│                                                              │
│  Cycle Timeline                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ C1         C2           C3         C4        C5      │    │
│  │ ├──280ms──┤├───450ms───┤├──320ms──┤├─190ms─┤├─▶      │    │
│  │ ✓          ✓            ✓          ✓         ●        │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Cycle 3 — Phase Breakdown                                   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Perceive │ Propose │ Evaluate │ Decide │ Act │ Learn  │    │
│  │ ██ 40ms  │███ 80ms │██ 50ms   │█ 30ms  │████│█ 20ms  │    │
│  │          │         │          │        │100ms│        │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Proposal Competition                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Rank │ Module    │ Type   │ Salience │ Final │ Status │    │
│  │  1   │ reasoner  │ action │   0.92   │ 0.88  │ ★ win  │    │
│  │  2   │ memory    │ recall │   0.85   │ 0.72  │   —    │    │
│  │  3   │ skill     │ match  │   0.78   │ 0.65  │   —    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Prediction vs Observation                                   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Prediction: "Tool call will return JSON with 3 fields"│    │
│  │ Observation: "Tool returned JSON with 5 fields"       │    │
│  │ ⚠ prediction_error: outcome_mismatch (severity: low)  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  [View Workspace Snapshot]                                   │
└──────────────────────────────────────────────────────────────┘
```

**数据来源：**

| 组件 | 数据源 |
|---|---|
| Cycle 时间线 | `GET /v1/sessions/:id/replay` → `CycleTraceRecord[]` |
| 阶段分解 | `CycleTrace.metrics.total_latency_ms` + workspace 内各阶段时间戳 |
| Proposal 竞争 | `WorkspaceSnapshot.competition_log` |
| Prediction 对比 | `CycleTraceRecord.predictions` + `CycleTraceRecord.prediction_errors` |
| Workspace 详情 | `GET /v1/sessions/:id/workspace/:cycleId` |

#### 3.4.4 Eval 仪表盘 (FR-53)

**Run 列表：**

```
┌──────────────────────────────────────────────────────────────┐
│  Eval Runs                                                   │
│                                                              │
│  ┌──────┬────────┬───────┬────────┬────────┬──────────────┐  │
│  │Status│ Run ID │ Agent │Cases   │Pass %  │ Created      │  │
│  ├──────┼────────┼───────┼────────┼────────┼──────────────┤  │
│  │ ✓    │run_a01 │planner│  20    │ 95.0%  │03-31 14:00   │  │
│  │ ✓    │run_b02 │planner│  20    │ 90.0%  │03-30 10:00   │  │
│  │ ⚠    │run_c03 │coder  │  15    │ 73.3%  │03-29 16:00   │  │
│  └──────┴────────┴───────┴────────┴────────┴──────────────┘  │
│                                                              │
│  [Compare Selected]  [Delete Selected]                       │
│                                                              │
│  Trend — Pass Rate Over Time                                 │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 100% ┤                              ●                │    │
│  │  90% ┤           ●        ●    ●                     │    │
│  │  80% ┤      ●                                        │    │
│  │  70% ┤ ●                                             │    │
│  │      └─────┬─────┬─────┬─────┬─────┬────────────────│    │
│  │        03-25 03-26 03-27 03-28 03-29 03-30  03-31    │    │
│  └──────────────────────────────────────────────────────┘    │
│  ⚠ Regression alert: run_c03 dropped below 80% threshold    │
└──────────────────────────────────────────────────────────────┘
```

**对比视图：**

```
┌──────────────────────────────────────────────────────────────┐
│  Compare: run_a01 vs run_b02                                 │
│                                                              │
│  ┌───────────────────────┬───────────────────────┐           │
│  │    run_a01 (95.0%)    │    run_b02 (90.0%)    │           │
│  ├───────────────────────┼───────────────────────┤           │
│  │ case_01: ✓ pass       │ case_01: ✓ pass       │           │
│  │ case_02: ✓ pass       │ case_02: ✗ fail       │  ← diff  │
│  │ case_03: ✓ pass       │ case_03: ✓ pass       │           │
│  │ ...                   │ ...                   │           │
│  └───────────────────────┴───────────────────────┘           │
│                                                              │
│  Summary: +1 newly passing, 0 regressions                    │
│  Avg latency: 320ms → 280ms (↓12.5%)                        │
└──────────────────────────────────────────────────────────────┘
```

#### 3.4.5 审批管理 (FR-54)

**待审批队列：**

```
┌──────────────────────────────────────────────────────────────┐
│  Approvals                       [Pending: 3]  [History]     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ● appr_x01                           Requested 2m ago │  │
│  │   Session: sess_a12  Agent: planner   Tenant: acme    │  │
│  │   Action: call_tool("delete_file", {path: "/data/..") │  │
│  │   Risk: HIGH   Side Effects: filesystem write          │  │
│  │   Review Reason: high side_effect_level                │  │
│  │                                                        │  │
│  │   [View Context]   [✓ Approve]   [✗ Reject]           │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ ● appr_y02                           Requested 5m ago │  │
│  │   Session: sess_c56  Agent: reviewer  Tenant: beta    │  │
│  │   Action: delegate("external_api_call")                │  │
│  │   Risk: MEDIUM                                         │  │
│  │                                                        │  │
│  │   [View Context]   [✓ Approve]   [✗ Reject]           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**审批上下文弹窗：**

点击 `[View Context]` 弹出完整的 `PendingApprovalContextSnapshot`，包括：
- 触发审批的 cycle 的完整 workspace snapshot
- 所有 proposals 和竞争过程
- predictions 和风险评估
- selected_action 的详细参数

#### 3.4.6 配置管理 (FR-55)

**Agent Profile 编辑器：**

```
┌──────────────────────────────────────────────────────────────┐
│  Agent Configuration: planner v1.0                           │
│                                                              │
│  [Form View]  [JSON View]                                    │
│                                                              │
│  ┌─ Basic ───────────────────────────────────────────────┐   │
│  │ Name:        [planner                    ]            │   │
│  │ Version:     [1.0                        ]            │   │
│  │ Role:        [task planning agent        ]            │   │
│  │ Domain:      [general                    ]            │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Runtime Config ──────────────────────────────────────┐   │
│  │ Max Cycles:       [50       ]                         │   │
│  │ Max Runtime (ms): [300000   ]                         │   │
│  │ Cycle Mode:       [standard ▼]                        │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Budget ──────────────────────────────────────────────┐   │
│  │ Cost Budget:      [$1.00    ]                         │   │
│  │ Cost Per Token:   [$0.00002 ]                         │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Tools ───────────────────────────────────────────────┐   │
│  │ [search_web] [read_file] [write_file] [+ Add Tool]    │   │
│  │ Blocked: [delete_file] [exec_cmd]                     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Approval Policy ────────────────────────────────────┐    │
│  │ Allowed Approvers: [admin_01] [admin_02] [+ Add]      │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  [Save Changes]  [Reset]  [Export JSON]                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. WebSocket 协议

### 4.1 连接建立

```
GET /v1/ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Authorization: Bearer <api_key>
```

认证通过后升级为 WebSocket 连接。连接建立后，客户端通过发送订阅消息选择感兴趣的频道。

### 4.2 消息格式

所有 WebSocket 消息均为 JSON 格式，遵循统一信封：

```typescript
interface WsMessage {
  type: "subscribe" | "unsubscribe" | "event" | "error" | "ack";
  channel: string;
  payload: Record<string, unknown>;
  message_id?: string;
  timestamp: string;
}
```

### 4.3 频道定义

| 频道 | 方向 | 说明 |
|---|---|---|
| `metrics` | Server → Client | 全局指标更新（每 5 秒推送） |
| `events` | Server → Client | 所有 NeuroCoreEvent（全局） |
| `session:{id}` | Server → Client | 特定 session 的事件流 |
| `approvals` | Server → Client | 新审批请求通知 |
| `evals` | Server → Client | Eval run 完成通知 |

### 4.4 订阅/取消订阅

客户端发送：

```json
{
  "type": "subscribe",
  "channel": "session:sess_abc123",
  "payload": {},
  "message_id": "msg_001",
  "timestamp": "2026-03-31T14:23:00Z"
}
```

服务端确认：

```json
{
  "type": "ack",
  "channel": "session:sess_abc123",
  "payload": { "subscribed": true },
  "message_id": "msg_001",
  "timestamp": "2026-03-31T14:23:00Z"
}
```

### 4.5 事件推送

服务端推送事件时复用现有 `NeuroCoreEvent` 结构：

```json
{
  "type": "event",
  "channel": "session:sess_abc123",
  "payload": {
    "event_id": "evt_xyz",
    "event_type": "cycle.started",
    "schema_version": "1.0",
    "tenant_id": "acme",
    "session_id": "sess_abc123",
    "cycle_id": "cycle_003",
    "timestamp": "2026-03-31T14:23:01Z",
    "payload": { }
  },
  "timestamp": "2026-03-31T14:23:01Z"
}
```

### 4.6 心跳

服务端每 30 秒发送 WebSocket ping frame，客户端需回复 pong。连续 3 次无 pong 则断开连接。

---

## 5. 安全与权限

### 5.1 角色模型

| 角色 | 权限 |
|---|---|
| `admin` | 完全访问：配置修改、审批决策、session 管理、用户管理 |
| `operator` | 操作访问：查看所有数据、执行审批决策、取消 session |
| `viewer` | 只读访问：查看 dashboard、session、trace、eval 数据 |

### 5.2 权限矩阵

| 操作 | admin | operator | viewer |
|---|---|---|---|
| 查看 Dashboard | ✓ | ✓ | ✓ |
| 浏览 Sessions | ✓ | ✓ | ✓ |
| 查看 Traces | ✓ | ✓ | ✓ |
| 查看 Eval Runs | ✓ | ✓ | ✓ |
| 审批决策 | ✓ | ✓ | ✗ |
| 取消 Session | ✓ | ✓ | ✗ |
| 修改 Agent Profile | ✓ | ✗ | ✗ |
| 管理策略模板 | ✓ | ✗ | ✗ |
| 修改预算配置 | ✓ | ✗ | ✗ |
| 管理 API Key | ✓ | ✗ | ✗ |

### 5.3 租户隔离

- 每个 API Key 绑定 `tenant_id` 和 `role`
- 控制台 UI 仅展示当前 tenant 的数据
- WebSocket 订阅自动按 tenant_id 过滤事件
- admin 角色可选择查看所有 tenant 的数据（super_admin 模式）

### 5.4 API Key 管理

控制台提供 API Key 管理界面（仅 admin）：

- 创建新 API Key（指定 tenant_id、role、过期时间）
- 列出当前 tenant 的所有 API Key
- 撤销 API Key
- 查看 API Key 使用统计

---

## 6. 新增后端 API

### 6.1 API 总表

| 方法 | 端点 | 描述 | 对应 FR |
|---|---|---|---|
| `GET` | `/v1/ws` | WebSocket 升级端点 | FR-50/51/54 |
| `GET` | `/v1/metrics/timeseries` | 时序指标聚合 | FR-50 |
| `GET` | `/v1/metrics/latency` | 延迟分位数 | FR-50 |
| `GET` | `/v1/agents` | Agent 列表 | FR-55 |
| `GET` | `/v1/agents/:id/profile` | Agent Profile 详情 | FR-55 |
| `PUT` | `/v1/agents/:id/profile` | 更新 Agent Profile | FR-55 |
| `GET` | `/v1/policies` | 策略模板列表 | FR-55 |
| `POST` | `/v1/policies` | 创建策略模板 | FR-55 |
| `PUT` | `/v1/policies/:id` | 更新策略模板 | FR-55 |
| `DELETE` | `/v1/policies/:id` | 删除策略模板 | FR-55 |
| `GET` | `/v1/audit-logs` | 审计日志查询 | FR-54 |
| `GET` | `/v1/api-keys` | API Key 列表 | FR-55 |
| `POST` | `/v1/api-keys` | 创建 API Key | FR-55 |
| `DELETE` | `/v1/api-keys/:id` | 撤销 API Key | FR-55 |

### 6.2 时序指标 API 详情

**`GET /v1/metrics/timeseries`**

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `metric` | string | 是 | 指标名称：`sessions_created` / `cycles_executed` / `errors` / `latency_avg` |
| `window` | string | 否 | 时间窗口，默认 `1h`，可选 `1h` / `6h` / `24h` / `7d` |
| `interval` | string | 否 | 聚合间隔，默认 `1m`，可选 `1m` / `5m` / `1h` |
| `agent_id` | string | 否 | 按 agent 筛选 |

响应示例：

```json
{
  "metric": "cycles_executed",
  "window": "1h",
  "interval": "1m",
  "data_points": [
    { "timestamp": "2026-03-31T14:00:00Z", "value": 42 },
    { "timestamp": "2026-03-31T14:01:00Z", "value": 38 }
  ]
}
```

**`GET /v1/metrics/latency`**

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `window` | string | 否 | 时间窗口，默认 `1h` |
| `agent_id` | string | 否 | 按 agent 筛选 |

响应示例：

```json
{
  "window": "1h",
  "percentiles": {
    "p50": 280,
    "p95": 850,
    "p99": 1420
  },
  "by_agent": [
    { "agent_id": "planner", "p50": 320, "p95": 900, "p99": 1500 },
    { "agent_id": "coder", "p50": 240, "p95": 780, "p99": 1200 }
  ]
}
```

### 6.3 审计日志 API 详情

**`GET /v1/audit-logs`**

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tenant_id` | string | 否 | 按租户筛选（已认证时自动绑定） |
| `action_type` | string | 否 | `approval_decision` / `config_update` / `session_cancel` / `key_create` / `key_revoke` |
| `from` | string | 否 | 起始时间 (ISO 8601) |
| `to` | string | 否 | 结束时间 (ISO 8601) |
| `limit` | number | 否 | 分页大小，默认 100 |
| `offset` | number | 否 | 分页偏移，默认 0 |

响应示例：

```json
{
  "logs": [
    {
      "log_id": "audit_001",
      "tenant_id": "acme",
      "user_id": "admin_01",
      "action_type": "approval_decision",
      "target_id": "appr_x01",
      "details": { "decision": "approved", "comment": "Looks safe" },
      "timestamp": "2026-03-31T14:25:00Z"
    }
  ],
  "total": 1
}
```

---

## 7. 包结构

新增 `packages/console` 包，作为 monorepo 的一部分：

```
packages/console/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── api/
    │   ├── client.ts
    │   ├── ws.ts
    │   └── types.ts
    ├── stores/
    │   ├── auth.ts
    │   ├── metrics.ts
    │   ├── sessions.ts
    │   ├── evals.ts
    │   └── approvals.ts
    ├── pages/
    │   ├── Dashboard.tsx
    │   ├── SessionList.tsx
    │   ├── SessionDetail.tsx
    │   ├── TraceViewer.tsx
    │   ├── EvalDashboard.tsx
    │   ├── EvalCompare.tsx
    │   ├── ApprovalQueue.tsx
    │   ├── ApprovalHistory.tsx
    │   ├── AgentConfig.tsx
    │   ├── PolicyTemplates.tsx
    │   └── ApiKeyManagement.tsx
    ├── components/
    │   ├── layout/
    │   │   ├── AppLayout.tsx
    │   │   ├── Sidebar.tsx
    │   │   └── Header.tsx
    │   ├── dashboard/
    │   │   ├── MetricCard.tsx
    │   │   ├── ThroughputChart.tsx
    │   │   ├── HealthStatus.tsx
    │   │   └── EventStream.tsx
    │   ├── session/
    │   │   ├── SessionTable.tsx
    │   │   ├── GoalTree.tsx
    │   │   ├── WorkingMemoryPanel.tsx
    │   │   └── SessionTimeline.tsx
    │   ├── trace/
    │   │   ├── CycleTimeline.tsx
    │   │   ├── PhaseBreakdown.tsx
    │   │   ├── CompetitionTable.tsx
    │   │   ├── PredictionComparison.tsx
    │   │   └── WorkspaceViewer.tsx
    │   ├── eval/
    │   │   ├── RunTable.tsx
    │   │   ├── TrendChart.tsx
    │   │   ├── CompareView.tsx
    │   │   └── RegressionAlert.tsx
    │   ├── approval/
    │   │   ├── ApprovalCard.tsx
    │   │   ├── ContextModal.tsx
    │   │   └── DecisionButtons.tsx
    │   └── config/
    │       ├── ProfileEditor.tsx
    │       ├── JsonEditor.tsx
    │       ├── PolicyCard.tsx
    │       └── BudgetForm.tsx
    └── hooks/
        ├── useWebSocket.ts
        ├── useMetrics.ts
        ├── usePolling.ts
        └── useAuth.ts
```

**package.json 关键依赖：**

```json
{
  "name": "@neurocore/console",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "zustand": "^5.0.0",
    "antd": "^5.0.0",
    "echarts": "^5.6.0",
    "echarts-for-react": "^3.0.0",
    "monaco-editor": "^0.50.0",
    "@monaco-editor/react": "^4.7.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

**runtime-server 扩展：**

在 `packages/runtime-server` 中新增以下模块：

| 文件 | 职责 |
|---|---|
| `src/ws-server.ts` | WebSocket 服务器，管理连接和频道订阅 |
| `src/metrics-store.ts` | 时序指标收集与聚合（环形缓冲区） |
| `src/audit-store.ts` | 审计日志存储（SPI 接口 + InMemory/Sqlite 实现） |
| `src/config-store.ts` | 配置存储（Agent Profile、Policy 模板的持久化） |
| `src/api-key-store.ts` | API Key 管理存储 |

---

## 8. 验收标准

### Milestone 11 整体验收

| 编号 | 验收项 | 对应 FR | 优先级 |
|---|---|---|---|
| AC-01 | Dashboard 页面加载后 5 秒内展示全部核心指标 | FR-50 | P0 |
| AC-02 | 指标数据每 5 秒自动刷新，与 `/v1/metrics` 数据一致 | FR-50 | P0 |
| AC-03 | Session 列表支持按 state/tenant/agent 筛选，分页正确 | FR-51 | P0 |
| AC-04 | Session 详情页展示 goal tree、budget state、working memory | FR-51 | P0 |
| AC-05 | 运行中 session 的事件通过 WebSocket 实时推送到 UI | FR-51 | P0 |
| AC-06 | Trace 时间线正确展示所有 cycle 及各阶段耗时 | FR-52 | P0 |
| AC-07 | Cycle 钻取展示 proposal 竞争过程和 prediction error | FR-52 | P0 |
| AC-08 | Eval run 列表展示 pass/fail 率，支持两个 run 的对比 | FR-53 | P1 |
| AC-09 | Eval 趋势图正确反映 pass 率变化，回归时显示告警 | FR-53 | P1 |
| AC-10 | 审批队列实时展示待审批项，支持一键 approve/reject | FR-54 | P1 |
| AC-11 | 审批操作生成 audit log 并可在历史页面查询 | FR-54 | P1 |
| AC-12 | Agent Profile 编辑器支持表单和 JSON 双模式，保存后生效 | FR-55 | P2 |
| AC-13 | 策略模板支持 CRUD 操作 | FR-55 | P2 |
| AC-14 | 预算配置修改后立即生效于后续 cycle | FR-55 | P2 |
| AC-15 | 所有页面严格按 tenant_id 隔离数据 | 全局 | P0 |
| AC-16 | RBAC 权限控制正确（viewer 不可执行写操作） | 全局 | P0 |

### 测试要求

| 测试类型 | 覆盖范围 |
|---|---|
| 单元测试 | API client、store logic、数据转换函数 |
| 组件测试 | 核心 UI 组件渲染和交互 |
| 集成测试 | 前端 ↔ runtime-server API 端到端验证 |
| E2E 测试 | 关键用户流程（查看 dashboard → 点击 session → 查看 trace） |

---

## 9. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| 时序指标存储内存膨胀 | 长时间运行后 runtime-server OOM | 中 | 使用固定大小环形缓冲区（默认保留最近 24h 数据），支持外部时序数据库（Prometheus）导出 |
| WebSocket 连接数过多 | 服务端资源耗尽 | 低 | 设置每 tenant 最大连接数限制（默认 10），超限拒绝新连接 |
| Agent Profile 热更新副作用 | 修改配置导致运行中 session 行为异常 | 中 | 配置修改仅对新创建的 session 生效，运行中 session 使用启动时的配置快照 |
| 前端包体积过大 | 首屏加载慢 | 中 | 按路由拆分代码（lazy loading），Monaco Editor 异步加载 |
| SSE 到 WebSocket 迁移兼容性 | 现有 SSE 客户端断裂 | 低 | 保留现有 SSE 端点不变，WebSocket 作为新增通道并行存在 |
| 多租户数据泄露 | 安全事故 | 低 | API 层强制 tenant_id 过滤，WebSocket 订阅时校验 tenant 权限，前端不缓存跨 tenant 数据 |
| 审计日志存储持续增长 | 磁盘空间不足 | 中 | 默认保留 90 天审计日志，提供自动清理策略配置 |
