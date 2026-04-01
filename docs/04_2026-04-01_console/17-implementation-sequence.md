# 实施分期

## 分期原则

按 P0 → P1 → P2 优先级推进，每个阶段产出可验证的增量。

---

## Phase 1: 后端基础（P0）

**目标**：Console 运行所需的最小后端能力。

### 1.1 WebSocket Server

- **文件**：`packages/runtime-server/src/ws-server.ts`
- **内容**：连接管理、subscribe/unsubscribe、心跳、事件扇出、命令处理
- **依赖**：现有 HTTP server、Authenticator、EventBus
- **验收**：WS 连接建立、订阅/推送/取消、ping/pong 正常工作

### 1.2 MetricsStore

- **文件**：`packages/runtime-server/src/metrics-store.ts`
- **内容**：InMemory 环形缓冲、record/query/percentiles/getSnapshot
- **集成**：在 session 创建、cycle 完成、error 时记录指标
- **验收**：`GET /v1/metrics/timeseries` 和 `GET /v1/metrics/latency` 返回合理数据

### 1.3 基础新端点

- `GET /v1/metrics/timeseries`
- `GET /v1/metrics/latency`
- `GET /v1/agents`（从现有 agents Map 提取）
- `GET /v1/agents/:id/profile`

**预计改动**：
- 修改 `runtime-server.ts`：构造函数新增 store、路由扩展
- 新增 3 个文件
- 约 400-600 行

---

## Phase 2: 核心 UI（P0）

**目标**：可运行的 Console SPA，覆盖 Dashboard + Session + Trace。

### 2.1 包脚手架

- `packages/console/` 初始化（Vite + React 19 + Tailwind + Zustand）
- `src/api/client.ts` — REST fetch 封装
- `src/api/ws-client.ts` — WebSocket 管理器
- `src/api/types.ts` — 从 protocol 重建类型
- `src/components/layout/` — AppLayout, Sidebar, Header
- 路由配置

### 2.2 Auth Store + 登录

- `stores/auth.store.ts`
- 登录页（API Key 输入 → `GET /healthz` 验证）

### 2.3 Dashboard 页面（FR-50）

- `stores/metrics.store.ts`
- `pages/DashboardPage.tsx`
- 组件：MetricCard ×5, ThroughputChart, LatencyChart, HealthPanel, LiveEventFeed, SessionDistributionChart
- WS 订阅 `metrics` 和 `events` 通道

### 2.4 Session 列表页（FR-51 前半）

- `stores/sessions.store.ts`
- `pages/SessionListPage.tsx`
- 组件：SessionTable, SessionFilters, PaginationControls
- WS 实时更新

### 2.5 Session 详情页（FR-51 后半）

- `pages/SessionDetailPage.tsx`
- 组件：SessionInfoPanel, BudgetGauge, PolicyBadge, SessionEventStream
- WS 订阅 `session:{id}` 通道

### 2.6 Trace 查看器（FR-52）

- `stores/traces.store.ts`
- `pages/TraceViewerPage.tsx`
- 组件：CycleTimeline, PhaseBarChart, ProposalCompetitionTable, PredictionComparison, ActionDetailPanel, ObservationPanel

**预计改动**：
- 新增 `packages/console/`（~60 个文件，~3000 行）
- 无现有代码修改

---

## Phase 3: 高级视图（P1）

**目标**：覆盖 Goal、Memory、Workspace、Eval、Approval。

### 3.1 Goal Tree 可视化

- `stores/goals.store.ts`
- `pages/GoalTreePage.tsx`
- 组件：GoalTreeGraph, GoalNode, GoalDetailPanel

### 3.2 Memory 检查器

- `stores/memory.store.ts`
- `pages/MemoryInspectorPage.tsx`
- 组件：MemoryLayerTabs, MemoryEntryCard, EpisodicTimeline, SemanticClusterView, SkillCard
- 新端点：`GET /v1/sessions/:id/memory/semantic`, `GET /v1/sessions/:id/skills`

### 3.3 Workspace 检查器

- `stores/workspace.store.ts`
- `pages/WorkspaceInspectorPage.tsx`
- 组件：WorkspaceSnapshotViewer, CompetitionLogTable, RiskConfidenceGauge, CandidateActionsList

### 3.4 Eval 面板（FR-53）

- `stores/evals.store.ts`
- `pages/EvalDashboardPage.tsx` + `EvalComparePage.tsx`
- 组件：EvalRunTable, EvalTrendChart, EvalCompareSideBySide, RegressionAlert, CaseResultDetail

### 3.5 审批中心（FR-54）

- `stores/approvals.store.ts`
- 新后端：`AuditStore`, `audit-store.ts`
- 新端点：`GET /v1/audit-logs`, `GET /v1/approvals/:id/context`
- `pages/ApprovalCenterPage.tsx`
- 组件：ApprovalQueue, ApprovalCard, ApprovalContextModal, ApprovalHistoryTable, AuditLogTable, DecisionButtons

**预计改动**：
- Console 新增 ~20 个文件，~2000 行
- 后端新增 `audit-store.ts`，~200 行

---

## Phase 4: 扩展能力（P2）

**目标**：Multi-Agent、World Model、Device、Config 全覆盖。

### 4.1 Multi-Agent Dashboard

- `stores/multi-agent.store.ts`
- `pages/MultiAgentDashboardPage.tsx`
- 新端点：`GET /v1/agents-registry`, `GET /v1/delegations`
- 组件：AgentRegistryTable, DelegationTimeline, CoordinationView, AuctionPanel, HeartbeatMonitor

### 4.2 World Model Viewer

- `stores/world-model.store.ts`
- `pages/WorldModelViewerPage.tsx`
- 新端点：`GET /v1/sessions/:id/world-state`
- 组件：EntityRelationGraph, EntityDetailPanel, ConflictList, WorldStateQueryBar

### 4.3 Device Panel

- `stores/devices.store.ts`
- `pages/DevicePanelPage.tsx`
- 新端点：`GET /v1/devices`, `GET /v1/devices/:id/readings`, `GET /v1/devices/:id/commands`
- 组件：DeviceGrid, DeviceCard, SensorReadingChart, ActuatorCommandLog

### 4.4 配置编辑器（FR-55）

- `stores/config.store.ts`
- 新后端：`ConfigStore`, `config-store.ts`
- 新端点：profile CRUD, policies CRUD, api-keys CRUD
- `pages/ConfigEditorPage.tsx`
- 组件：ProfileEditor, JsonEditor, PolicyTemplateList, BudgetConfigForm, ToolPermissionEditor, ApiKeyManagement

**预计改动**：
- Console 新增 ~15 个文件，~1500 行
- 后端新增 `config-store.ts`，~300 行

---

## 依赖关系

```
Phase 1 (Backend)
  │
  ├── Phase 2 (Core UI) ←── 依赖 Phase 1 的 WS + MetricsStore
  │     │
  │     └── Phase 3 (Advanced) ←── 依赖 Phase 2 的 stores 和组件
  │           │
  │           └── Phase 4 (Extended) ←── 依赖 Phase 3 的模式
  │
  └── (Phase 4 的后端扩展可提前做)
```

## 测试策略

### 后端测试

- `ws-server.ts`：WS 连接/订阅/推送/心跳 单元测试
- `metrics-store.ts`：record/query/percentiles 单元测试
- `audit-store.ts`：record/query 单元测试
- `config-store.ts`：CRUD 单元测试
- 新 REST 端点：集成测试（启动 server + HTTP 请求）

### 前端测试

- 不在 MVP scope 内
- 可选：Vitest + React Testing Library 关键组件测试
- E2E：Playwright 可选

## 风险

| 风险 | 缓解措施 |
|---|---|
| WebSocket 与现有 SSE 冲突 | SSE 保持不变，WS 是并行新增 |
| MetricsStore 内存占用 | 环形缓冲 + TTL，默认 24h |
| 类型同步 | `api/types.ts` 与 protocol 手动同步，CI 可加 diff 检测 |
| Monaco Editor 包体积 | Lazy load，仅 Config 页面加载 |
