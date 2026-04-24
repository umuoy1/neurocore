import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteSemanticMemoryStore } from "@neurocore/memory-core";

function ts() {
  return new Date().toISOString();
}

function makeEpisode(id, sessionId = "ses_semantic") {
  return {
    episode_id: id,
    schema_version: "1.0.0",
    session_id: sessionId,
    trigger_summary: "need semantic memory",
    goal_refs: [],
    context_digest: "semantic context",
    selected_strategy: "Call tool: echo",
    action_refs: ["act_1"],
    observation_refs: ["obs_1"],
    outcome: "success",
    outcome_summary: "echoed",
    created_at: ts(),
    metadata: {
      action_type: "call_tool",
      tool_name: "echo"
    }
  };
}

test("semantic cards preserve lifecycle state across SQLite snapshot restore", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-semantic-card-"));
  try {
    const store = new SqliteSemanticMemoryStore({
      filename: join(stateDir, "memory.db")
    });

    store.replaceSession("ses_semantic", "tenant_memory", [
      makeEpisode("epi_1"),
      makeEpisode("epi_2")
    ], true);

    const touched = store.markCardsByEpisodeIds("tenant_memory", ["epi_1"], {
      status: "suspect",
      reason: "contaminated source",
      marked_at: ts()
    });
    assert.equal(touched.length, 1);

    const snapshot = store.buildSnapshot("ses_semantic");
    assert.equal(snapshot.cards?.[0]?.lifecycle_state?.status, "suspect");

    const restored = new SqliteSemanticMemoryStore({
      filename: join(stateDir, "memory-restored.db")
    });
    restored.restoreSnapshot("ses_semantic", "tenant_memory", snapshot);

    const cards = restored.buildSnapshot("ses_semantic").cards ?? [];
    assert.equal(cards.length, 1);
    assert.equal(cards[0].lifecycle_state?.status, "suspect");

    store.close();
    restored.close();
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
