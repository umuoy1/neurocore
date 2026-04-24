import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySkillStore, ProceduralMemoryProvider } from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

function makeEpisode(id) {
  return {
    episode_id: id,
    schema_version: "1.0.0",
    session_id: "ses_skill_spec",
    trigger_summary: "call echo",
    goal_refs: [],
    context_digest: "procedural context",
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

function makeCtx() {
  return {
    tenant_id: "tenant_memory",
    session: {
      session_id: "ses_skill_spec",
      schema_version: "1.0.0",
      tenant_id: "tenant_memory",
      agent_id: "skill-spec-agent",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal_tree_memory",
      budget_state: {},
      policy_state: {}
    },
    profile: {
      agent_id: "skill-spec-agent",
      schema_version: "1.0.0",
      name: "Skill Spec Agent",
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
      runtime_config: { max_cycles: 3 }
    },
    goals: [],
    runtime_state: {},
    services: {
      now: () => ts(),
      generateId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`
    }
  };
}

test("procedural provider exposes formal skill specs and lifecycle updates", async () => {
  const provider = new ProceduralMemoryProvider(new InMemorySkillStore(), 2);
  const ctx = makeCtx();

  await provider.writeEpisode(ctx, makeEpisode("epi_1"));
  await provider.writeEpisode(ctx, makeEpisode("epi_2"));

  const specs = provider.listSkillSpecs("tenant_memory");
  assert.equal(specs.length, 1);
  assert.equal(specs[0].source_episode_ids.length, 2);

  const touched = provider.markSkillSpecsByEpisodeIds("tenant_memory", ["epi_1"], {
    status: "tombstoned",
    reason: "episode removed",
    marked_at: ts()
  });
  assert.equal(touched.length, 1);
  assert.equal(touched[0].lifecycle_state?.status, "tombstoned");
  assert.equal(provider.listSkillSpecs("tenant_memory")[0].lifecycle_state?.status, "tombstoned");
});
