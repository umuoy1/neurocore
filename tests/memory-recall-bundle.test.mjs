import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CycleEngine, DefaultMetaController, InMemorySkillStore, ProceduralMemoryProvider } from "@neurocore/runtime-core";
import { PersonalMemoryRecallProvider } from "../examples/personal-assistant/dist/memory/personal-memory-recall-provider.js";
import { SqlitePersonalMemoryStore } from "../examples/personal-assistant/dist/memory/sqlite-personal-memory-store.js";

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
    agent_id: "memory-bundle-agent",
    schema_version: "1.0.0",
    name: "Memory Bundle Agent",
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
      retrieval_top_k: 4
    },
    runtime_config: { max_cycles: 3 }
  };
}

test("MemoryRecallBundle carries semantic cards, skill specs, and warnings without activating parametric refs", async () => {
  const cycleEngine = new CycleEngine();
  const reasoner = {
    name: "memory-bundle-reasoner",
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
  const semanticProvider = {
    name: "semantic-memory-provider",
    layer: "semantic",
    async retrieve(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: 0.8,
        confidence: 0.9,
        risk: 0,
        payload: {
          semantic_cards: [{
            card_id: "card_1",
            schema_version: "1.0.0",
            tenant_id: ctx.tenant_id,
            pattern_key: "tool:echo",
            summary: "Use echo for deterministic replies",
            valence: "positive",
            source_episode_ids: ["epi_1", "epi_2"],
            freshness: 0.9,
            lifecycle_state: {
              status: "suspect",
              marked_at: ts()
            },
            parametric_unit_refs: [{
              unit_id: "spr_1",
              unit_type: "soft_prompt",
              target_type: "semantic_card",
              status: "active"
            }],
            created_at: ts(),
            updated_at: ts()
          }]
        },
        explanation: "semantic recall"
      }];
    },
    async getDigest() { return []; }
  };

  const skillStore = new InMemorySkillStore();
  skillStore.save({
    skill_id: "skl_1",
    schema_version: "1.0.0",
    name: "echo_skill",
    version: "1.0.0",
    kind: "toolchain_skill",
    trigger_conditions: [{ field: "tool_name", operator: "eq", value: "echo" }],
    execution_template: { kind: "toolchain", steps: ["Call tool: echo"] },
    metadata: {
      tenant_id: "tenant_memory",
      source_episode_ids: ["epi_1", "epi_2"],
      patternKey: "call_tool:echo",
      memory_lifecycle_state: {
        status: "tombstoned",
        marked_at: ts()
      },
      parametric_unit_refs: [{
        unit_id: "lora_1",
        unit_type: "lora_adapter",
        target_type: "skill_spec",
        status: "active"
      }]
    }
  });
  const proceduralProvider = new ProceduralMemoryProvider(skillStore);

  const result = await cycleEngine.run({
    tenantId: "tenant_memory",
    session: {
      session_id: "ses_memory_bundle",
      schema_version: "1.0.0",
      tenant_id: "tenant_memory",
      agent_id: "memory-bundle-agent",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal_tree_memory",
      budget_state: {},
      policy_state: {}
    },
    profile: makeProfile(),
    input: {
      input_id: gid("inp"),
      content: "echo something",
      metadata: { tool_name: "echo", action_type: "call_tool" },
      created_at: ts()
    },
    goals: [],
    reasoner,
    metaController: new DefaultMetaController(),
    memoryProviders: [semanticProvider, proceduralProvider]
  });

  assert.equal(result.memoryRecallBundle.semantic_cards?.length, 1);
  assert.equal(result.memoryRecallBundle.skill_specs?.length, 1);
  assert.equal(result.memoryRecallBundle.parametric_unit_refs, undefined);
  assert.ok(result.memoryRecallBundle.warnings?.some((warning) => warning.kind === "suspect_object"));
  assert.ok(result.memoryRecallBundle.warnings?.some((warning) => warning.kind === "tombstoned_object"));
});

test("MemoryRecallBundle carries active personal memories and excludes corrected stale facts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-memory-recall-bundle-"));
  const store = new SqlitePersonalMemoryStore({ filename: join(tempDir, "memory.sqlite") });

  try {
    const stale = store.remember({
      user_id: "user-memory",
      content: "User does not drink coffee.",
      created_at: "2026-04-25T00:00:00.000Z"
    });
    store.correct(
      "user-memory",
      stale.memory_id,
      "User can drink decaf coffee.",
      undefined,
      "2026-04-26T00:00:00.000Z"
    );

    const cycleEngine = new CycleEngine();
    const provider = new PersonalMemoryRecallProvider(store);
    const result = await cycleEngine.run({
      tenantId: "tenant_memory",
      session: {
        session_id: "ses_personal_memory_bundle",
        schema_version: "1.0.0",
        tenant_id: "tenant_memory",
        agent_id: "memory-bundle-agent",
        state: "running",
        session_mode: "sync",
        goal_tree_ref: "goal_tree_memory",
        budget_state: {},
        policy_state: {}
      },
      profile: makeProfile(),
      input: {
        input_id: gid("inp"),
        content: "What drink should I recommend?",
        metadata: { canonical_user_id: "user-memory" },
        created_at: ts()
      },
      goals: [],
      reasoner: createBundleEchoReasoner(),
      metaController: new DefaultMetaController(),
      memoryProviders: [provider]
    });

    const proposal = result.memoryRecallBundle.proposals.find(
      (item) => item.module_name === "personal-memory-recall-provider"
    );
    const personalMemories = Array.isArray(proposal?.payload.personal_memories)
      ? proposal.payload.personal_memories
      : [];
    const bundleText = JSON.stringify(result.memoryRecallBundle);

    assert.equal(personalMemories.length, 1);
    assert.match(personalMemories[0].content, /decaf coffee/);
    assert.doesNotMatch(bundleText, /does not drink coffee/);
    assert.ok(result.memoryRecallBundle.digests.some((digest) => /decaf coffee/.test(digest.summary)));
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createBundleEchoReasoner() {
  return {
    name: "bundle-echo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "bundle-echo-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Echo memory recall bundle." }
        }
      ];
    },
    async respond(ctx) {
      const bundle = ctx.runtime_state.memory_recall_bundle &&
        typeof ctx.runtime_state.memory_recall_bundle === "object"
        ? ctx.runtime_state.memory_recall_bundle
        : {};
      const proposals = Array.isArray(bundle.proposals) ? bundle.proposals : [];
      const memories = proposals.flatMap((proposal) => {
        const payload = proposal && typeof proposal === "object" ? proposal.payload : undefined;
        return payload && Array.isArray(payload.personal_memories) ? payload.personal_memories : [];
      });
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Respond with personal memory",
        description: JSON.stringify(memories),
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
