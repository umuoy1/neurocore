import assert from "node:assert/strict";
import test from "node:test";
import { CycleEngine, DefaultMetaController } from "@neurocore/runtime-core";

function ts() {
  return new Date().toISOString();
}

let idCounter = 0;
function gid(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function makeProfile(memoryConfig = {}) {
  return {
    agent_id: "memory-plan-agent",
    schema_version: "1.0.0",
    name: "Memory Plan Agent",
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
      write_policy: "immediate",
      retrieval_top_k: 4,
      ...memoryConfig
    },
    runtime_config: { max_cycles: 3 }
  };
}

test("CycleEngine generates a staged memory retrieval plan", async () => {
  const cycleEngine = new CycleEngine();
  const reasoner = {
    name: "memory-plan-reasoner",
    async plan() { return []; },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "ask_user",
        title: "Ask",
        description: "Need next turn",
        side_effect_level: "none"
      }];
    }
  };
  const provider = {
    name: "semantic-memory-provider",
    layer: "semantic",
    async retrieve() { return []; },
    async getDigest() {
      return [{
        memory_id: "mem_sem_1",
        memory_type: "semantic",
        summary: "semantic summary",
        relevance: 0.8
      }];
    }
  };

  const result = await cycleEngine.run({
    tenantId: "tenant_memory",
    session: {
      session_id: "ses_memory_plan",
      schema_version: "1.0.0",
      tenant_id: "tenant_memory",
      agent_id: "memory-plan-agent",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal_tree_memory",
      budget_state: {},
      policy_state: {}
    },
    profile: makeProfile(),
    input: {
      input_id: gid("inp"),
      content: "find prior evidence",
      created_at: ts()
    },
    goals: [],
    reasoner,
    metaController: new DefaultMetaController(),
    memoryProviders: [provider]
  });

  assert.ok(result.memoryRetrievalPlan);
  assert.deepEqual(result.memoryRetrievalPlan.requested_layers, ["semantic"]);
  assert.deepEqual(result.memoryRetrievalPlan.stage_order, ["summary", "experience", "evidence"]);
  assert.equal(result.memoryRecallBundle.plan_id, result.memoryRetrievalPlan.plan_id);
  assert.equal(result.memoryRecallBundle.digests.length, 1);
});
