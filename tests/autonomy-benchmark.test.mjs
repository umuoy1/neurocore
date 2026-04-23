import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAutonomyBenchmark } from "@neurocore/eval-core";

test("Autonomy benchmark summarizes lifecycle and trace coverage", () => {
  const summary = summarizeAutonomyBenchmark([
    {
      session_id: "ses_1",
      events: [
        { event_type: "plan.generated" },
        { event_type: "goal.self_generated" },
        { event_type: "drift.detected" },
        { event_type: "recovery.triggered" },
        { event_type: "transfer.validated" },
        { event_type: "consolidation.completed" }
      ],
      traces: [
        { autonomy_state: { session_id: "ses_1" }, autonomy_decision: { decision_id: "adn_1" } },
        { autonomy_state: { session_id: "ses_1" } }
      ]
    },
    {
      session_id: "ses_2",
      events: [{ event_type: "plan.generated" }],
      traces: [{ autonomy_state: { session_id: "ses_2" }, autonomy_decision: { decision_id: "adn_2" } }]
    }
  ]);

  assert.equal(summary.session_count, 2);
  assert.equal(summary.plan_generation_rate, 1);
  assert.equal(summary.self_goal_generation_rate, 0.5);
  assert.equal(summary.drift_detection_rate, 0.5);
  assert.equal(summary.recovery_trigger_rate, 0.5);
  assert.equal(summary.transfer_validation_rate, 0.5);
  assert.equal(summary.consolidation_rate, 0.5);
  assert.equal(summary.autonomy_trace_coverage, 1);
  assert.equal(summary.autonomy_decision_coverage, 0.75);
  assert.ok(summary.autonomy_score > 0);
});
