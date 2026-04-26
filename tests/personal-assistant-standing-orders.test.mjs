import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { ProactiveEngine } from "../examples/personal-assistant/dist/proactive/proactive-engine.js";
import { SqliteStandingOrderStore } from "../examples/personal-assistant/dist/proactive/store/sqlite-standing-order-store.js";

test("standing orders persist owner scope expiry permission and metadata", { concurrency: false }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-standing-orders-"));
  const dbPath = join(tempDir, "standing-orders.sqlite");
  const writer = new SqliteStandingOrderStore({ filename: dbPath });

  try {
    const active = writer.create({
      owner_user_id: "owner-1",
      instruction: "Only notify me for urgent inbox changes.",
      scope: {
        type: "user",
        user_id: "user-1"
      },
      permission: {
        tools: ["email_read"],
        channels: ["web"],
        requires_approval: true
      },
      expires_at: "2026-05-01T00:00:00.000Z",
      created_at: "2026-04-26T00:00:00.000Z",
      metadata: {
        source: "test"
      }
    });
    writer.create({
      owner_user_id: "owner-1",
      instruction: "Expired order.",
      scope: {
        type: "user",
        user_id: "user-1"
      },
      expires_at: "2026-04-01T00:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z"
    });
    writer.create({
      owner_user_id: "owner-2",
      instruction: "Other user order.",
      scope: {
        type: "user",
        user_id: "user-2"
      },
      created_at: "2026-04-26T00:00:00.000Z"
    });
    writer.close();

    const reader = new SqliteStandingOrderStore({ filename: dbPath });
    const orders = reader.listActive({
      user_id: "user-1",
      platform: "web",
      now: "2026-04-27T00:00:00.000Z"
    });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].order_id, active.order_id);
    assert.equal(orders[0].owner_user_id, "owner-1");
    assert.equal(orders[0].scope.type, "user");
    assert.equal(orders[0].scope.user_id, "user-1");
    assert.equal(orders[0].permission.tools[0], "email_read");
    assert.equal(orders[0].permission.channels[0], "web");
    assert.equal(orders[0].permission.requires_approval, true);
    assert.equal(orders[0].metadata.source, "test");
    reader.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat injects standing orders and records task trace metadata", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-heartbeat-standing-orders-"));
  const store = new SqliteStandingOrderStore({ filename: join(tempDir, "standing-orders.sqlite") });
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const builder = createPersonalAssistantAgent({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-standing-orders",
    reasoner: createStandingOrderEchoReasoner()
  });
  const engine = new ProactiveEngine({
    agent: builder,
    gateway,
    tenantId: "tenant-standing-orders",
    standingOrderStore: store
  });
  const order = engine.registerStandingOrder({
    owner_user_id: "owner-1",
    instruction: "Only notify me when the inbox digest is urgent.",
    scope: {
      type: "user",
      user_id: "user-1"
    },
    permission: {
      tools: ["email_read"],
      channels: ["web"]
    },
    expires_at: "2026-05-01T00:00:00.000Z",
    created_at: "2026-04-27T00:00:00.000Z"
  });

  engine.registerHeartbeat([
    {
      name: "quiet-check",
      description: "No work",
      async execute() {
        return {
          triggered: false,
          summary: "No work.",
          priority: "normal",
          target_user: "user-1",
          target_platform: "web"
        };
      }
    },
    {
      name: "urgent-inbox",
      description: "Urgent inbox digest",
      async execute() {
        return {
          triggered: true,
          summary: "Inbox digest has an urgent item.",
          priority: "urgent",
          target_user: "user-1",
          target_platform: "web",
          payload: {
            digest_id: "digest-1"
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
    assert.match(notifications[0].content.text, /Standing orders:/);
    assert.match(notifications[0].content.text, /Only notify me when the inbox digest is urgent/);
    assert.match(notifications[0].content.text, /Inbox digest has an urgent item/);

    const tasks = engine.listBackgroundTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].source, "heartbeat");
    assert.equal(tasks[0].status, "succeeded");
    assert.deepEqual(tasks[0].metadata.standing_order_ids, [order.order_id]);
    assert.equal(tasks[0].metadata.standing_orders[0].instruction, order.instruction);
    assert.equal(tasks[0].metadata.standing_orders[0].permission.tools[0], "email_read");
    assert.equal(tasks[0].metadata.payload.digest_id, "digest-1");
    assert.ok(Array.isArray(tasks[0].metadata.trace_ids));
    assert.ok(tasks[0].metadata.trace_ids.length > 0);
    assert.ok(store.get(order.order_id).last_applied_at);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat silently skips when no checks are actionable", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-heartbeat-skip-"));
  const notifications = [];
  const approvals = [];
  const gateway = createGatewayHarness({ notifications, approvals });
  const builder = createPersonalAssistantAgent({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-standing-orders",
    reasoner: createStandingOrderEchoReasoner()
  });
  const engine = new ProactiveEngine({
    agent: builder,
    gateway,
    tenantId: "tenant-standing-orders"
  });

  engine.registerHeartbeat([
    {
      name: "no-work",
      description: "No work",
      async execute() {
        return {
          triggered: false,
          summary: "Nothing to do.",
          priority: "normal",
          target_user: "user-1",
          target_platform: "web"
        };
      }
    }
  ]);

  try {
    const results = await engine.heartbeatScheduler.runChecks();
    assert.equal(results.length, 0);
    assert.equal(notifications.length, 0);
    assert.equal(approvals.length, 0);
    assert.equal(engine.listBackgroundTasks().length, 0);
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

function createStandingOrderEchoReasoner() {
  return {
    name: "standing-order-echo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "standing-order-echo-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Echo heartbeat prompt for audit." }
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
          title: "Return heartbeat prompt",
          description: input,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
