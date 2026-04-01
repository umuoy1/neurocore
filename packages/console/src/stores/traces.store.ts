import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { CycleTraceRecord, WorkspaceSnapshot } from "../api/types";

interface TracesState {
  traces: CycleTraceRecord[];
  selectedCycleId: string | null;
  selectedCycle: CycleTraceRecord | null;
  workspace: WorkspaceSnapshot | null;
  loading: boolean;
  fetchTraces: (sessionId: string) => Promise<void>;
  fetchWorkspace: (sessionId: string, cycleId: string) => Promise<void>;
  selectCycle: (cycleId: string) => void;
}

export const useTracesStore = create<TracesState>((set, get) => ({
  traces: [],
  selectedCycleId: null,
  selectedCycle: null,
  workspace: null,
  loading: false,

  fetchTraces: async (sessionId) => {
    set({ loading: true });
    try {
      const res = await apiFetch<{ traces: CycleTraceRecord[] }>(`/v1/sessions/${sessionId}/traces`);
      set({ traces: res.traces });
      if (res.traces.length > 0 && !get().selectedCycleId) {
        const last = res.traces.at(-1)!;
        set({ selectedCycleId: last.trace.cycle_id, selectedCycle: last });
      }
    } finally {
      set({ loading: false });
    }
  },

  fetchWorkspace: async (sessionId, cycleId) => {
    try {
      const res = await apiFetch<{ workspace: WorkspaceSnapshot }>(`/v1/sessions/${sessionId}/workspace/${cycleId}`);
      set({ workspace: res.workspace });
    } catch {
      set({ workspace: null });
    }
  },

  selectCycle: (cycleId) => {
    const { traces } = get();
    const cycle = traces.find((t) => t.trace.cycle_id === cycleId) ?? null;
    set({ selectedCycleId: cycleId, selectedCycle: cycle, workspace: cycle?.workspace ?? null });
  },
}));
