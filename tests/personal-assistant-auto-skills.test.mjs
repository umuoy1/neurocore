import assert from "node:assert/strict";
import test from "node:test";
import { AgentSkillRegistry } from "../examples/personal-assistant/dist/skills/agent-skill-registry.js";
import {
  AutoSkillManager,
  createExpectedOutputValidator
} from "../examples/personal-assistant/dist/skills/auto-skill-manager.js";

test("successful repeated workflows generate procedural skill candidates", () => {
  const manager = new AutoSkillManager({ threshold: 3, now: fixedNow });
  const tooFew = manager.proposeFromWorkflows(makeWorkflows("weekly_digest", 2, "Digest sent"));
  assert.equal(tooFew.length, 0);

  const candidates = manager.proposeFromWorkflows(makeWorkflows("weekly_digest", 3, "Digest sent"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "candidate");
  assert.equal(candidates[0].skill_id, "auto-weekly_digest");
  assert.equal(candidates[0].source_count, 3);
  assert.ok(candidates[0].instructions.includes("## Steps"));
  assert.ok(candidates[0].regression_cases.length >= 3);
});

test("generated skills must pass validation and regression tests before activation", async () => {
  const registry = new AgentSkillRegistry();
  const manager = new AutoSkillManager({ registry, threshold: 2, now: fixedNow });
  const [candidate] = manager.proposeFromWorkflows(makeWorkflows("email_digest", 2, "Digest sent"));

  assert.throws(() => manager.activateCandidate(candidate.candidate_id), /must pass validation/);

  const failed = await manager.validateCandidate(candidate.candidate_id, [
    {
      name: "failing-validator",
      async validate() {
        return [{ case_id: "reg_fail", passed: false, reason: "regression failed" }];
      }
    }
  ]);
  assert.equal(failed.status, "failed");
  assert.throws(() => manager.activateCandidate(candidate.candidate_id), /must pass validation/);

  const [validCandidate] = manager.proposeFromWorkflows(makeWorkflows("email_digest", 2, "Digest sent"));
  const validated = await manager.validateCandidate(validCandidate.candidate_id, [
    createExpectedOutputValidator()
  ]);
  assert.equal(validated.status, "validated");
  assert.equal(validated.validation_report.passed, true);

  const active = manager.activateCandidate(validCandidate.candidate_id);
  const skill = registry.getSkill(active.skill_id);
  assert.equal(active.status, "active");
  assert.equal(skill.enabled, true);
  assert.match(skill.instructions, /Digest sent/);
  assert.deepEqual(skill.permissions, ["email"]);
});

test("skill versions can be disabled or rolled back", async () => {
  const registry = new AgentSkillRegistry();
  const manager = new AutoSkillManager({ registry, threshold: 2, now: fixedNow });

  const [v1] = manager.proposeFromWorkflows(makeWorkflows("calendar_summary", 2, "Summary v1"));
  await manager.validateCandidate(v1.candidate_id, [createExpectedOutputValidator()]);
  const activeV1 = manager.activateCandidate(v1.candidate_id);
  const hashV1 = registry.getSkill(activeV1.skill_id).content_hash;

  const [v2] = manager.proposeFromWorkflows(makeWorkflows("calendar_summary", 2, "Summary v2"));
  await manager.validateCandidate(v2.candidate_id, [createExpectedOutputValidator()]);
  const activeV2 = manager.activateCandidate(v2.candidate_id);
  const hashV2 = registry.getSkill(activeV2.skill_id).content_hash;
  assert.notEqual(hashV1, hashV2);
  assert.equal(manager.getCandidate(v1.candidate_id).status, "replaced");

  const disabled = manager.disableVersion(activeV2.skill_id, activeV2.version);
  assert.equal(disabled.status, "disabled");
  assert.equal(registry.getSkill(activeV2.skill_id).enabled, false);

  const rolledBack = manager.rollback(activeV2.skill_id);
  assert.equal(rolledBack.candidate_id, v1.candidate_id);
  assert.equal(rolledBack.status, "active");
  assert.equal(registry.getSkill(activeV2.skill_id).enabled, true);
  assert.equal(registry.getSkill(activeV2.skill_id).content_hash, hashV1);
});

function makeWorkflows(key, count, expectedOutput) {
  return Array.from({ length: count }, (_, index) => ({
    workflow_key: key,
    title: key.replace(/_/g, " "),
    description: `Repeated workflow ${key}`,
    success: true,
    steps: [
      "Collect relevant context",
      "Generate concise answer",
      `Verify output includes ${expectedOutput}`
    ],
    input_examples: [`input ${index + 1}`],
    output_examples: [expectedOutput],
    created_at: `2026-04-27T00:0${index}:00.000Z`
  }));
}

function fixedNow() {
  return "2026-04-27T04:00:00.000Z";
}
