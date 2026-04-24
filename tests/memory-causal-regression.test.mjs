import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMemoryCausalRegression } from "@neurocore/eval-core";

test("memory causal regression scores expected intervention direction deterministically", () => {
  const report = evaluateMemoryCausalRegression([
    {
      case_id: "case_remove",
      intervention: "remove_episode",
      baseline_score: 0.9,
      perturbed_score: 0.6,
      expected_direction: "degrade"
    },
    {
      case_id: "case_tombstone",
      intervention: "tombstone_episode",
      baseline_score: 0.8,
      perturbed_score: 0.79,
      expected_direction: "stable"
    },
    {
      case_id: "case_promote",
      intervention: "promote_skill",
      baseline_score: 0.5,
      perturbed_score: 0.72,
      expected_direction: "improve"
    }
  ]);

  assert.equal(report.case_count, 3);
  assert.equal(report.direction_accuracy, 1);
  assert.ok(report.average_effect_size > 0);
  assert.ok(report.causal_score > 0 && report.causal_score <= 1);
});
