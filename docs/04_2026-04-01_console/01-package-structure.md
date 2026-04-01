# 包结构

## 位置

`packages/console` — monorepo 内独立子包，不 import 任何 `@neurocore/*` 包。

## 目录布局

```
packages/console/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  public/
    favicon.svg
  src/
    main.tsx
    App.tsx
    api/
      client.ts                 # REST fetch 封装（auth、重试、错误处理）
      ws-client.ts              # WebSocket 管理器（连接、订阅、心跳、重连）
      types.ts                  # 从 protocol 规格本地重建的类型声明
    stores/
      auth.store.ts
      metrics.store.ts
      sessions.store.ts
      traces.store.ts
      goals.store.ts
      memory.store.ts
      workspace.store.ts
      multi-agent.store.ts
      world-model.store.ts
      devices.store.ts
      evals.store.ts
      approvals.store.ts
      config.store.ts
    pages/
      DashboardPage.tsx
      SessionListPage.tsx
      SessionDetailPage.tsx
      TraceViewerPage.tsx
      GoalTreePage.tsx
      MemoryInspectorPage.tsx
      WorkspaceInspectorPage.tsx
      MultiAgentDashboardPage.tsx
      WorldModelViewerPage.tsx
      DevicePanelPage.tsx
      EvalDashboardPage.tsx
      EvalComparePage.tsx
      ApprovalCenterPage.tsx
      ConfigEditorPage.tsx
    components/
      layout/
        AppLayout.tsx           # Sidebar + Header + Content
        Sidebar.tsx
        Header.tsx
        BreadcrumbNav.tsx
      dashboard/
        MetricCard.tsx
        ThroughputChart.tsx
        LatencyChart.tsx
        HealthPanel.tsx
        LiveEventFeed.tsx
        SessionDistributionChart.tsx
      session/
        SessionTable.tsx
        SessionFilters.tsx
        SessionInfoPanel.tsx
        SessionTimeline.tsx
        SessionEventStream.tsx
        BudgetGauge.tsx
        PolicyBadge.tsx
      trace/
        CycleTimeline.tsx
        PhaseBarChart.tsx
        ProposalCompetitionTable.tsx
        PredictionComparison.tsx
        PredictionErrorBadge.tsx
        ActionDetailPanel.tsx
        ObservationPanel.tsx
      goal/
        GoalTreeGraph.tsx
        GoalNode.tsx
        GoalDetailPanel.tsx
      memory/
        MemoryLayerTabs.tsx
        MemoryEntryCard.tsx
        MemorySearchBar.tsx
        EpisodicTimeline.tsx
        SemanticClusterView.tsx
        SkillCard.tsx
      workspace/
        WorkspaceSnapshotViewer.tsx
        CompetitionLogTable.tsx
        RiskConfidenceGauge.tsx
        CandidateActionsList.tsx
        ContextSummary.tsx
      multi-agent/
        AgentRegistryTable.tsx
        AgentStatusCard.tsx
        DelegationTimeline.tsx
        CoordinationView.tsx
        AuctionPanel.tsx
        HeartbeatMonitor.tsx
      world-model/
        EntityRelationGraph.tsx
        EntityDetailPanel.tsx
        RelationDetailPanel.tsx
        ConflictList.tsx
        WorldStateQueryBar.tsx
      device/
        DeviceGrid.tsx
        DeviceCard.tsx
        SensorReadingChart.tsx
        ActuatorCommandLog.tsx
        PerceptionPanel.tsx
      eval/
        EvalRunTable.tsx
        EvalTrendChart.tsx
        EvalCompareSideBySide.tsx
        RegressionAlert.tsx
        CaseResultDetail.tsx
      approval/
        ApprovalQueue.tsx
        ApprovalCard.tsx
        ApprovalContextModal.tsx
        ApprovalHistoryTable.tsx
        AuditLogTable.tsx
        DecisionButtons.tsx
      config/
        ProfileEditor.tsx
        JsonEditor.tsx
        PolicyTemplateList.tsx
        BudgetConfigForm.tsx
        ToolPermissionEditor.tsx
        ApiKeyManagement.tsx
        ConfigTabs.tsx
      shared/
        StatusBadge.tsx
        RelativeTime.tsx
        JsonViewer.tsx
        CopyButton.tsx
        EmptyState.tsx
        ErrorBoundary.tsx
        LoadingSkeleton.tsx
        SearchInput.tsx
        PaginationControls.tsx
        ConnectionIndicator.tsx
    hooks/
      useWebSocket.ts
      useSubscription.ts
      usePolling.ts
      useAuth.ts
      useSearchParams.ts
    utils/
      formatters.ts
      colors.ts
      constants.ts
```

## package.json

```json
{
  "name": "@neurocore/console",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "zustand": "^5.0.0",
    "recharts": "^2.15.0",
    "@monaco-editor/react": "^4.7.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

## 构建配置

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
```

开发时通过 Vite proxy 将 `/v1` 请求转发到 runtime-server，避免 CORS 问题。

## 类型重建策略

`src/api/types.ts` 从 `packages/protocol/src/types.ts` 和 `packages/protocol/src/events.ts` **逐字重建**所有 UI 需要的类型接口。不使用 `import type` 引用 protocol 包，确保 console 完全独立编译。

类型更新时需手动同步，但 console 的编译不依赖其他包的构建产物。

## 路由定义

```
/                                → Redirect /dashboard
/dashboard                       → DashboardPage
/sessions                        → SessionListPage
/sessions/:sessionId             → SessionDetailPage
/sessions/:sessionId/traces      → TraceViewerPage
/sessions/:sessionId/goals       → GoalTreePage
/sessions/:sessionId/memory      → MemoryInspectorPage
/sessions/:sessionId/workspace/:cycleId → WorkspaceInspectorPage
/agents                          → MultiAgentDashboardPage
/agents/:agentId                 → MultiAgentDashboardPage (filtered)
/world                           → WorldModelViewerPage
/devices                         → DevicePanelPage
/evals                           → EvalDashboardPage
/evals/compare                   → EvalComparePage
/approvals                       → ApprovalCenterPage
/config                          → ConfigEditorPage
/config/agents/:agentId          → ConfigEditorPage (profile tab)
/config/policies                 → ConfigEditorPage (policy tab)
/config/keys                     → ConfigEditorPage (key tab)
```

所有页面通过 React Router v7 `lazy()` 实现代码分割。
