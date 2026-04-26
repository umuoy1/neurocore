import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { ProactiveEngine } from "../examples/personal-assistant/dist/proactive/proactive-engine.js";

test("personal assistant proactive heartbeat pushes notification output", { concurrency: false }, async () => {
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-proactive-"));
  const builder = createPersonalAssistantAgent({
    db_path: join(tempDir, "personal-assistant-proactive.sqlite"),
    tenant_id: "test-tenant",
    reasoner: createProactiveRespondReasoner()
  });
  const engine = new ProactiveEngine({
    agent: builder,
    gateway,
    tenantId: "test-tenant"
  });

  engine.registerHeartbeat([
    {
      name: "overdue-tasks",
      description: "Detect overdue tasks",
      async execute() {
        return {
          triggered: true,
          summary: "There is one overdue task.",
          priority: "urgent",
          target_user: "user-1",
          target_platform: "web",
          payload: {
            count: 1
          }
        };
      }
    }
  ]);

  try {
    const results = await engine.heartbeatScheduler.runChecks();

    assert.equal(results.length, 1);
    assert.equal(notifications.length, 1);
    assert.equal(approvals.length, 0);
    assert.deepEqual(notifications[0].options, {
      platform: "web",
      priority: "urgent"
    });
    assert.equal(notifications[0].userId, "user-1");
    assert.equal(notifications[0].content.type, "text");
    assert.match(notifications[0].content.text, /Notify the user about: There is one overdue task/i);

    const tasks = engine.listBackgroundTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].source, "heartbeat");
    assert.equal(tasks[0].status, "succeeded");
    assert.equal(tasks[0].target_user, "user-1");
    assert.equal(tasks[0].delivery_target.platform, "web");
    assert.equal(tasks[0].delivery_target.priority, "urgent");
    assert.match(tasks[0].result_text, /Notify the user about/i);
    assert.ok(tasks[0].delivered_at);
    assert.equal(engine.getBackgroundTask(tasks[0].task_id).status, "succeeded");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant proactive schedule can emit approval requests", { concurrency: false }, async () => {
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-proactive-"));
  const builder = createPersonalAssistantAgent({
    db_path: join(tempDir, "personal-assistant-proactive.sqlite"),
    tenant_id: "test-tenant",
    reasoner: createProactiveApprovalReasoner(),
    agent: {
      approvers: ["owner"],
      required_approval_tools: ["email_send"]
    },
    connectors: {
      email: {
        sender: {
          async send() {
            return {
              message_id: "email-1",
              sent_at: new Date().toISOString()
            };
          }
        }
      }
    }
  });
  const engine = new ProactiveEngine({
    agent: builder,
    gateway,
    tenantId: "test-tenant"
  });

  engine.registerSchedule({
    id: "schedule-1",
    cron: "* * * * *",
    task_description: "Send the daily digest email.",
    target_user: "user-2",
    target_platform: "web",
    enabled: true
  });

  try {
    await engine.cronScheduler.tick(new Date("2026-04-03T10:00:00.000Z"));

    assert.equal(notifications.length, 0);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].userId, "user-2");
    assert.equal(approvals[0].sessionId.startsWith("ses_"), true);
    assert.equal(approvals[0].approval.action.tool_name, "email_send");
    assert.deepEqual(approvals[0].options, {
      platform: "web"
    });

    const tasks = engine.listBackgroundTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].source, "schedule");
    assert.equal(tasks[0].status, "running");
    assert.equal(tasks[0].approval_id, approvals[0].approval.approval_id);
    assert.equal(tasks[0].delivery_target.platform, "web");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant background task ledger supports lifecycle inspection and cancellation", { concurrency: false }, async () => {
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-task-ledger-"));
  const builder = createPersonalAssistantAgent({
    db_path: join(tempDir, "personal-assistant-proactive.sqlite"),
    tenant_id: "test-tenant",
    reasoner: createProactiveRespondReasoner()
  });
  const engine = new ProactiveEngine({
    agent: builder,
    gateway,
    tenantId: "test-tenant"
  });

  try {
    const succeeded = engine.taskLedger.create({
      source: "manual",
      description: "Summarize a document.",
      target_user: "user-1"
    });
    assert.equal(engine.getBackgroundTask(succeeded.task_id).status, "created");
    engine.taskLedger.markRunning(succeeded.task_id, "ses-task-success");
    assert.equal(engine.getBackgroundTask(succeeded.task_id).status, "running");
    engine.taskLedger.markSucceeded(succeeded.task_id, {
      result_text: "summary done"
    });

    const failed = engine.taskLedger.create({
      source: "webhook",
      description: "Process webhook payload.",
      target_user: "user-1"
    });
    engine.taskLedger.markRunning(failed.task_id, "ses-task-failed");
    engine.taskLedger.markFailed(failed.task_id, new Error("webhook failed"));

    const cancelled = engine.taskLedger.create({
      source: "manual",
      description: "Cancelable task.",
      target_user: "user-1"
    });
    const cancelledResult = engine.cancelBackgroundTask(cancelled.task_id);

    const statuses = new Set(engine.listBackgroundTasks().map((task) => task.status));
    assert.ok(statuses.has("succeeded"));
    assert.ok(statuses.has("failed"));
    assert.ok(statuses.has("cancelled"));
    assert.equal(cancelledResult.status, "cancelled");
    assert.equal(engine.getBackgroundTask(failed.task_id).error_message, "webhook failed");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createGatewayHarness(state) {
  return {
    async pushNotification(userId, content, options) {
      state.notifications.push({ userId, content, options });
    },
    async pushApprovalRequest(userId, sessionId, approval, options) {
      state.approvals.push({ userId, sessionId, approval, options });
    }
  };
}

function createProactiveRespondReasoner() {
  return {
    name: "proactive-respond-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "proactive-respond-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Notify the user directly." }
        }
      ];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Send proactive notification",
          description: `Notify the user about: ${extractSummary(input)}`,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function createProactiveApprovalReasoner() {
  return {
    name: "proactive-approval-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "proactive-approval-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0.2,
          payload: { summary: "Send an email after approval." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Send daily digest email",
          tool_name: "email_send",
          tool_args: {
            to: ["demo@example.com"],
            subject: "Daily Digest",
            body: "Digest body"
          },
          side_effect_level: "high"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function extractSummary(input) {
  const marker = "System heartbeat detected:\n";
  if (!input.startsWith(marker)) {
    return input.trim();
  }

  const remainder = input.slice(marker.length);
  const endIndex = remainder.indexOf("\nDecide whether the user should be notified.");
  return (endIndex >= 0 ? remainder.slice(0, endIndex) : remainder).trim();
}
