import { useEffect, useState, type ReactNode } from "react";
import { usePersonalAssistantGovernanceStore } from "../stores/personalAssistantGovernance.store";
import type {
  PersonalAssistantGovernanceApproval,
  PersonalAssistantGovernanceBackgroundTask,
  PersonalAssistantGovernanceChildAgent,
  PersonalAssistantGovernanceSchedule,
  PersonalAssistantGovernanceSnapshot
} from "../api/types";

export function PersonalAssistantGovernancePage() {
  const {
    snapshot,
    loading,
    error,
    load,
    approveApproval,
    rejectApproval,
    pauseSchedule,
    resumeSchedule,
    cancelBackgroundTask,
    pauseChildAgent,
    resumeChildAgent,
    cancelChildAgent
  } = usePersonalAssistantGovernanceStore();
  const [actorId] = useState(() => `console_${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    load();
    const interval = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Assistant Governance</h2>
          <p className="mt-1 text-xs text-zinc-500">Unified PersonalOps view for sessions, tasks, cron, approvals and subagents.</p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && !snapshot ? (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-8 text-center text-xs text-zinc-600">Loading governance snapshot...</div>
      ) : snapshot ? (
        <GovernanceSnapshotView
          snapshot={snapshot}
          actorId={actorId}
          onApprove={approveApproval}
          onReject={rejectApproval}
          onPauseSchedule={pauseSchedule}
          onResumeSchedule={resumeSchedule}
          onCancelTask={cancelBackgroundTask}
          onPauseChild={pauseChildAgent}
          onResumeChild={resumeChildAgent}
          onCancelChild={cancelChildAgent}
        />
      ) : (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-8 text-center text-xs text-zinc-600">No governance snapshot available</div>
      )}
    </div>
  );
}

function GovernanceSnapshotView({
  snapshot,
  actorId,
  onApprove,
  onReject,
  onPauseSchedule,
  onResumeSchedule,
  onCancelTask,
  onPauseChild,
  onResumeChild,
  onCancelChild
}: {
  snapshot: PersonalAssistantGovernanceSnapshot;
  actorId: string;
  onApprove: (approvalId: string, actorId: string) => Promise<void>;
  onReject: (approvalId: string, actorId: string) => Promise<void>;
  onPauseSchedule: (scheduleId: string, actorId: string) => Promise<void>;
  onResumeSchedule: (scheduleId: string, actorId: string) => Promise<void>;
  onCancelTask: (taskId: string, actorId: string) => Promise<void>;
  onPauseChild: (childAgentId: string, actorId: string) => Promise<void>;
  onResumeChild: (childAgentId: string, actorId: string) => Promise<void>;
  onCancelChild: (childAgentId: string, actorId: string) => Promise<void>;
}) {
  const summaryCards = [
    ["Sessions", snapshot.summary.active_sessions, snapshot.summary.total_sessions],
    ["Tasks", snapshot.summary.running_background_tasks, snapshot.background_tasks.length],
    ["Approvals", snapshot.summary.pending_approvals, snapshot.approvals.length],
    ["Schedules", snapshot.summary.active_schedules, snapshot.schedules.length],
    ["Subagents", snapshot.summary.active_child_agents, snapshot.child_agents.length],
    ["Audit", snapshot.summary.audit_records, snapshot.summary.audit_records]
  ] as const;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map(([label, primary, total]) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-zinc-100">{primary}</div>
            <div className="mt-1 text-[11px] text-zinc-600">of {total}</div>
          </div>
        ))}
      </div>

      <Section title="Sessions">
        <div className="grid gap-3 xl:grid-cols-2">
          {snapshot.sessions.map((session) => (
            <div key={session.session_id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-zinc-300">{session.session_id}</div>
                <StatusPill status={session.state} />
              </div>
              <div className="mt-2 grid gap-2 text-zinc-500 md:grid-cols-3">
                <span>Agent: {session.agent_id}</span>
                <span>User: {session.user_id ?? "-"}</span>
                <span>Updated: {formatDate(session.updated_at)}</span>
              </div>
              {session.route && (
                <div className="mt-2 text-[11px] text-zinc-600">
                  Route: {session.route.platform ?? "-"} / {session.route.chat_id ?? "-"} / {session.route.profile_id ?? "-"}
                </div>
              )}
            </div>
          ))}
          {snapshot.sessions.length === 0 && <EmptyState label="No sessions" />}
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Background Tasks">
          <div className="space-y-2">
            {snapshot.background_tasks.map((task) => (
              <TaskCard
                key={task.task_id}
                task={task}
                onCancel={() => void onCancelTask(task.task_id, actorId)}
              />
            ))}
            {snapshot.background_tasks.length === 0 && <EmptyState label="No background tasks" />}
          </div>
        </Section>

        <Section title="Approvals">
          <div className="space-y-2">
            {snapshot.approvals.map((approval) => (
              <ApprovalCard
                key={approval.approval_id}
                approval={approval}
                onApprove={() => void onApprove(approval.approval_id, actorId)}
                onReject={() => void onReject(approval.approval_id, actorId)}
              />
            ))}
            {snapshot.approvals.length === 0 && <EmptyState label="No approvals" />}
          </div>
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Schedules">
          <div className="space-y-2">
            {snapshot.schedules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                onPause={() => void onPauseSchedule(schedule.id, actorId)}
                onResume={() => void onResumeSchedule(schedule.id, actorId)}
              />
            ))}
            {snapshot.schedules.length === 0 && <EmptyState label="No schedules" />}
          </div>
        </Section>

        <Section title="Child Agents">
          <div className="space-y-2">
            {snapshot.child_agents.map((childAgent) => (
              <ChildAgentCard
                key={childAgent.child_agent_id}
                childAgent={childAgent}
                onPause={() => void onPauseChild(childAgent.child_agent_id, actorId)}
                onResume={() => void onResumeChild(childAgent.child_agent_id, actorId)}
                onCancel={() => void onCancelChild(childAgent.child_agent_id, actorId)}
              />
            ))}
            {snapshot.child_agents.length === 0 && <EmptyState label="No child agents" />}
          </div>
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Memory And Tools">
          <div className="space-y-2">
            {snapshot.memories.slice(0, 8).map((memory) => (
              <div key={memory.memory_id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-300">{memory.subject}</span>
                  <StatusPill status={memory.lifecycle} />
                </div>
                <div className="mt-1 text-zinc-500">{memory.claim}</div>
              </div>
            ))}
            {snapshot.tool_actions.slice(0, 8).map((tool) => (
              <div key={tool.tool_action_id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-300">{tool.tool_name}</span>
                  <StatusPill status={tool.status} />
                </div>
                <div className="mt-1 text-zinc-500">
                  {tool.session_id ?? tool.task_id ?? "-"} · {formatDate(tool.updated_at)}
                </div>
              </div>
            ))}
            {snapshot.memories.length === 0 && snapshot.tool_actions.length === 0 && <EmptyState label="No memory or tool records" />}
          </div>
        </Section>

        <Section title="Audit Trace">
          <div className="space-y-2">
            {snapshot.audit_records.slice(0, 20).map((record) => (
              <div key={record.audit_id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-300">{record.action}</span>
                  <span className="text-zinc-500">{formatDate(record.created_at)}</span>
                </div>
                <div className="mt-1 text-zinc-500">
                  {record.actor_id} · {record.target_type} · {record.target_id}
                </div>
              </div>
            ))}
            {snapshot.audit_records.length === 0 && <EmptyState label="No audit records" />}
          </div>
        </Section>
      </div>
    </div>
  );
}

function TaskCard({ task, onCancel }: { task: PersonalAssistantGovernanceBackgroundTask; onCancel: () => void }) {
  const cancellable = task.status === "created" || task.status === "running";
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-zinc-300">{task.description}</div>
          <div className="mt-1 text-zinc-500">{task.source} · {task.target_user} · {formatDate(task.updated_at)}</div>
        </div>
        <StatusPill status={task.status} />
      </div>
      {cancellable && (
        <div className="mt-3">
          <ActionButton label="Cancel" tone="red" onClick={onCancel} />
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onReject
}: {
  approval: PersonalAssistantGovernanceApproval;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-zinc-300">{approval.action_title}</div>
          <div className="mt-1 text-zinc-500">
            {approval.action_type ?? "action"} · {approval.risk_level ?? "unknown risk"} · {formatDate(approval.requested_at)}
          </div>
        </div>
        <StatusPill status={approval.status} />
      </div>
      {approval.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <ActionButton label="Approve" tone="green" onClick={onApprove} />
          <ActionButton label="Reject" tone="red" onClick={onReject} />
        </div>
      )}
    </div>
  );
}

function ScheduleCard({
  schedule,
  onPause,
  onResume
}: {
  schedule: PersonalAssistantGovernanceSchedule;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-zinc-300">{schedule.task_description}</div>
          <div className="mt-1 text-zinc-500">{schedule.cron} · {schedule.target_user} · next {schedule.next_run_at ?? "-"}</div>
        </div>
        <StatusPill status={schedule.status} />
      </div>
      {schedule.status !== "disabled" && (
        <div className="mt-3 flex gap-2">
          {schedule.status === "active" ? (
            <ActionButton label="Pause" tone="amber" onClick={onPause} />
          ) : (
            <ActionButton label="Resume" tone="green" onClick={onResume} />
          )}
        </div>
      )}
    </div>
  );
}

function ChildAgentCard({
  childAgent,
  onPause,
  onResume,
  onCancel
}: {
  childAgent: PersonalAssistantGovernanceChildAgent;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const terminal = ["completed", "failed", "cancelled"].includes(childAgent.status);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-zinc-300">{childAgent.goal}</div>
          <div className="mt-1 text-zinc-500">{childAgent.agent_id} · parent {childAgent.parent_session_id}</div>
        </div>
        <StatusPill status={childAgent.status} />
      </div>
      {!terminal && (
        <div className="mt-3 flex gap-2">
          {childAgent.status === "paused" ? (
            <ActionButton label="Resume" tone="green" onClick={onResume} />
          ) : (
            <ActionButton label="Pause" tone="amber" onClick={onPause} />
          )}
          <ActionButton label="Cancel" tone="red" onClick={onCancel} />
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">{title}</h3>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${statusClass(status)}`}>
      {status}
    </span>
  );
}

function ActionButton({ label, tone, onClick }: { label: string; tone: "green" | "red" | "amber"; onClick: () => void }) {
  const className = tone === "green"
    ? "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
    : tone === "red"
      ? "bg-red-600/20 text-red-300 hover:bg-red-600/30"
      : "bg-amber-600/20 text-amber-300 hover:bg-amber-600/30";
  return (
    <button onClick={onClick} className={`rounded px-3 py-1 text-xs ${className}`}>
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-600">{label}</div>;
}

function statusClass(status: string): string {
  if (["running", "active", "approved", "succeeded", "completed"].includes(status)) {
    return "bg-emerald-500/10 text-emerald-300";
  }
  if (["pending", "created", "waiting_for_approval", "paused", "candidate"].includes(status)) {
    return "bg-amber-500/10 text-amber-300";
  }
  if (["rejected", "failed", "cancelled", "disabled", "retired"].includes(status)) {
    return "bg-red-500/10 text-red-300";
  }
  return "bg-zinc-700 text-zinc-300";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
