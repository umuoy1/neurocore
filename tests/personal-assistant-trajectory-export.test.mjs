import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { exportPersonalAssistantSessionTrajectory } from "../examples/personal-assistant/dist/trajectory/trajectory-exporter.js";
import { SqlitePersonalMemoryStore } from "../examples/personal-assistant/dist/memory/sqlite-personal-memory-store.js";
import {
  buildPersonalAgentTrajectoryBenchmarkArtifact,
  replayPersonalAgentTrajectoryBenchmarkArtifact
} from "../packages/eval-core/dist/index.js";

test("personal assistant trajectory export redacts private data and builds deterministic benchmark artifacts", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-trajectory-"));
  const memoryStore = new SqlitePersonalMemoryStore({ filename: join(tempDir, "personal-memory.sqlite") });

  try {
    memoryStore.remember({
      user_id: "user-private-42",
      content: "User email is alice@example.com and API key sk-liveSECRET123456789.",
      created_at: "2026-04-27T00:00:00.000Z"
    });

    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "tenant-private",
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
                      title: "Trajectory Export",
                      url: "https://example.test/trajectory",
                      description: "A deterministic replay artifact."
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
    }, {
      personalMemoryStore: memoryStore
    });

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-private",
      user_id: "user-private-42",
      initial_input: {
        input_id: "input-private-1",
        content: "Search for alice@example.com using sk-liveSECRET123456789",
        created_at: "2026-04-27T00:00:00.000Z",
        metadata: {
          canonical_user_id: "user-private-42",
          chat_id: "chat-private-99",
          authorization: "Bearer private-token-123456789",
          source_message_id: "message-private-7"
        }
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");

    const trajectory = exportPersonalAssistantSessionTrajectory(session, {
      exportId: "trajectory-export-1",
      createdAt: "2026-04-27T01:00:00.000Z",
      channel: {
        platform: "web",
        chat_id: "chat-private-99"
      },
      identity: {
        sender_id: "user-private-42",
        email: "alice@example.com"
      },
      agentProfile: {
        profile_id: "work",
        memory_scope: "memory:work"
      },
      memoryRecords: memoryStore.listActive("user-private-42")
    });

    const serialized = JSON.stringify(trajectory);
    assert.doesNotMatch(serialized, /alice@example\.com/);
    assert.doesNotMatch(serialized, /sk-liveSECRET123456789/);
    assert.doesNotMatch(serialized, /private-token-123456789/);
    assert.doesNotMatch(serialized, /user-private-42/);
    assert.doesNotMatch(serialized, /chat-private-99/);
    assert.match(serialized, /\[REDACTED_EMAIL\]/);
    assert.match(serialized, /\[REDACTED_SECRET\]/);
    assert.match(serialized, /\[REDACTED_ID:0001\]/);

    assert.ok(trajectory.provenance.traces.length >= 2);
    assert.ok(trajectory.provenance.memory.some((item) => item.memory_refs.length > 0));
    assert.ok(trajectory.provenance.tools.some((item) => item.tool_name === "web_search"));
    assert.equal(trajectory.redaction.applied, true);
    assert.ok(trajectory.redaction.finding_count >= 5);
    assert.equal(trajectory.replay.deterministic, true);
    assert.equal(typeof trajectory.replay.trace_signature, "string");
    assert.equal(trajectory.replay.trace_signature.length, 64);

    const artifact = buildPersonalAgentTrajectoryBenchmarkArtifact([trajectory], {
      artifactId: "personal-agent-benchmark-1",
      createdAt: "2026-04-27T02:00:00.000Z"
    });
    assert.equal(artifact.cases.length, 1);
    assert.deepEqual(artifact.cases[0].tool_refs, ["web_search"]);
    assert.ok(artifact.cases[0].memory_refs.length >= 1);

    const firstReplay = replayPersonalAgentTrajectoryBenchmarkArtifact(artifact);
    const secondReplay = replayPersonalAgentTrajectoryBenchmarkArtifact(artifact);
    assert.deepEqual(secondReplay, firstReplay);
    assert.equal(firstReplay.passed_count, 1);
    assert.equal(firstReplay.failed_count, 0);
    assert.match(firstReplay.cases[0].final_output ?? "", /Trajectory Export/);

    memoryStore.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createSearchReasoner() {
  return {
    name: "trajectory-search-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "trajectory-search-reasoner",
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
