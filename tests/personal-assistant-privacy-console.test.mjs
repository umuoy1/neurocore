import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PersonalDataSubjectService,
  PersonalMemoryRecallProvider,
  SqlitePersonalMemoryStore,
  SqliteSessionSearchStore
} from "../examples/personal-assistant/dist/main.js";

test("data subject service exports freezes and deletes personal assistant data", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-privacy-"));
  const dbPath = join(tempDir, "assistant.sqlite");
  const memoryStore = new SqlitePersonalMemoryStore({ filename: dbPath });
  const sessionSearchStore = new SqliteSessionSearchStore({ filename: dbPath });
  const userId = "user-privacy";
  let tick = 0;
  const privacy = new PersonalDataSubjectService({
    memoryStore,
    sessionSearchStore,
    now: () => `2026-04-28T02:00:${String(tick++).padStart(2, "0")}.000Z`,
    records: [
      {
        record_id: "artifact-secret",
        type: "artifact",
        user_id: userId,
        status: "active",
        payload: { content: "artifact secret alice@example.com" },
        created_at: "2026-04-28T01:59:00.000Z",
        updated_at: "2026-04-28T01:59:00.000Z"
      }
    ]
  });

  try {
    const memoryA = memoryStore.remember({
      user_id: userId,
      content: "User likes privacy reviews.",
      created_at: "2026-04-28T01:59:01.000Z"
    });
    const memoryB = memoryStore.remember({
      user_id: userId,
      content: "User email is alice@example.com.",
      created_at: "2026-04-28T01:59:02.000Z"
    });
    const traceEntry = sessionSearchStore.addEntry({
      tenant_id: "tenant-privacy",
      user_id: userId,
      session_id: "sess-privacy",
      trace_id: "trace-secret",
      role: "assistant",
      content: "trace secret payload",
      created_at: "2026-04-28T01:59:03.000Z"
    });
    const toolEntry = sessionSearchStore.addEntry({
      tenant_id: "tenant-privacy",
      user_id: userId,
      session_id: "sess-privacy",
      trace_id: "trace-tool",
      role: "tool",
      content: "tool secret payload",
      created_at: "2026-04-28T01:59:04.000Z",
      metadata: { tool_name: "web_search" }
    });

    const exported = privacy.exportUserData({ user_id: userId, actor_id: "operator", tenant_id: "tenant-privacy" });
    assert.equal(exported.records.some((record) => record.type === "memory" && record.record_id === memoryA.memory_id), true);
    assert.equal(exported.records.some((record) => record.type === "trace" && record.record_id === "trace-secret"), true);
    assert.equal(exported.records.some((record) => record.type === "tool" && record.record_id === toolEntry.entry_id), true);
    assert.equal(exported.records.some((record) => record.type === "artifact" && record.record_id === "artifact-secret"), true);
    assert.equal(exported.retention.records.memory.active, 2);

    privacy.freezeUserData({
      user_id: userId,
      actor_id: "operator",
      types: ["memory"],
      record_ids: [memoryA.memory_id],
      tenant_id: "tenant-privacy"
    });
    assert.deepEqual(memoryStore.listActive(userId, 10).map((memory) => memory.memory_id), [memoryB.memory_id]);
    assert.equal(privacy.exportUserData({ user_id: userId, actor_id: "operator" }).records.find((record) => record.record_id === memoryA.memory_id)?.status, "frozen");

    privacy.deleteUserData({
      user_id: userId,
      actor_id: "operator",
      types: ["trace"],
      record_ids: [traceEntry.trace_id],
      tenant_id: "tenant-privacy"
    });
    privacy.deleteUserData({
      user_id: userId,
      actor_id: "operator",
      types: ["tool"],
      record_ids: [toolEntry.entry_id],
      tenant_id: "tenant-privacy"
    });
    privacy.deleteUserData({
      user_id: userId,
      actor_id: "operator",
      types: ["artifact"],
      record_ids: ["artifact-secret"]
    });
    privacy.deleteUserData({
      user_id: userId,
      actor_id: "operator",
      types: ["memory"],
      record_ids: [memoryB.memory_id]
    });

    assert.equal(sessionSearchStore.search({ tenant_id: "tenant-privacy", user_id: userId, query: "trace secret", limit: 5 }).length, 0);
    assert.equal(sessionSearchStore.search({ tenant_id: "tenant-privacy", user_id: userId, query: "tool secret", limit: 5 }).length, 0);
    assert.equal(memoryStore.listActive(userId, 10).length, 0);

    const recall = new PersonalMemoryRecallProvider(memoryStore);
    const proposals = await recall.retrieve({
      tenant_id: "tenant-privacy",
      profile: { schema_version: "test" },
      session: { session_id: "sess-privacy", current_cycle_id: "cycle-privacy" },
      services: { generateId: (prefix) => `${prefix}_test` },
      runtime_state: {
        current_input_metadata: { canonical_user_id: userId }
      },
      memory_config: { retrieval_top_k: 8 }
    });
    assert.equal(proposals.length, 0);

    const afterDelete = privacy.exportUserData({ user_id: userId, actor_id: "operator" });
    assert.equal(afterDelete.records.some((record) => record.record_id === "artifact-secret"), false);
    assert.equal(afterDelete.retention.records.memory.deleted, 1);
    assert.equal(afterDelete.retention.records.memory.frozen, 1);
    assert.equal(afterDelete.retention.records.trace.deleted, 1);
    assert.equal(afterDelete.retention.records.tool.deleted, 1);
    assert.equal(afterDelete.retention.records.artifact.deleted, 1);

    const auditJson = JSON.stringify(privacy.listAuditRecords(userId));
    assert.match(auditJson, /privacy\.exported/);
    assert.match(auditJson, /privacy\.frozen/);
    assert.match(auditJson, /privacy\.deleted/);
    assert.doesNotMatch(auditJson, /alice@example\.com|trace secret payload|tool secret payload|artifact secret/);
  } finally {
    memoryStore.close();
    sessionSearchStore.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("console exposes personal assistant privacy route and data subject actions", () => {
  const app = readFileSync("packages/console/src/App.tsx", "utf8");
  const layout = readFileSync("packages/console/src/components/layout/AppLayout.tsx", "utf8");
  const store = readFileSync("packages/console/src/stores/personalAssistantPrivacy.store.ts", "utf8");
  const page = readFileSync("packages/console/src/pages/PersonalAssistantPrivacyPage.tsx", "utf8");
  const types = readFileSync("packages/console/src/api/types.ts", "utf8");

  assert.match(app, /personal-assistant\/privacy/);
  assert.match(layout, /Assistant Privacy/);
  assert.match(store, /\/v1\/personal-assistant\/privacy\/users\/\$\{encodeURIComponent\(targetUserId\)\}\/retention/);
  assert.match(store, /\/export/);
  assert.match(store, /\/freeze/);
  assert.match(store, /\/delete/);
  assert.match(page, /Data subject export/);
  assert.match(page, /Freeze/);
  assert.match(page, /Delete/);
  assert.match(types, /DataSubjectRetentionReport/);
});
