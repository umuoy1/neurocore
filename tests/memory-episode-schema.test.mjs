import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteEpisodicMemoryStore } from "@neurocore/memory-core";
import { defineAgent } from "@neurocore/sdk-core";

function now() {
  return new Date().toISOString();
}

test("episodic sqlite store persists extended episode schema and activation trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "neurocore-episodic-schema-"));
  try {
    const store = new SqliteEpisodicMemoryStore({
      filename: join(dir, "episodic.db")
    });

    store.write("ses_ep", "tenant_ep", {
      episode_id: "epi_1",
      schema_version: "1.0.0",
      session_id: "ses_ep",
      trigger_summary: "draft a follow-up",
      goal_refs: ["goal_1"],
      plan_refs: ["plan_1"],
      context_digest: "follow-up context",
      selected_strategy: "Call tool: mailer",
      action_refs: ["act_1"],
      observation_refs: ["obs_1"],
      evidence_refs: [{ ref_id: "obs_1", ref_type: "observation", summary: "sent" }],
      artifact_refs: [{ artifact_id: "trace_1", artifact_type: "trace", ref: "trace_1" }],
      temporal_refs: [{ relation: "previous", episode_id: "epi_0" }],
      causal_links: [{
        link_id: "lnk_1",
        source_ref: "act_1",
        target_ref: "obs_1",
        relation: "caused",
        summary: "mailer sent message"
      }],
      activation_trace: {
        activation_count: 0,
        citation_count: 0,
        activation_sources: []
      },
      lifecycle_state: {
        status: "active",
        marked_at: now()
      },
      outcome: "success",
      outcome_summary: "follow-up sent",
      created_at: now(),
      metadata: {
        tool_name: "mailer"
      }
    });

    store.markActivated("ses_ep", "tenant_ep", ["epi_1"], {
      cycleId: "cyc_1",
      scope: "session",
      activatedAt: now()
    });

    store.markLifecycle("ses_ep", "tenant_ep", "epi_1", {
      status: "suspect",
      reason: "upstream evidence revoked",
      marked_at: now()
    });

    const episodes = store.list("ses_ep");
    assert.equal(episodes.length, 1);
    assert.deepEqual(episodes[0].plan_refs, ["plan_1"]);
    assert.equal(episodes[0].evidence_refs?.[0]?.ref_id, "obs_1");
    assert.equal(episodes[0].artifact_refs?.[0]?.artifact_id, "trace_1");
    assert.equal(episodes[0].temporal_refs?.[0]?.episode_id, "epi_0");
    assert.equal(episodes[0].causal_links?.[0]?.relation, "caused");
    assert.equal(episodes[0].activation_trace?.activation_count, 1);
    assert.equal(episodes[0].lifecycle_state?.status, "suspect");
    assert.equal(store.getLatest("ses_ep")?.episode_id, "epi_1");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime writes formal episode fields into episodic memory", async () => {
  const agent = defineAgent({
    id: "test-memory-episode-runtime",
    role: "Test episodic schema enrichment."
  })
    .useReasoner({
      name: "test-memory-episode-reasoner",
      async plan(ctx) {
        return [
          {
            proposal_id: ctx.services.generateId("prp"),
            schema_version: ctx.profile.schema_version,
            session_id: ctx.session.session_id,
            cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
            module_name: this.name,
            proposal_type: "plan",
            salience_score: 0.9,
            confidence: 0.95,
            risk: 0,
            payload: {
              summary: "Call echo and summarize."
            }
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
              title: "Return result",
              description: input,
              side_effect_level: "none"
            }
          ];
        }
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Call echo",
            tool_name: "echo",
            tool_args: { message: "episodic truth layer" },
            side_effect_level: "none"
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    })
    .registerTool({
      name: "echo",
      description: "Echoes a message.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" }
        },
        required: ["message"]
      },
      async invoke(input) {
        return {
          summary: `echo: ${typeof input.message === "string" ? input.message : "unknown"}`
        };
      }
    });

  const session = agent.createSession({
    agent_id: "test-memory-episode-runtime",
    tenant_id: "tenant-memory",
    initial_input: {
      content: "send an echo and summarize it"
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");

  const runtime = agent.runtime;
  const episodes = runtime.getEpisodes(session.sessionId);
  assert.ok(episodes.length >= 1);
  const lastEpisode = episodes[episodes.length - 1];
  assert.ok(Array.isArray(lastEpisode.evidence_refs));
  assert.ok(Array.isArray(lastEpisode.artifact_refs));
  assert.ok(Array.isArray(lastEpisode.causal_links));
  assert.equal(lastEpisode.lifecycle_state?.status, "active");
  assert.equal(lastEpisode.activation_trace?.activation_count ?? 0, 0);
});
