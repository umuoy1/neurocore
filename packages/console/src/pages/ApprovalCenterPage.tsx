import { useEffect, useState } from "react";
import { useApprovalsStore } from "../stores/approvals.store";
import type { ApprovalListItem } from "../stores/approvals.store";

export function ApprovalCenterPage() {
  const { pending, history, audit, fetchPending, fetchHistory, fetchAudit, decide } = useApprovalsStore();
  const [tab, setTab] = useState<"queue" | "history" | "audit">("queue");
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});
  const [approverId] = useState(() => `user_${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    fetchPending();
    fetchHistory();
    fetchAudit();
    const id = setInterval(() => { fetchPending(); }, 10000);
    return () => clearInterval(id);
  }, []);

  const handleDecision = async (id: string, decision: "approved" | "rejected") => {
    await decide(id, decision, approverId, commentMap[id]);
    setCommentMap((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const items = tab === "queue" ? pending : history;

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-zinc-200">Approval Center</h2>

      <div className="flex gap-1">
        {(["queue", "history", "audit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "history") fetchHistory();
              if (t === "audit") fetchAudit();
            }}
            className={`px-3 py-1.5 rounded text-xs capitalize ${tab === t ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {t === "queue" ? `Queue (${pending.length})` : t}
          </button>
        ))}
      </div>

      {tab === "audit" ? (
        <AuditLogView audit={audit} />
      ) : (
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="text-zinc-600 text-xs py-8 text-center">
              {tab === "queue" ? "No pending approvals" : "No history"}
            </div>
          ) : items.map((item) => (
            <ApprovalCard
              key={item.approval.approval_id}
              item={item}
              isQueue={tab === "queue"}
              comment={commentMap[item.approval.approval_id] ?? ""}
              onCommentChange={(c) => setCommentMap((prev) => ({ ...prev, [item.approval.approval_id]: c }))}
              onDecision={handleDecision}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ item, isQueue, comment, onCommentChange, onDecision }: {
  item: ApprovalListItem;
  isQueue: boolean;
  comment: string;
  onCommentChange: (c: string) => void;
  onDecision: (id: string, d: "approved" | "rejected") => void;
}) {
  const ap = item.approval;
  const seColor = ap.action.side_effect_level === "none" ? "text-emerald-400"
    : ap.action.side_effect_level === "low" ? "text-blue-400"
    : ap.action.side_effect_level === "medium" ? "text-amber-400"
    : "text-red-400";

  return (
    <div className={`rounded-lg border bg-zinc-900 p-4 ${ap.status === "pending" ? "border-amber-500/30" : "border-zinc-800"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            ap.status === "pending" ? "bg-amber-500/10 text-amber-400" :
            ap.status === "approved" ? "bg-emerald-500/10 text-emerald-400" :
            "bg-red-500/10 text-red-400"
          }`}>{ap.status}</span>
          <span className="text-xs text-zinc-300">{ap.action.action_type}</span>
          <span className={`text-[10px] ${seColor}`}>{ap.action.side_effect_level}</span>
        </div>
        <span className="text-[10px] text-zinc-500">{new Date(ap.requested_at).toLocaleString()}</span>
      </div>

      <div className="text-xs text-zinc-300 mb-1">{ap.action.title}</div>
      {ap.action.description && <div className="text-[11px] text-zinc-500 mb-2">{ap.action.description}</div>}

      <div className="flex items-center gap-4 text-[10px] text-zinc-500">
        <span>Session: {ap.session_id.slice(0, 10)}</span>
        <span>Cycle: {ap.cycle_id.slice(0, 10)}</span>
        <span>Action: {ap.action_id.slice(0, 10)}</span>
      </div>

      {ap.review_reason && (
        <div className="mt-2 text-[11px] text-zinc-400 border-t border-zinc-800 pt-2">
          Reason: {ap.review_reason}
        </div>
      )}

      {isQueue && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="Comment (optional)..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600"
          />
          <button
            onClick={() => onDecision(ap.approval_id, "approved")}
            className="px-3 py-1 rounded text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
          >
            Approve
          </button>
          <button
            onClick={() => onDecision(ap.approval_id, "rejected")}
            className="px-3 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function AuditLogView({ audit }: { audit: Array<{ entry_id: string; action: string; user_id: string; target_id: string; timestamp: string }> }) {
  if (audit.length === 0) {
    return <div className="text-zinc-600 text-xs py-8 text-center">No approval audit records</div>;
  }
  return (
    <div className="space-y-2">
      {audit.map((entry) => (
        <div key={entry.entry_id} className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-300">{entry.action}</span>
            <span className="text-zinc-500">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <div className="mt-1 text-zinc-500">
            {entry.user_id} · {entry.target_id}
          </div>
        </div>
      ))}
    </div>
  );
}
