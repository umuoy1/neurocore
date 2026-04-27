import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPersonalAssistantBackupTools,
  PersonalAssistantBackupService,
  SqlitePersonalMemoryStore,
  startPersonalAssistantApp
} from "../examples/personal-assistant/dist/main.js";

test("encrypted backup restores into a fresh HOME and reports restore conflicts", async () => {
  const fixture = createBackupFixture("restore");

  try {
    const report = fixture.service.createBackup({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase,
      source: fixture.source
    });

    assert.equal(report.encrypted, true);
    assert.ok(report.manifest.files.some((file) => file.kind === "sqlite"));
    assert.ok(report.manifest.files.some((file) => file.kind === "config"));
    assert.ok(report.manifest.files.some((file) => file.kind === "artifact"));
    assert.ok(report.manifest.files.some((file) => file.kind === "skill"));

    const rawBackup = readFileSync(fixture.localBackupPath, "utf8");
    assert.doesNotMatch(rawBackup, /sk-live-backup-secret/);
    assert.doesNotMatch(rawBackup, /alice@example\.com/);
    assert.doesNotMatch(rawBackup, /private memory from backup/);
    assert.match(rawBackup, /personal-assistant-backup\.encrypted\.v1/);

    const manifest = fixture.service.readManifest({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase
    });
    assert.equal(manifest.backup_id, report.backup_id);
    assert.equal(manifest.file_count, report.manifest.file_count);

    const dryRunTarget = join(fixture.tempDir, "dry-run-home");
    const dryRun = fixture.service.restoreBackup({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase,
      target_home_dir: dryRunTarget,
      dry_run: true
    });
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.conflict_count, 0);
    assert.ok(dryRun.files.every((file) => file.status === "would_create"));
    assert.equal(existsSync(join(dryRunTarget, ".neurocore", ".personal-assistant", "app.local.json")), false);

    const restoreTarget = join(fixture.tempDir, "fresh-home");
    const restored = fixture.service.restoreBackup({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase,
      target_home_dir: restoreTarget
    });
    assert.equal(restored.conflict_count, 0);
    assert.ok(restored.restored_count >= 4);
    assert.match(readFileSync(join(restoreTarget, ".neurocore", ".personal-assistant", "app.local.json"), "utf8"), /sk-live-backup-secret/);
    assert.match(readFileSync(join(restoreTarget, ".neurocore", "artifacts", "brief.txt"), "utf8"), /alice@example\.com/);
    assert.match(readFileSync(join(restoreTarget, "skills", "daily-summary", "SKILL.md"), "utf8"), /Daily Summary/);

    const restoredMemoryStore = new SqlitePersonalMemoryStore({
      filename: join(restoreTarget, ".neurocore", "personal-assistant.sqlite")
    });
    try {
      assert.equal(restoredMemoryStore.listActive("backup-user", 10)[0].content, "private memory from backup");
    } finally {
      restoredMemoryStore.close();
    }

    const restoredApp = await startPersonalAssistantApp({
      db_path: join(restoreTarget, ".neurocore", "personal-assistant.sqlite"),
      tenant_id: "tenant-backup-restored",
      reasoner: createReasoner(),
      web_chat: {
        enabled: false
      }
    });
    try {
      assert.ok(restoredApp.builder.getProfile().tool_refs.includes("personal_backup_create"));
    } finally {
      await restoredApp.close();
    }

    writeFileSync(join(restoreTarget, ".neurocore", ".personal-assistant", "app.local.json"), "{\"changed\":true}\n");
    const conflict = fixture.service.restoreBackup({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase,
      target_home_dir: restoreTarget
    });
    assert.equal(conflict.conflict_count, 1);
    assert.equal(conflict.conflicts[0].resolution, "manual_required");
    assert.match(conflict.conflicts[0].message, /merge manually/);
    assert.match(conflict.conflicts[0].path, /app\.local\.json/);
  } finally {
    fixture.close();
  }
});

test("backup tools create readable sync conflict reports without exposing backup plaintext", async () => {
  const fixture = createBackupFixture("tools");

  try {
    const tools = new Map(createPersonalAssistantBackupTools(fixture.service).map((tool) => [tool.name, tool]));
    const ctx = { tenant_id: "tenant-backup", session_id: "session-backup", cycle_id: "cycle-backup" };
    const created = await tools.get("personal_backup_create").invoke({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase,
      home_dir: fixture.homeDir,
      db_path: fixture.dbPath,
      config_paths: [fixture.configPath],
      artifact_paths: [fixture.artifactPath],
      skill_paths: [fixture.skillPath]
    }, ctx);
    assert.match(created.summary, /Created encrypted backup/);
    assert.equal(created.payload.report.encrypted, true);

    writeFileSync(fixture.configPath, JSON.stringify({
      openai: {
        bearerToken: "sk-live-remote-secret"
      }
    }, null, 2));
    await tools.get("personal_backup_create").invoke({
      backup_path: fixture.remoteBackupPath,
      passphrase: fixture.passphrase,
      home_dir: fixture.homeDir,
      db_path: fixture.dbPath,
      config_paths: [fixture.configPath],
      artifact_paths: [fixture.artifactPath],
      skill_paths: [fixture.skillPath]
    }, ctx);

    const manifest = await tools.get("personal_backup_manifest").invoke({
      backup_path: fixture.localBackupPath,
      passphrase: fixture.passphrase
    }, ctx);
    assert.equal(manifest.payload.manifest.schema_version, "personal-assistant-backup.manifest.v1");

    const sync = await tools.get("personal_backup_sync_report").invoke({
      local_backup_path: fixture.localBackupPath,
      remote_backup_path: fixture.remoteBackupPath,
      passphrase: fixture.passphrase
    }, ctx);
    assert.match(sync.summary, /manual review/);
    assert.equal(sync.payload.report.conflict_count, 1);
    assert.equal(sync.payload.report.conflicts[0].resolution, "manual_review_required");
    assert.match(sync.payload.report.conflicts[0].message, /local backup/);

    const rawRemoteBackup = readFileSync(fixture.remoteBackupPath, "utf8");
    assert.doesNotMatch(rawRemoteBackup, /sk-live-remote-secret/);
  } finally {
    fixture.close();
  }
});

test("personal assistant app registers encrypted backup service and tools", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-backup-app-"));
  const app = await startPersonalAssistantApp({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-backup",
    reasoner: createReasoner(),
    web_chat: {
      enabled: false
    }
  });

  try {
    assert.ok(app.backupService);
    assert.ok(app.builder.getProfile().tool_refs.includes("personal_backup_create"));
    assert.ok(app.builder.getProfile().tool_refs.includes("personal_backup_restore"));
    assert.ok(app.builder.getProfile().tool_refs.includes("personal_backup_sync_report"));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createBackupFixture(label) {
  const tempDir = mkdtempSync(join(tmpdir(), `personal-assistant-backup-${label}-`));
  const homeDir = join(tempDir, "home");
  const configDir = join(homeDir, ".neurocore", ".personal-assistant");
  const artifactDir = join(homeDir, ".neurocore", "artifacts");
  const skillDir = join(homeDir, "skills", "daily-summary");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(skillDir, { recursive: true });

  const dbPath = join(homeDir, ".neurocore", "personal-assistant.sqlite");
  const configPath = join(configDir, "app.local.json");
  const artifactPath = join(artifactDir, "brief.txt");
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(configPath, JSON.stringify({
    openai: {
      bearerToken: "sk-live-backup-secret"
    },
    profile: "work"
  }, null, 2));
  writeFileSync(artifactPath, "Send the brief to alice@example.com\n");
  writeFileSync(skillPath, "# Daily Summary\n\nSummarize daily work.\n");

  const memoryStore = new SqlitePersonalMemoryStore({ filename: dbPath });
  memoryStore.remember({
    user_id: "backup-user",
    content: "private memory from backup",
    source: {
      message_id: "backup-message"
    }
  });
  memoryStore.close();

  const service = createService();
  const source = {
    home_dir: homeDir,
    db_path: dbPath,
    config_paths: [configPath],
    artifact_paths: [artifactPath],
    skill_paths: [skillPath],
    metadata: {
      profile: "work"
    }
  };

  return {
    tempDir,
    homeDir,
    dbPath,
    configPath,
    artifactPath,
    skillPath,
    localBackupPath: join(tempDir, "local-backup.ncab"),
    remoteBackupPath: join(tempDir, "remote-backup.ncab"),
    passphrase: "correct horse battery staple",
    service,
    source,
    close() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createService() {
  let counter = 0;
  return new PersonalAssistantBackupService({
    now: () => "2026-04-27T20:00:00.000Z",
    generateId: (prefix) => `${prefix}_${++counter}`
  });
}

function createReasoner() {
  return {
    name: "backup-test-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "backup-test-reasoner",
        proposal_type: "plan",
        salience_score: 0.5,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "backup test" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "backup",
        description: "backup test",
        side_effect_level: "none"
      }];
    }
  };
}
