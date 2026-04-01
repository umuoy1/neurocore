import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionListPage } from "./pages/SessionListPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { TraceViewerPage } from "./pages/TraceViewerPage";
import { GoalTreePage } from "./pages/GoalTreePage";
import { MemoryInspectorPage } from "./pages/MemoryInspectorPage";
import { WorkspaceInspectorPage } from "./pages/WorkspaceInspectorPage";
import { MultiAgentDashboardPage } from "./pages/MultiAgentDashboardPage";
import { WorldModelViewerPage } from "./pages/WorldModelViewerPage";
import { DevicePanelPage } from "./pages/DevicePanelPage";
import { EvalDashboardPage } from "./pages/EvalDashboardPage";
import { EvalComparePage } from "./pages/EvalComparePage";
import { ApprovalCenterPage } from "./pages/ApprovalCenterPage";
import { ConfigEditorPage } from "./pages/ConfigEditorPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionListPage />} />
          <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          <Route path="/sessions/:sessionId/traces" element={<TraceViewerPage />} />
          <Route path="/sessions/:sessionId/goals" element={<GoalTreePage />} />
          <Route path="/sessions/:sessionId/memory" element={<MemoryInspectorPage />} />
          <Route path="/sessions/:sessionId/workspace/:cycleId" element={<WorkspaceInspectorPage />} />
          <Route path="/agents" element={<MultiAgentDashboardPage />} />
          <Route path="/world" element={<WorldModelViewerPage />} />
          <Route path="/devices" element={<DevicePanelPage />} />
          <Route path="/evals" element={<EvalDashboardPage />} />
          <Route path="/evals/compare" element={<EvalComparePage />} />
          <Route path="/approvals" element={<ApprovalCenterPage />} />
          <Route path="/config" element={<ConfigEditorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
