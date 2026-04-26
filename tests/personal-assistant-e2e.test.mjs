import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { SqlitePersonalMemoryStore } from "../examples/personal-assistant/dist/memory/sqlite-personal-memory-store.js";

test("personal assistant can call web_search and answer with the observation", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-e2e-"));
  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "personal-assistant-test.sqlite"),
      tenant_id: "test-tenant",
      reasoner: createSearchReasoner(),
      connectors: {
        search: {
          baseUrl: "https://example.test/search",
          fetch: async () =>
            new Response(
              JSON.stringify({
                web: {
                  results: [
                    {
                      title: "NeuroCore",
                      url: "https://example.test/neurocore",
                      description: "A structured agent runtime."
                    }
                  ]
                }
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" }
              }
            )
        },
        browser: {}
      }
    });

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "test-tenant",
      initial_input: {
        content: "search for NeuroCore"
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /NeuroCore/);
    assert.match(result.outputText ?? "", /structured agent runtime/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant recalls corrected explicit memories through the recall bundle", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-memory-e2e-"));
  const memoryStore = new SqlitePersonalMemoryStore({ filename: join(tempDir, "personal-memory.sqlite") });

  try {
    const stale = memoryStore.remember({
      user_id: "canonical-user",
      content: "User does not drink coffee.",
      created_at: "2026-04-25T00:00:00.000Z"
    });
    memoryStore.correct(
      "canonical-user",
      stale.memory_id,
      "User can drink decaf coffee.",
      undefined,
      "2026-04-26T00:00:00.000Z"
    );

    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "personal-assistant-test.sqlite"),
      tenant_id: "test-tenant",
      reasoner: createPersonalMemoryReasoner()
    }, {
      personalMemoryStore: memoryStore
    });

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "test-tenant",
      user_id: "canonical-user",
      initial_input: {
        content: "Recommend a drink.",
        metadata: {
          canonical_user_id: "canonical-user"
        }
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /decaf coffee/);
    assert.doesNotMatch(result.outputText ?? "", /does not drink coffee/);
  } finally {
    memoryStore.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createSearchReasoner() {
  return {
    name: "search-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "search-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Search first, then summarize." }
        }
      ];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";

      if (input.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return search result",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Search the web",
          tool_name: "web_search",
          tool_args: {
            query: input,
            max_results: 1
          },
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function createPersonalMemoryReasoner() {
  return {
    name: "personal-memory-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "personal-memory-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Answer from personal memory recall bundle." }
        }
      ];
    },
    async respond(ctx) {
      const bundle = ctx.runtime_state.memory_recall_bundle &&
        typeof ctx.runtime_state.memory_recall_bundle === "object"
        ? ctx.runtime_state.memory_recall_bundle
        : {};
      const proposals = Array.isArray(bundle.proposals) ? bundle.proposals : [];
      const personalMemories = proposals.flatMap((proposal) => {
        const payload = proposal && typeof proposal === "object" ? proposal.payload : undefined;
        return payload && Array.isArray(payload.personal_memories) ? payload.personal_memories : [];
      });
      const content = personalMemories.map((memory) => memory.content).join(" | ");

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Return personal memory",
          description: content,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
