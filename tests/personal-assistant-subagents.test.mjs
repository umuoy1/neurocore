import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { SubagentManager } from "../examples/personal-assistant/dist/subagents/subagent-manager.js";

test("subagent manager spawns child tasks and records results in background ledger", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-subagent-"));
  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "test-tenant",
      reasoner: createImmediateReasoner()
    });
    const manager = new SubagentManager({
      agent,
      tenantId: "test-tenant"
    });

    const spawned = manager.spawn({
      parent_session_id: "parent-1",
      target_user: "user-1",
      description: "Research task",
      input: "collect facts"
    });
    assert.equal(spawned.task.status, "running");
    assert.equal(spawned.task.metadata.parent_session_id, "parent-1");
    assert.equal(spawned.task.metadata.subagent, true);

    const completed = await spawned.completion;
    assert.equal(completed.status, "succeeded");
    assert.match(completed.result_text ?? "", /child completed: collect facts/);

    const listed = manager.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].task_id, completed.task_id);
    assert.equal(manager.get(completed.task_id).session_id, spawned.session.id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("subagent manager can cancel child tasks and cascade parent cancellation", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-subagent-cancel-"));
  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "test-tenant",
      reasoner: createImmediateReasoner()
    });
    const manager = new SubagentManager({
      agent,
      tenantId: "test-tenant"
    });

    const first = manager.spawn({
      parent_session_id: "parent-cancel",
      target_user: "user-1",
      description: "First child",
      auto_run: false
    });
    const second = manager.spawn({
      parent_session_id: "parent-cancel",
      target_user: "user-1",
      description: "Second child",
      auto_run: false
    });

    const cancelled = manager.cancel(first.task.task_id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(first.session.getSession().state, "aborted");

    const cascade = manager.cancelByParentSession("parent-cancel");
    assert.equal(cascade.length, 2);
    assert.ok(cascade.every((task) => task.status === "cancelled"));
    assert.equal(manager.get(second.task.task_id).status, "cancelled");
    assert.equal(second.session.getSession().state, "aborted");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createImmediateReasoner() {
  return {
    name: "subagent-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "subagent-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0.1,
          payload: { summary: "Complete child task." }
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
          title: "Child result",
          description: `child completed: ${input}`,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
