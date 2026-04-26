import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { SqliteSessionSearchStore } from "../examples/personal-assistant/dist/memory/session-search-store.js";

test("session search supports keyword, semantic text, time filters and provenance", { concurrency: false }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-session-search-"));
  const store = new SqliteSessionSearchStore({ filename: join(tempDir, "session-search.sqlite") });

  try {
    const coffee = store.addEntry({
      tenant_id: "tenant-memory",
      user_id: "user-a",
      session_id: "ses-alpha",
      cycle_id: "cyc-alpha",
      trace_id: "trc-alpha",
      role: "assistant",
      content: "User can drink decaf coffee after lunch.",
      created_at: "2026-04-24T08:00:00.000Z",
      source_platform: "web",
      source_chat_id: "chat-a",
      source_message_id: "msg-coffee",
      metadata: { topic: "preference" }
    });
    store.addEntry({
      tenant_id: "tenant-memory",
      user_id: "user-b",
      session_id: "ses-beta",
      role: "assistant",
      content: "User-b prefers strong coffee.",
      created_at: "2026-04-25T08:00:00.000Z",
      source_platform: "slack",
      source_chat_id: "chat-b",
      source_message_id: "msg-other-user"
    });
    store.addEntry({
      tenant_id: "tenant-memory",
      user_id: "user-a",
      session_id: "ses-old",
      role: "assistant",
      content: "Very old coffee note.",
      created_at: "2026-04-20T08:00:00.000Z"
    });

    const keywordResults = store.search({
      tenant_id: "tenant-memory",
      user_id: "user-a",
      query: "coffee",
      start_at: "2026-04-23T00:00:00.000Z",
      end_at: "2026-04-25T00:00:00.000Z",
      limit: 5
    });
    assert.equal(keywordResults.length, 1);
    assert.equal(keywordResults[0].entry_id, coffee.entry_id);
    assert.ok(keywordResults[0].match_reasons.includes("keyword"));
    assert.equal(keywordResults[0].provenance.session_id, "ses-alpha");
    assert.equal(keywordResults[0].provenance.cycle_id, "cyc-alpha");
    assert.equal(keywordResults[0].provenance.trace_id, "trc-alpha");
    assert.equal(keywordResults[0].provenance.source_message_id, "msg-coffee");

    const semanticResults = store.search({
      tenant_id: "tenant-memory",
      user_id: "user-a",
      semantic_text: "decaf drink",
      limit: 5
    });
    assert.equal(semanticResults[0].entry_id, coffee.entry_id);
    assert.ok(semanticResults[0].match_reasons.includes("semantic"));

    const filteredOut = store.search({
      tenant_id: "tenant-memory",
      user_id: "user-a",
      query: "coffee",
      start_at: "2026-04-25T00:00:00.000Z",
      limit: 5
    });
    assert.equal(filteredOut.length, 0);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session search recall provider injects hybrid results with provenance into the recall bundle", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-session-search-bundle-"));
  const store = new SqliteSessionSearchStore({ filename: join(tempDir, "session-search.sqlite") });

  try {
    store.addEntry({
      tenant_id: "tenant-memory",
      user_id: "canonical-user",
      session_id: "ses-atlantis",
      cycle_id: "cyc-atlantis",
      trace_id: "trc-atlantis",
      role: "assistant",
      content: "The Atlantis draft used blue heron as the release codename.",
      created_at: "2026-04-24T08:00:00.000Z",
      source_platform: "telegram",
      source_chat_id: "chat-atlantis",
      source_message_id: "msg-atlantis"
    });
    store.addEntry({
      tenant_id: "tenant-memory",
      user_id: "other-user",
      session_id: "ses-other",
      role: "assistant",
      content: "The Atlantis draft belongs to another user.",
      created_at: "2026-04-25T08:00:00.000Z",
      source_platform: "telegram",
      source_chat_id: "chat-other",
      source_message_id: "msg-other"
    });

    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "tenant-memory",
      reasoner: createSessionSearchReasoner()
    }, {
      sessionSearchStore: store
    });

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-memory",
      user_id: "canonical-user",
      initial_input: {
        content: "What was the Atlantis draft release codename?",
        metadata: {
          canonical_user_id: "canonical-user"
        }
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /blue heron/);
    assert.match(result.outputText ?? "", /ses-atlantis/);
    assert.match(result.outputText ?? "", /msg-atlantis/);
    assert.doesNotMatch(result.outputText ?? "", /another user/);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createSessionSearchReasoner() {
  return {
    name: "session-search-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "session-search-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Answer from session search recall bundle." }
        }
      ];
    },
    async respond(ctx) {
      const bundle = ctx.runtime_state.memory_recall_bundle &&
        typeof ctx.runtime_state.memory_recall_bundle === "object"
        ? ctx.runtime_state.memory_recall_bundle
        : {};
      const proposals = Array.isArray(bundle.proposals) ? bundle.proposals : [];
      const results = proposals.flatMap((proposal) => {
        const payload = proposal && typeof proposal === "object" ? proposal.payload : undefined;
        return payload && Array.isArray(payload.session_search_results)
          ? payload.session_search_results
          : [];
      });
      const text = results.map((result) =>
        [
          result.content,
          result.provenance?.session_id,
          result.provenance?.source_message_id
        ].filter(Boolean).join(" | ")
      ).join("\n");

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Return session search memory",
          description: text,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
