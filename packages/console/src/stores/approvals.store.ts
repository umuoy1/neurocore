import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { ApprovalRequest, AuditLogEntry } from "../api/types";

export interface ApprovalListItem {
  approval: ApprovalRequest;
  session_id: string;
  agent_id: string;
}

interface ApprovalsState {
  pending: ApprovalListItem[];
  history: ApprovalListItem[];
  audit: AuditLogEntry[];
  loading: boolean;
  fetchPending: () => Promise<void>;
  fetchHistory: (status?: string) => Promise<void>;
  fetchAudit: () => Promise<void>;
  decide: (approvalId: string, decision: "approved" | "rejected", approverId: string, comment?: string) => Promise<void>;
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  pending: [],
  history: [],
  audit: [],
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

  fetchAudit: async () => {
    const [approved, rejected] = await Promise.all([
      apiFetch<{ entries: AuditLogEntry[] }>("/v1/audit-logs?action=approval.approved&limit=100").catch(() => ({ entries: [] })),
      apiFetch<{ entries: AuditLogEntry[] }>("/v1/audit-logs?action=approval.rejected&limit=100").catch(() => ({ entries: [] }))
    ]);
    const audit = [...approved.entries, ...rejected.entries].sort((left, right) =>
      Date.parse(right.created_at) - Date.parse(left.created_at)
    );
    set({ audit });
  },

  decide: async (approvalId, decision, approverId, comment) => {
    await apiFetch(`/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ approver_id: approverId, decision, comment }),
    });
    set({ pending: get().pending.filter((a) => a.approval.approval_id !== approvalId) });
  },
}));
