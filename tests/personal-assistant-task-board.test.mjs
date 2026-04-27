import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundTaskLedger } from "../examples/personal-assistant/dist/proactive/background-task-ledger.js";
import { PersonalAssistantTaskBoard } from "../examples/personal-assistant/dist/proactive/task-board.js";

test("task board lists cron subagent and webhook tasks with trace artifact and error details", () => {
  const { board, tasks } = createTaskBoardFixture();

  const list = board.list();
  assert.equal(list.length, 3);
  assert.equal(list.find((task) => task.task_id === tasks.cron.task_id).source, "schedule");
  assert.deepEqual(list.find((task) => task.task_id === tasks.cron.task_id).trace_ids, ["trace-cron"]);
  assert.equal(list.find((task) => task.task_id === tasks.subagent.task_id).artifacts[0].artifact_id, "artifact-sub");
  assert.equal(list.find((task) => task.task_id === tasks.webhook.task_id).error_message, "webhook failed");

  const detail = board.detail(tasks.webhook.task_id);
  assert.equal(detail.task.status, "failed");
  assert.match(detail.timeline.map((entry) => entry.event).join(","), /failed/);
  assert.equal(detail.can_retry, true);
});

test("task board can cancel running tasks while failed and cancelled tasks remain inspectable", () => {
  const { board, tasks } = createTaskBoardFixture();

  const cancelled = board.cancel(tasks.subagent.task_id, "operator", { reason: "user request" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.can_retry, true);
  assert.equal(board.detail(tasks.subagent.task_id).task.status, "cancelled");
  assert.equal(board.listAuditRecords().at(-1).action, "task.cancelled");

  const failed = board.detail(tasks.webhook.task_id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_message, "webhook failed");
});

test("task board retry creates linked retry task and preserves provenance", () => {
  const { board, tasks } = createTaskBoardFixture();

  const retry = board.retry(tasks.webhook.task_id, "operator", { reason: "manual retry" });
  assert.equal(retry.status, "created");
  assert.equal(retry.retry_of, tasks.webhook.task_id);
  assert.equal(retry.retry_attempt, 1);
  assert.equal(retry.task.metadata.original_task_id, tasks.webhook.task_id);
  assert.equal(board.listAuditRecords().at(-1).action, "task.retried");
});

function createTaskBoardFixture() {
  let tick = 0;
  const ledger = new BackgroundTaskLedger();
  const board = new PersonalAssistantTaskBoard({
    ledger,
    now: () => `2026-04-28T01:40:${String(tick++).padStart(2, "0")}.000Z`
  });

  const cron = ledger.create({
    source: "schedule",
    description: "Daily digest",
    target_user: "user",
    metadata: {
      schedule_id: "cron-digest",
      trace_ids: ["trace-cron"],
      goal_ids: ["goal-cron"],
      artifacts: [{ artifact_id: "artifact-cron", artifact_type: "markdown", ref: "digest.md" }]
    },
    created_at: "2026-04-28T01:39:00.000Z"
  });
  ledger.markRunning(cron.task_id, "session-cron", "2026-04-28T01:39:01.000Z");
  ledger.markSucceeded(cron.task_id, {
    result_text: "Digest sent",
    completed_at: "2026-04-28T01:39:02.000Z"
  });

  const subagent = ledger.create({
    source: "manual",
    description: "Research task",
    target_user: "user",
    metadata: {
      subagent: true,
      trace_ids: ["trace-sub"],
      artifacts: [{ artifact_id: "artifact-sub", artifact_type: "text", ref: "research.txt" }]
    },
    created_at: "2026-04-28T01:39:03.000Z"
  });
  ledger.markRunning(subagent.task_id, "session-sub", "2026-04-28T01:39:04.000Z");

  const webhook = ledger.create({
    source: "webhook",
    description: "Deploy webhook",
    target_user: "user",
    metadata: {
      webhook_route_id: "deploy",
      trace_ids: ["trace-webhook"],
      artifacts: [{ artifact_id: "artifact-webhook", artifact_type: "json", ref: "payload.json" }]
    },
    created_at: "2026-04-28T01:39:05.000Z"
  });
  ledger.markFailed(webhook.task_id, new Error("webhook failed"), "2026-04-28T01:39:06.000Z");

  return {
    board,
    tasks: {
      cron,
      subagent,
      webhook
    }
  };
}
