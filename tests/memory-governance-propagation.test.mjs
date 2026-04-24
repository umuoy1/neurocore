import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

let idCounter = 0;
function gid(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function makeProfile() {
  return {
    agent_id: "memory-governance-agent",
    schema_version: "1.0.0",
    name: "Memory Governance Agent",
    version: "1.0.0",
    role: "assistant",
    mode: "runtime",
    tool_refs: [],
    skill_refs: [],
    policies: { policy_ids: [] },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      write_policy: "immediate"
    },
    runtime_config: { max_cycles: 4 }
  };
}

function makeMemoryEpisode(id, sessionId) {
  return {
    episode_id: id,
    schema_version: "1.0.0",
    session_id: sessionId,
    trigger_summary: "call echo",
    goal_refs: [],
    context_digest: "memory governance",
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

test("runtime propagates episode governance state into semantic cards and skill specs", async () => {
  const reasoner = {
    name: "memory-governance-reasoner",
    async plan() { return []; },
    async respond(ctx) {
      const currentInput = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      if (currentInput.startsWith("Tool observation:")) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Return result",
          description: currentInput,
          side_effect_level: "none"
        }];
      }
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: "Call echo",
        tool_name: "echo",
        tool_args: { message: "memory governance" },
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };

  const runtime = new AgentRuntime({ reasoner });
  const profile = makeProfile();
  const session = runtime.createSession(profile, {
    agent_id: profile.agent_id,
    tenant_id: "tenant_memory",
    initial_input: {
      content: "call echo"
    }
  });

  await runtime.runOnce(profile, session.session_id, {
    input_id: gid("inp"),
    content: "call echo once",
    created_at: ts()
  });
  await runtime.runOnce(profile, session.session_id, {
    input_id: gid("inp"),
    content: "call echo twice",
    created_at: ts()
  });
  await runtime.runOnce(profile, session.session_id, {
    input_id: gid("inp"),
    content: "call echo thrice",
    created_at: ts()
  });

  const seedEpisode = runtime.getEpisodes(session.session_id)[0];
  const semanticEpisodes = [
    makeMemoryEpisode(seedEpisode.episode_id, session.session_id),
    makeMemoryEpisode(gid("epi"), session.session_id)
  ];
  const proceduralEpisodes = [
    ...semanticEpisodes,
    makeMemoryEpisode(gid("epi"), session.session_id)
  ];
  runtime.getSemanticMemoryProvider().replaceSession(session.session_id, "tenant_memory", semanticEpisodes);
  runtime.getSkillProvider().replaceSession(session.session_id, "tenant_memory", proceduralEpisodes);

  const episodeId = seedEpisode.episode_id;
  const suspectEvents = runtime.markEpisodeSuspect(session.session_id, episodeId, "source conflict");
  const semanticCards = runtime.listSemanticCards(session.session_id);
  const skillSpecs = runtime.listSkillSpecs(session.session_id);

  assert.ok(suspectEvents.some((event) => event.object_type === "episode"));
  assert.ok(semanticCards.length > 0);
  assert.ok(skillSpecs.length > 0);
  assert.ok(semanticCards.every((card) => card.lifecycle_state?.status === "suspect"));
  assert.ok(skillSpecs.every((spec) => spec.lifecycle_state?.status === "suspect"));

  runtime.tombstoneEpisode(session.session_id, episodeId, "hard delete");
  assert.ok(runtime.listSemanticCards(session.session_id).every((card) => card.lifecycle_state?.status === "tombstoned"));
  assert.ok(runtime.listSkillSpecs(session.session_id).every((spec) => spec.lifecycle_state?.status === "tombstoned"));

  runtime.rollbackEpisode(session.session_id, episodeId, "rollback");
  const memoryEvents = runtime.listEvents(session.session_id)
    .filter((event) => event.event_type.startsWith("memory.object_") || event.event_type === "memory.rollback_applied");
  assert.ok(memoryEvents.some((event) => event.event_type === "memory.object_marked_suspect"));
  assert.ok(memoryEvents.some((event) => event.event_type === "memory.object_tombstoned"));
  assert.ok(memoryEvents.some((event) => event.event_type === "memory.rollback_applied"));
});
