import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPersonalAssistantAgent,
  startPersonalAssistantApp
} from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { AgentProfileRegistry } from "../examples/personal-assistant/dist/im-gateway/conversation/agent-profile-store.js";
import { SqliteAgentProfileStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-agent-profile-store.js";
import { SqlitePlatformUserLinkStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-platform-user-link-store.js";
import { SqlitePersonalMemoryStore } from "../examples/personal-assistant/dist/memory/sqlite-personal-memory-store.js";
import {
  createPersonalAssistantMigrationTools,
  PersonalAssistantMigrationImporter
} from "../examples/personal-assistant/dist/migration/openclaw-hermes-migration.js";
import { PersonalProfileProductService } from "../examples/personal-assistant/dist/profiles/profile-product-service.js";
import { AgentSkillRegistry } from "../examples/personal-assistant/dist/skills/agent-skill-registry.js";

test("OpenClaw migration dry-run maps all objects, reports duplicates and does not write", () => {
  const fixture = createMigrationFixture("openclaw");

  try {
    writeOpenClawHome(fixture.homeDir);
    const report = fixture.importer.run({
      home_dir: fixture.homeDir,
      source: "openclaw",
      canonical_user_id: "canonical-user",
      actor_id: "operator",
      dry_run: true
    });

    assert.equal(report.dry_run, true);
    assert.equal(report.source, "openclaw");
    assert.equal(report.counts.persona, 1);
    assert.equal(report.counts.memory, 2);
    assert.equal(report.counts.skill, 1);
    assert.equal(report.counts.allowlist, 1);
    assert.equal(report.counts.channel, 1);
    assert.equal(report.counts.api_key_ref, 1);
    assert.equal(report.counts.workspace_instruction, 1);
    assert.equal(report.duplicates.length, 1);
    assert.equal(report.duplicates[0].object_type, "memory");
    assert.equal(fixture.memoryStore.listActive("canonical-user", 10).length, 0);
    assert.equal(fixture.skillRegistry.getSkill("openclaw-report"), undefined);
    assert.equal(fixture.userLinkStore.resolveCanonicalUserId("telegram", "tg-user"), undefined);
    assert.equal(fixture.userLinkStore.getHomeChannel("canonical-user"), undefined);
    assert.throws(() => fixture.profileService.inspectProfile("openclaw-work"), /Unknown profile/);
    assert.equal(report.rollback_artifact, undefined);
  } finally {
    fixture.close();
  }
});

test("OpenClaw real migration imports queryable profile memory skills identity and rollback artifact", () => {
  const fixture = createMigrationFixture("openclaw-real");

  try {
    writeOpenClawHome(fixture.homeDir);
    const report = fixture.importer.run({
      home_dir: fixture.homeDir,
      source: "openclaw",
      canonical_user_id: "canonical-user",
      actor_id: "operator",
      dry_run: false
    });

    assert.equal(report.dry_run, false);
    assert.equal(report.actions.filter((action) => action.status === "imported").length, 6);
    assert.equal(report.actions.filter((action) => action.status === "duplicate").length, 1);
    assert.equal(report.actions.find((action) => action.object_type === "api_key_ref").status, "skipped");
    assert.ok(report.rollback_artifact);
    assert.equal(report.rollback_artifact.reversible, true);
    assert.ok(report.rollback_artifact.operations.length >= 4);
    assert.equal(fixture.profileService.inspectProfile("openclaw-work").profile.metadata.imported_from, "openclaw");
    assert.deepEqual(fixture.memoryStore.listActive("canonical-user", 10).map((memory) => memory.content), [
      "I prefer concise Chinese replies."
    ]);
    assert.equal(fixture.skillRegistry.getSkill("openclaw-report").name, "OpenClaw Report");
    assert.equal(fixture.userLinkStore.resolveCanonicalUserId("telegram", "tg-user"), "canonical-user");
    assert.equal(fixture.userLinkStore.getHomeChannel("canonical-user").chat_id, "web-home");
  } finally {
    fixture.close();
  }
});

test("Hermes migration maps nested persona memory secrets and workspace instructions", () => {
  const fixture = createMigrationFixture("hermes");

  try {
    writeHermesHome(fixture.homeDir);
    const dryRun = fixture.importer.run({
      home_dir: fixture.homeDir,
      source: "hermes",
      canonical_user_id: "canonical-user",
      actor_id: "operator",
      dry_run: true
    });
    assert.equal(dryRun.source, "hermes");
    assert.equal(dryRun.counts.persona, 1);
    assert.equal(dryRun.counts.memory, 1);
    assert.equal(dryRun.counts.skill, 1);
    assert.equal(dryRun.counts.api_key_ref, 1);
    assert.equal(dryRun.counts.workspace_instruction, 1);
    assert.equal(fixture.skillRegistry.getSkill("hermes-planner"), undefined);

    const imported = fixture.importer.run({
      home_dir: fixture.homeDir,
      source: "hermes",
      canonical_user_id: "canonical-user",
      actor_id: "operator",
      dry_run: false
    });
    assert.equal(imported.actions.find((action) => action.object_type === "api_key_ref").status, "skipped");
    assert.equal(fixture.profileService.inspectProfile("hermes-default").profile.display_name, "Hermes Default");
    assert.equal(fixture.memoryStore.listActive("canonical-user", 10)[0].content, "The user prefers short daily plans.");
    assert.equal(fixture.skillRegistry.getSkill("hermes-planner").enabled, true);
    assert.equal(fixture.userLinkStore.resolveCanonicalUserId("slack", "slack-user"), "canonical-user");
    assert.equal(fixture.userLinkStore.getHomeChannel("canonical-user").platform, "slack");
    assert.ok(imported.rollback_artifact.operations.some((operation) => operation.object_type === "skill"));
  } finally {
    fixture.close();
  }
});

test("migration tools expose dry-run and import entry points", async () => {
  const fixture = createMigrationFixture("tools");

  try {
    writeOpenClawHome(fixture.homeDir);
    const tools = new Map(createPersonalAssistantMigrationTools(fixture.importer).map((tool) => [tool.name, tool]));
    const ctx = { tenant_id: "tenant-migration", session_id: "session-migration", cycle_id: "cycle-migration" };
    const dryRun = await tools.get("personal_migration_dry_run").invoke({
      home_dir: fixture.homeDir,
      source: "openclaw",
      canonical_user_id: "canonical-user",
      actor_id: "operator"
    }, ctx);
    assert.match(dryRun.summary, /Dry-run openclaw migration/);
    assert.equal(dryRun.payload.report.dry_run, true);
    assert.equal(fixture.memoryStore.listActive("canonical-user", 10).length, 0);

    const imported = await tools.get("personal_migration_import").invoke({
      home_dir: fixture.homeDir,
      source: "openclaw",
      canonical_user_id: "canonical-user",
      actor_id: "operator"
    }, ctx);
    assert.match(imported.summary, /Imported openclaw migration/);
    assert.ok(imported.payload.report.rollback_artifact);
    assert.equal(fixture.skillRegistry.getSkill("openclaw-report").id, "openclaw-report");
  } finally {
    fixture.close();
  }
});

test("personal assistant app registers migration importer and migration tools", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-migration-app-"));
  const app = await startPersonalAssistantApp({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-migration",
    reasoner: createReasoner(),
    web_chat: {
      enabled: false
    }
  });

  try {
    assert.ok(app.migrationImporter);
    assert.ok(app.builder.getProfile().tool_refs.includes("personal_migration_dry_run"));
    assert.ok(app.builder.getProfile().tool_refs.includes("personal_migration_import"));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createMigrationFixture(label) {
  const tempDir = mkdtempSync(join(tmpdir(), `personal-assistant-migration-${label}-`));
  const dbPath = join(tempDir, "assistant.sqlite");
  const homeDir = join(tempDir, "home");
  mkdirSync(homeDir);
  const memoryStore = new SqlitePersonalMemoryStore({ filename: dbPath });
  const skillRegistry = new AgentSkillRegistry();
  const profileStore = new SqliteAgentProfileStore({ filename: dbPath });
  const builder = createPersonalAssistantAgent({
    db_path: dbPath,
    tenant_id: "tenant-migration",
    reasoner: createReasoner()
  });
  const profileRegistry = new AgentProfileRegistry({ store: profileStore, defaultProfileId: "default" });
  const profileService = new PersonalProfileProductService({
    registry: profileRegistry,
    store: profileStore,
    builder,
    tenantId: "tenant-migration",
    agentId: "personal-assistant",
    defaultProfileId: "default",
    now: () => "2026-04-27T19:30:00.000Z"
  });
  profileService.ensureDefaultProfile();
  const userLinkStore = new SqlitePlatformUserLinkStore({ filename: dbPath });
  const importer = new PersonalAssistantMigrationImporter({
    memoryStore,
    skillRegistry,
    profileService,
    userLinkStore,
    tenantId: "tenant-migration",
    agentId: "personal-assistant"
  });

  return {
    tempDir,
    dbPath,
    homeDir,
    memoryStore,
    skillRegistry,
    profileStore,
    profileService,
    userLinkStore,
    importer,
    close() {
      memoryStore.close();
      profileStore.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function writeOpenClawHome(homeDir) {
  writeFileSync(join(homeDir, "openclaw.json"), JSON.stringify({
    persona: {
      profile_id: "openclaw-work",
      display_name: "OpenClaw Work",
      instructions: "Prefer direct, concise Chinese replies."
    },
    memories: [
      {
        id: "oc-memory-1",
        content: "I prefer concise Chinese replies.",
        created_at: "2026-04-27T18:00:00.000Z"
      },
      {
        id: "oc-memory-2",
        content: "I prefer concise Chinese replies.",
        created_at: "2026-04-27T18:01:00.000Z"
      }
    ],
    skills: [
      {
        id: "openclaw-report",
        name: "OpenClaw Report",
        description: "Draft concise status reports.",
        instructions: "Write a concise report.",
        permissions: ["read"],
        risk_level: "low"
      }
    ],
    allowlist: [
      {
        platform: "telegram",
        sender_id: "tg-user"
      }
    ],
    channels: [
      {
        platform: "web",
        chat_id: "web-home",
        sender_id: "web-user",
        home: true,
        channel_kind: "web"
      }
    ],
    api_key_refs: [
      {
        name: "search",
        ref: "secret://openclaw/search",
        scope: "tool:web_search"
      }
    ],
    workspace_instructions: "Use the project workspace."
  }, null, 2));
}

function writeHermesHome(homeDir) {
  writeFileSync(join(homeDir, "hermes-agent.json"), JSON.stringify({
    agent: {
      persona: {
        profile_id: "hermes-default",
        display_name: "Hermes Default",
        instructions: "Plan before acting."
      }
    },
    memory: [
      {
        id: "hermes-memory-1",
        content: "The user prefers short daily plans."
      }
    ],
    skills: [
      {
        id: "hermes-planner",
        name: "Hermes Planner",
        description: "Plan tasks.",
        instructions: "Create a daily plan.",
        permissions: ["read", "write"],
        risk_level: "medium",
        enabled: true
      }
    ],
    allowlist: [
      {
        platform: "slack",
        sender_id: "slack-user"
      }
    ],
    channels: [
      {
        platform: "slack",
        chat_id: "slack-home",
        sender_id: "slack-user",
        home: true,
        channel_kind: "im"
      }
    ],
    secrets: [
      {
        name: "calendar",
        ref: "secret://hermes/calendar",
        scope: "tool:calendar"
      }
    ],
    workspace: {
      instructions: "Keep workspace changes reversible."
    }
  }, null, 2));
}

function createReasoner() {
  return {
    name: "migration-test-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "migration-test-reasoner",
        proposal_type: "plan",
        salience_score: 0.5,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "migration test" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "migration",
        description: "migration test",
        side_effect_level: "none"
      }];
    }
  };
}
