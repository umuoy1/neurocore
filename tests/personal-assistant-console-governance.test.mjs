import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PersonalAssistantGovernanceConsole } from "../examples/personal-assistant/dist/main.js";

const now = "2026-04-27T04:40:00.000Z";

test("personal assistant governance console inspects all governed work", () => {
  const governance = createGovernanceConsole();
  const snapshot = governance.snapshot();

  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.background_tasks.length, 1);
  assert.equal(snapshot.approvals.length, 2);
  assert.equal(snapshot.schedules.length, 1);
  assert.equal(snapshot.child_agents.length, 1);
  assert.equal(snapshot.memories.length, 1);
  assert.equal(snapshot.tool_actions.length, 1);
  assert.equal(snapshot.summary.active_sessions, 1);
  assert.equal(snapshot.summary.running_background_tasks, 1);
  assert.equal(snapshot.summary.pending_approvals, 2);
  assert.equal(snapshot.summary.active_schedules, 1);
  assert.equal(snapshot.summary.active_child_agents, 1);
});

test("personal assistant governance actions mutate state and write audit records", () => {
  const governance = createGovernanceConsole();

  governance.approve("appr_send", "operator");
  governance.reject("appr_shell", "operator", { reason: "destructive" });
  governance.pauseSchedule("sched_digest", "operator");
  governance.resumeSchedule("sched_digest", "operator");
  governance.cancelBackgroundTask("task_research", "operator");
  governance.pauseChildAgent("child_researcher", "operator");
  governance.resumeChildAgent("child_researcher", "operator");
  governance.cancelChildAgent("child_researcher", "operator");

  const snapshot = governance.snapshot();
  const approvalById = Object.fromEntries(snapshot.approvals.map((approval) => [approval.approval_id, approval]));
  const actions = new Set(snapshot.audit_records.map((record) => record.action));

  assert.equal(approvalById.appr_send.status, "approved");
  assert.equal(approvalById.appr_shell.status, "rejected");
  assert.equal(snapshot.background_tasks[0].status, "cancelled");
  assert.equal(snapshot.schedules[0].status, "active");
  assert.equal(snapshot.child_agents[0].status, "cancelled");
  assert.equal(snapshot.summary.pending_approvals, 0);
  assert.equal(snapshot.summary.running_background_tasks, 0);

  for (const action of [
    "approval.approved",
    "approval.rejected",
    "schedule.paused",
    "schedule.resumed",
    "background_task.cancelled",
    "child_agent.paused",
    "child_agent.resumed",
    "child_agent.cancelled"
  ]) {
    assert.equal(actions.has(action), true, `missing audit action ${action}`);
  }

  for (const record of snapshot.audit_records) {
    assert.ok(record.before);
    assert.ok(record.after);
    assert.equal(record.actor_id, "operator");
  }
});

test("console package exposes the unified governance route and actions", () => {
  const app = readFileSync("packages/console/src/App.tsx", "utf8");
  const store = readFileSync("packages/console/src/stores/personalAssistantGovernance.store.ts", "utf8");
  const page = readFileSync("packages/console/src/pages/PersonalAssistantGovernancePage.tsx", "utf8");

  assert.match(app, /personal-assistant\/governance/);
  assert.match(store, /\/v1\/personal-assistant\/governance/);
  assert.match(store, /approvals\/\$\{approvalId\}\/approve/);
  assert.match(store, /background-tasks\/\$\{taskId\}\/cancel/);
  assert.match(store, /child-agents\/\$\{childAgentId\}\/resume/);
  assert.match(page, /Background Tasks/);
  assert.match(page, /Child Agents/);
  assert.match(page, /Audit Trace/);
});

function createGovernanceConsole() {
  return new PersonalAssistantGovernanceConsole({
    sessions: [
      {
        session_id: "sess_main",
        agent_id: "agent_personal",
        user_id: "user_1",
        state: "running",
        route: {
          platform: "web",
          chat_id: "chat_1",
          profile_id: "personal"
        },
        created_at: now,
        updated_at: now
      }
    ],
    background_tasks: [
      {
        task_id: "task_research",
        source: "manual",
        status: "running",
        description: "Research long-running assistant governance",
        target_user: "user_1",
        target_platform: "web",
        priority: "normal",
        session_id: "sess_main",
        created_at: now,
        updated_at: now,
        started_at: now,
        metadata: {}
      }
    ],
    approvals: [
      {
        approval_id: "appr_send",
        session_id: "sess_main",
        status: "pending",
        action_title: "Send digest to user",
        action_type: "send_message",
        risk_level: "medium",
        requested_at: now
      },
      {
        approval_id: "appr_shell",
        session_id: "sess_main",
        status: "pending",
        action_title: "Run shell command",
        action_type: "shell",
        risk_level: "high",
        requested_at: now
      }
    ],
    schedules: [
      {
        id: "sched_digest",
        cron: "0 9 * * *",
        task_description: "Daily digest",
        target_user: "user_1",
        target_platform: "web",
        enabled: true,
        mode: "recurring",
        status: "active",
        next_run_at: "2026-04-28T01:00:00.000Z",
        created_at: now,
        updated_at: now,
        metadata: {}
      }
    ],
    child_agents: [
      {
        child_agent_id: "child_researcher",
        parent_session_id: "sess_main",
        task_id: "task_research",
        agent_id: "agent_researcher",
        status: "running",
        goal: "Collect evidence for governance design",
        created_at: now,
        updated_at: now,
        metadata: {}
      }
    ],
    memories: [
      {
        memory_id: "mem_pref",
        subject: "user_1",
        claim: "User prefers autonomous self-review",
        lifecycle: "active",
        confidence: 0.95,
        source_session_ids: ["sess_main"],
        updated_at: now,
        metadata: {}
      }
    ],
    tool_actions: [
      {
        tool_action_id: "tool_web",
        session_id: "sess_main",
        tool_name: "web.search",
        status: "succeeded",
        risk_level: "low",
        created_at: now,
        updated_at: now,
        metadata: {}
      }
    ]
  });
}
