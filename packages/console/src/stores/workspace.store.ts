import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { WorkspaceSnapshot } from "../api/types";

interface WorkspaceState {
  snapshot: WorkspaceSnapshot | null;
  selectedProposalId: string | null;
  loading: boolean;
  fetchWorkspace: (sessionId: string, cycleId: string) => Promise<void>;
  selectProposal: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  snapshot: null,
  selectedProposalId: null,
  loading: false,

  fetchWorkspace: async (sessionId, cycleId) => {
    set({ loading: true });
    try {
      const res = await apiFetch<{ workspace: WorkspaceSnapshot }>(`/v1/sessions/${sessionId}/workspace/${cycleId}`);
      set({ snapshot: res.workspace });
    } catch { set({ snapshot: null }); }
    finally { set({ loading: false }); }
  },

  selectProposal: (id) => set({ selectedProposalId: id }),
}));
