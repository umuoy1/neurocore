import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SqliteEpisodicMemoryStore,
  SqliteSemanticMemoryStore,
  SqliteWorkingMemoryStore
} from "@neurocore/memory-core";
import { SqliteSkillStore } from "@neurocore/runtime-core";

function createTempDb(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    directory,
    filename: join(directory, "memory.db")
  };
}

function cleanupTempDb(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function ts(offset = 0) {
  return new Date(Date.now() + offset).toISOString();
}

test("SqliteWorkingMemoryStore appends and trims entries", () => {
  const temp = createTempDb("neurocore-sqlite-working-");
  const store = new SqliteWorkingMemoryStore({
    filename: temp.filename,
    maxEntries: 2
  });

  try {
    store.append("ses_1", { memory_id: "mem_1", summary: "first", relevance: 0.8 });
    store.append("ses_1", { memory_id: "mem_2", summary: "second", relevance: 0.9 });
    store.append("ses_1", { memory_id: "mem_3", summary: "third", relevance: 1 });

    assert.deepEqual(
      store.list("ses_1").map((entry) => entry.memory_id),
      ["mem_2", "mem_3"]
    );
  } finally {
    store.close();
    cleanupTempDb(temp.directory);
  }
});

test("SqliteEpisodicMemoryStore stores session and tenant episodes", () => {
  const temp = createTempDb("neurocore-sqlite-episodic-");
  const store = new SqliteEpisodicMemoryStore({ filename: temp.filename });

  try {
    store.write("ses_1", "tenant_1", {
      episode_id: "epi_1",
      schema_version: "1.0.0",
      session_id: "ses_1",
      trigger_summary: "first trigger",
      goal_refs: [],
      context_digest: "first context",
      selected_strategy: "Search docs",
      action_refs: ["act_1"],
      observation_refs: ["obs_1"],
      outcome: "success",
      outcome_summary: "first success",
      metadata: { tool_name: "web_search", action_type: "call_tool" },
      created_at: ts()
    });
    store.write("ses_2", "tenant_1", {
      episode_id: "epi_2",
      schema_version: "1.0.0",
      session_id: "ses_2",
      trigger_summary: "second trigger",
      goal_refs: [],
      context_digest: "second context",
      selected_strategy: "Open page",
      action_refs: ["act_2"],
      observation_refs: ["obs_2"],
      outcome: "partial",
      outcome_summary: "second partial",
      metadata: { tool_name: "browser_open", action_type: "call_tool" },
      created_at: ts(1000)
    });

    assert.equal(store.list("ses_1").length, 1);
    assert.deepEqual(
      store.listByTenant("tenant_1", "ses_1").map((episode) => episode.episode_id),
      ["epi_2"]
    );
  } finally {
    store.close();
    cleanupTempDb(temp.directory);
  }
});

test("SqliteSemanticMemoryStore builds aggregated semantic records", () => {
  const temp = createTempDb("neurocore-sqlite-semantic-");
  const store = new SqliteSemanticMemoryStore({ filename: temp.filename });

  try {
    store.appendEpisode("ses_1", "tenant_1", {
      episode_id: "epi_1",
      schema_version: "1.0.0",
      session_id: "ses_1",
      trigger_summary: "trigger one",
      goal_refs: [],
      context_digest: "context one",
      selected_strategy: "Call tool: fetch_data",
      action_refs: ["act_1"],
      observation_refs: ["obs_1"],
      outcome: "success",
      outcome_summary: "first success",
      metadata: { tool_name: "fetch_data" },
      created_at: ts()
    });
    store.appendEpisode("ses_2", "tenant_1", {
      episode_id: "epi_2",
      schema_version: "1.0.0",
      session_id: "ses_2",
      trigger_summary: "trigger two",
      goal_refs: [],
      context_digest: "context two",
      selected_strategy: "Call tool: fetch_data",
      action_refs: ["act_2"],
      observation_refs: ["obs_2"],
      outcome: "success",
      outcome_summary: "second success",
      metadata: { tool_name: "fetch_data" },
      created_at: ts(1000)
    });

    const records = store.list("tenant_1");
    assert.equal(records.length, 1);
    assert.equal(records[0].occurrence_count, 2);
    assert.equal(records[0].summary, "second success");
  } finally {
    store.close();
    cleanupTempDb(temp.directory);
  }
});

test("SqliteSkillStore saves and matches skills by trigger", () => {
  const temp = createTempDb("neurocore-sqlite-skill-");
  const store = new SqliteSkillStore({ filename: temp.filename });

  try {
    store.save({
      skill_id: "sk_1",
      schema_version: "1.0.0",
      name: "Fetch docs",
      version: "1.0.0",
      kind: "toolchain_skill",
      trigger_conditions: [
        { field: "tool_name", operator: "eq", value: "web_search" },
        { field: "action_type", operator: "eq", value: "call_tool" }
      ],
      execution_template: {
        kind: "toolchain",
        tool_name: "web_search",
        action_type: "call_tool",
        default_args: { query: "neurocore" }
      },
      metadata: {
        tenant_id: "tenant_1",
        pattern_key: "web_search:fetch_docs"
      }
    });

    const matched = store.findByTrigger("tenant_1", {
      tool_name: "web_search",
      action_type: "call_tool"
    });

    assert.equal(matched.length, 1);
    assert.equal(matched[0].skill_id, "sk_1");
  } finally {
    store.close();
    cleanupTempDb(temp.directory);
  }
});
