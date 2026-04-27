import assert from "node:assert/strict";
import test from "node:test";
import { AgentSkillRegistry } from "../examples/personal-assistant/dist/skills/agent-skill-registry.js";
import {
  AutoSkillManager,
  createAutoSkillTools,
  createExpectedOutputValidator
} from "../examples/personal-assistant/dist/skills/auto-skill-manager.js";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("auto skill product tools complete propose validate activate disable rollback and audit flow", async () => {
  const registry = new AgentSkillRegistry();
  const manager = new AutoSkillManager({
    registry,
    threshold: 2,
    now: fixedNow,
    generateId: createSequenceId()
  });
  const tools = new Map(createAutoSkillTools(manager).map((tool) => [tool.name, tool]));
  const ctx = { tenant_id: "tenant-auto", session_id: "session-auto", cycle_id: "cycle-auto" };

  const proposed = await tools.get("auto_skill_propose").invoke({
    workflows: makeWorkflows("email_digest", 2, "Digest sent")
  }, ctx);
  assert.equal(proposed.payload.candidates.length, 1);
  const candidateId = proposed.payload.candidates[0].candidate_id;
  assert.throws(() => manager.activateCandidate(candidateId), /must pass validation/);

  const validated = await tools.get("auto_skill_validate").invoke({ candidate_id: candidateId }, ctx);
  assert.equal(validated.payload.candidate.status, "validated");
  assert.equal(validated.payload.candidate.validation_report.passed, true);

  const activated = await tools.get("auto_skill_activate").invoke({ candidate_id: candidateId }, ctx);
  assert.equal(activated.payload.candidate.status, "active");
  assert.equal(registry.invokeSkill("auto-email_digest", "draft", { platform: "web" }).allowed, true);
  const hashV1 = registry.getSkill("auto-email_digest").content_hash;

  const proposedV2 = await tools.get("auto_skill_propose").invoke({
    workflows: makeWorkflows("email_digest", 2, "Digest v2")
  }, ctx);
  const candidateV2Id = proposedV2.payload.candidates[0].candidate_id;
  await tools.get("auto_skill_validate").invoke({ candidate_id: candidateV2Id }, ctx);
  const activeV2 = await tools.get("auto_skill_activate").invoke({ candidate_id: candidateV2Id }, ctx);
  assert.equal(activeV2.payload.candidate.version, "2.0.0");
  assert.notEqual(registry.getSkill("auto-email_digest").content_hash, hashV1);

  const disabled = await tools.get("auto_skill_disable").invoke({
    skill_id: "auto-email_digest",
    version: "2.0.0"
  }, ctx);
  assert.equal(disabled.payload.candidate.status, "disabled");
  assert.throws(() => registry.invokeSkill("auto-email_digest", "draft", { platform: "web" }), /not available/);

  const rolledBack = await tools.get("auto_skill_rollback").invoke({ skill_id: "auto-email_digest" }, ctx);
  assert.equal(rolledBack.payload.candidate.version, "1.0.0");
  assert.equal(registry.getSkill("auto-email_digest").enabled, true);
  assert.equal(registry.getSkill("auto-email_digest").content_hash, hashV1);

  const audit = await tools.get("auto_skill_audit").invoke({ limit: 20 }, ctx);
  const eventTypes = audit.payload.events.map((event) => event.event_type);
  assert.ok(eventTypes.includes("candidate_proposed"));
  assert.ok(eventTypes.includes("candidate_validated"));
  assert.ok(eventTypes.includes("candidate_activated"));
  assert.ok(eventTypes.includes("version_disabled"));
  assert.ok(eventTypes.includes("version_rolled_back"));
});

test("auto skill tools expose governed entry points on the personal assistant agent", () => {
  const manager = new AutoSkillManager({ registry: new AgentSkillRegistry(), threshold: 2, now: fixedNow });
  const agent = createPersonalAssistantAgent({
    db_path: join(mkdtempSync(join(tmpdir(), "neurocore-pa-auto-skill-agent-")), "assistant.sqlite"),
    tenant_id: "tenant-auto",
    reasoner: createReasoner()
  }, {
    autoSkillManager: manager
  });

  assert.ok(agent.getProfile().tool_refs.includes("auto_skill_propose"));
  assert.ok(agent.getProfile().tool_refs.includes("auto_skill_validate"));
  assert.ok(agent.getProfile().tool_refs.includes("auto_skill_rollback"));
  assert.ok(agent.getProfile().tool_refs.includes("auto_skill_audit"));
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

function createSequenceId() {
  let sequence = 0;
  return (prefix) => `${prefix}_${++sequence}`;
}

function createReasoner() {
  return {
    name: "auto-skill-test-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "auto-skill-test-reasoner",
        proposal_type: "plan",
        salience_score: 0.5,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "auto skill test" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "auto skill",
        description: "auto skill test",
        side_effect_level: "none"
      }];
    }
  };
}
