import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPersonalAssistantAgent,
  startPersonalAssistantApp
} from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { AgentSkillRegistry } from "../examples/personal-assistant/dist/skills/agent-skill-registry.js";
import {
  createFixtureSkillMarketplaceSource,
  createSkillMarketplaceTools,
  SkillMarketplace
} from "../examples/personal-assistant/dist/skills/skill-marketplace.js";

test("skill marketplace tools search install enable disable and audit permissions and risk", async () => {
  const registry = new AgentSkillRegistry();
  const marketplace = new SkillMarketplace({
    registry,
    sources: [createTestSkillSource()]
  });
  const tools = new Map(createSkillMarketplaceTools(marketplace).map((tool) => [tool.name, tool]));
  const ctx = { tenant_id: "tenant-skills", session_id: "session-skills", cycle_id: "cycle-skills" };

  const search = await tools.get("skill_marketplace_search").invoke({
    query: "report",
    actor_id: "operator"
  }, ctx);
  assert.equal(search.payload.packages.length, 2);
  assert.deepEqual(search.payload.packages[0].permissions, ["read", "write"]);
  assert.equal(search.payload.packages[0].risk_level, "medium");

  const install = await tools.get("skill_marketplace_install").invoke({
    source_id: "fixture-test",
    package_id: "report-writer",
    version: "1.0.0",
    actor_id: "operator"
  }, ctx);
  assert.equal(install.payload.installed.enabled, false);
  assert.throws(() => registry.invokeSkill("report-writer", "draft", { platform: "web" }), /not available/);

  const enabled = await tools.get("skill_marketplace_enable").invoke({
    skill_id: "report-writer",
    actor_id: "operator"
  }, ctx);
  assert.equal(enabled.payload.skill.enabled, true);
  assert.equal(registry.invokeSkill("report-writer", "draft", { platform: "web" }).allowed, true);

  await tools.get("skill_marketplace_disable").invoke({
    skill_id: "report-writer",
    actor_id: "operator"
  }, ctx);
  assert.throws(() => registry.invokeSkill("report-writer", "draft", { platform: "web" }), /not available/);

  const audit = await tools.get("skill_marketplace_audit").invoke({ limit: 10 }, ctx);
  const types = audit.payload.events.map((event) => event.event_type);
  assert.ok(types.includes("searched"));
  assert.ok(types.includes("installed"));
  assert.ok(types.includes("enabled"));
  assert.ok(types.includes("disabled"));
});

test("skill marketplace update failure rolls back and version pin blocks upgrade", async () => {
  const registry = new AgentSkillRegistry();
  const marketplace = new SkillMarketplace({
    registry,
    sources: [createTestSkillSource()]
  });

  marketplace.install({
    source_id: "fixture-test",
    package_id: "report-writer",
    version: "1.0.0",
    enabled: true
  });
  const failed = marketplace.update({
    skill_id: "report-writer",
    version: "2.0.0",
    actor_id: "operator"
  });
  assert.equal(failed.rolled_back, true);
  assert.match(failed.error, /previous version retained/);
  assert.equal(failed.installed.version, "1.0.0");
  assert.match(registry.getSkill("report-writer").instructions, /v1/);
  assert.ok(marketplace.listAuditEvents().some((event) => event.event_type === "update_failed_rollback"));

  marketplace.install({
    source_id: "fixture-test",
    package_id: "pinned-helper",
    version: "1.0.0",
    enabled: true,
    pin_version: true
  });
  const pinned = marketplace.update({
    skill_id: "pinned-helper",
    version: "2.0.0"
  });
  assert.equal(pinned.rolled_back, true);
  assert.match(pinned.error, /pinned/);
  assert.equal(pinned.installed.version, "1.0.0");
  assert.ok(marketplace.listAuditEvents().some((event) => event.event_type === "update_blocked_pinned"));
});

test("personal assistant runtime can install and enable a marketplace skill", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-skill-marketplace-"));
  const registry = new AgentSkillRegistry();
  const marketplace = new SkillMarketplace({
    registry,
    sources: [createFixtureSkillMarketplaceSource()]
  });

  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "tenant-skills",
      reasoner: createMarketplaceReasoner(),
      agent: {
        auto_approve: true,
        max_cycles: 4
      }
    }, {
      skillRegistry: registry,
      skillMarketplace: marketplace
    });
    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-skills",
      initial_input: {
        content: "install briefing writer"
      }
    });
    const result = await session.run();

    assert.equal(result.finalState, "completed");
    assert.equal(registry.invokeSkill("briefing-writer", "draft", { platform: "web" }).allowed, true);
    assert.ok(findToolObservations(session, "skill_marketplace_install").length === 1);
    assert.ok(findToolObservations(session, "skill_marketplace_enable").length === 1);
    assert.ok(marketplace.listAuditEvents().some((event) => event.event_type === "enabled"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant app config can bootstrap fixture skill marketplace", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-skill-marketplace-app-"));
  const app = await startPersonalAssistantApp({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-skills",
    reasoner: createMarketplaceReasoner(),
    web_chat: {
      enabled: false
    },
    skills: {
      marketplace_enabled: true,
      marketplace_fixture: true
    }
  });

  try {
    assert.ok(app.skillMarketplace);
    assert.ok(app.builder.getProfile().tool_refs.includes("skill_marketplace_search"));
    assert.ok(app.skillMarketplace.search("briefing").some((pkg) => pkg.package_id === "briefing-writer"));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTestSkillSource() {
  return {
    source_id: "fixture-test",
    display_name: "Fixture Test Hub",
    packages: [
      {
        source_id: "fixture-test",
        package_id: "report-writer",
        skill_id: "report-writer",
        version: "1.0.0",
        name: "Report Writer",
        description: "Write status reports.",
        instructions: "report writer v1",
        permissions: ["read", "write"],
        channels: ["web"],
        risk_level: "medium"
      },
      {
        source_id: "fixture-test",
        package_id: "report-writer",
        skill_id: "report-writer",
        version: "2.0.0",
        name: "Report Writer",
        description: "Write status reports.",
        instructions: "report writer v2",
        permissions: ["read", "write"],
        channels: ["web"],
        risk_level: "medium",
        metadata: {
          install_failure: true
        }
      },
      {
        source_id: "fixture-test",
        package_id: "pinned-helper",
        skill_id: "pinned-helper",
        version: "1.0.0",
        name: "Pinned Helper",
        description: "Pinned helper.",
        instructions: "pinned helper v1",
        permissions: ["read"],
        channels: ["web"],
        risk_level: "low"
      },
      {
        source_id: "fixture-test",
        package_id: "pinned-helper",
        skill_id: "pinned-helper",
        version: "2.0.0",
        name: "Pinned Helper",
        description: "Pinned helper v2.",
        instructions: "pinned helper v2",
        permissions: ["read"],
        channels: ["web"],
        risk_level: "low"
      }
    ]
  };
}

function createMarketplaceReasoner() {
  let step = 0;
  return {
    name: "skill-marketplace-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "skill-marketplace-reasoner",
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "Install and enable marketplace skill." }
      }];
    },
    async respond(ctx) {
      if (step === 0) {
        step += 1;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Install skill",
          tool_name: "skill_marketplace_install",
          tool_args: {
            source_id: "fixture",
            package_id: "briefing-writer",
            version: "1.0.0",
            enabled: false,
            actor_id: "operator"
          },
          side_effect_level: "medium"
        }];
      }
      if (step === 1) {
        step += 1;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Enable skill",
          tool_name: "skill_marketplace_enable",
          tool_args: {
            skill_id: "briefing-writer",
            actor_id: "operator"
          },
          side_effect_level: "medium"
        }];
      }
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Return skill result",
        description: "Marketplace skill briefing-writer installed and enabled.",
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function findToolObservations(session, toolName) {
  return session.getTraceRecords().filter((candidate) =>
    candidate.selected_action?.tool_name === toolName &&
    candidate.observation?.status === "success"
  );
}
