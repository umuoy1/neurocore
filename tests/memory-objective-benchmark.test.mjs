import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMemoryObjectiveBenchmark } from "@neurocore/eval-core";

test("memory objective benchmark scores recall, precision, and governance deterministically", () => {
  const report = evaluateMemoryObjectiveBenchmark([
    {
      case_id: "case_1",
      expected_episode_ids: ["epi_1", "epi_2"],
      recalled_episode_ids: ["epi_1", "epi_2", "epi_noise"],
      expected_card_ids: ["card_1"],
      recalled_card_ids: ["card_1"],
      expected_skill_spec_ids: ["spec_1"],
      recalled_skill_spec_ids: ["spec_1"],
      disallowed_object_ids: ["card_bad"],
      returned_object_ids: ["epi_1", "card_1", "spec_1"]
    },
    {
      case_id: "case_2",
      expected_episode_ids: ["epi_3"],
      recalled_episode_ids: ["epi_3"],
      expected_card_ids: ["card_2"],
      recalled_card_ids: [],
      expected_skill_spec_ids: ["spec_2"],
      recalled_skill_spec_ids: ["spec_2", "spec_noise"],
      disallowed_object_ids: ["spec_bad"],
      returned_object_ids: ["spec_bad"]
    }
  ]);

  assert.equal(report.case_count, 2);
  assert.ok(report.episodic_recall > 0.9);
  assert.ok(report.semantic_card_recall < 1);
  assert.ok(report.governance_exclusion_rate < 1);
  assert.ok(report.objective_score > 0 && report.objective_score < 1);
});
