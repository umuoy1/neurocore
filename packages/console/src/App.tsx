import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { useEffect, useState } from "react";
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
import { PersonalAssistantGovernancePage } from "./pages/PersonalAssistantGovernancePage";
import { PersonalAssistantPrivacyPage } from "./pages/PersonalAssistantPrivacyPage";
import { initAuth, useAuthStore } from "./stores/auth.store";

export function App() {
  const [apiKey, setApiKey] = useState("");
  const { isAuthenticated, initializing, login } = useAuthStore();

  useEffect(() => {
    initAuth();
  }, []);

  if (initializing) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">Loading console...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <form
          className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6"
          onSubmit={async (event) => {
            event.preventDefault();
            await login(apiKey.trim());
          }}
        >
          <div className="mb-4">
            <h1 className="text-lg font-semibold text-zinc-100">NeuroCore Console</h1>
            <p className="mt-1 text-xs text-zinc-500">Enter an API key with console access.</p>
          </div>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="nc_..."
            className="mb-3 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            type="submit"
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={!apiKey.trim()}
          >
            Sign In
          </button>
        </form>
      </div>
    );
  }

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
          <Route path="/personal-assistant/governance" element={<PersonalAssistantGovernancePage />} />
          <Route path="/personal-assistant/privacy" element={<PersonalAssistantPrivacyPage />} />
          <Route path="/config" element={<ConfigEditorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
