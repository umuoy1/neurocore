import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { ProactiveEngine } from "../examples/personal-assistant/dist/proactive/proactive-engine.js";

test("personal assistant proactive heartbeat pushes notification output", async () => {
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const builder = createPersonalAssistantAgent({
    db_path: ".neurocore/personal-assistant-proactive.sqlite",
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
});

test("personal assistant proactive schedule can emit approval requests", async () => {
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const builder = createPersonalAssistantAgent({
    db_path: ".neurocore/personal-assistant-proactive.sqlite",
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

  await engine.cronScheduler.tick(new Date("2026-04-03T10:00:00.000Z"));

  assert.equal(notifications.length, 0);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].userId, "user-2");
  assert.equal(approvals[0].sessionId.startsWith("ses_"), true);
  assert.equal(approvals[0].approval.action.tool_name, "email_send");
  assert.deepEqual(approvals[0].options, {
    platform: "web"
  });
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
