import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { ApprovalRequest } from "../api/types";

export interface ApprovalListItem {
  approval: ApprovalRequest;
  session_id: string;
  agent_id: string;
}

interface ApprovalsState {
  pending: ApprovalListItem[];
  history: ApprovalListItem[];
  loading: boolean;
  fetchPending: () => Promise<void>;
  fetchHistory: (status?: string) => Promise<void>;
  decide: (approvalId: string, decision: "approved" | "rejected", approverId: string, comment?: string) => Promise<void>;
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  pending: [],
  history: [],
  loading: false,

  fetchPending: async () => {
    set({ loading: true });
    try {
      const res = await apiFetch<{ approvals: ApprovalListItem[] }>("/v1/approvals?status=pending");
      set({ pending: res.approvals });
    } finally { set({ loading: false }); }
  },

  fetchHistory: async (status) => {
    const q = status ? `?status=${status}` : "";
    const res = await apiFetch<{ approvals: ApprovalListItem[] }>(`/v1/approvals${q}`);
    set({ history: res.approvals });
  },

  decide: async (approvalId, decision, approverId, comment) => {
    await apiFetch(`/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ approver_id: approverId, decision, comment }),
    });
    set({ pending: get().pending.filter((a) => a.approval.approval_id !== approvalId) });
  },
}));
