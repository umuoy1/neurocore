import assert from "node:assert/strict";
import test from "node:test";
import { defineAgent } from "@neurocore/sdk-core";

test("Cost budget: cycle trace accumulates cost_budget_used", async () => {
  const agent = defineAgent({
    id: "cost-agent",
    role: "Cost tracking test agent."
  }).useReasoner({
    name: "cost-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "respond" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Done",
        description: "cost test done",
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const profile = agent.getProfile();
  profile.cost_per_token = 0.001;
  profile.cost_budget = 100;

  const handle = agent.createSession({
    agent_id: "cost-agent",
    tenant_id: "cost-tenant",
    initial_input: {
      input_id: "inp_cost_1",
      content: "test cost tracking",
      created_at: new Date().toISOString()
    }
  });

  const result = await handle.run();
  const session = handle.getSession();
  assert.ok(session.budget_state.cost_budget_used > 0, "cost_budget_used should be positive");
  assert.equal(session.budget_state.cost_budget_total, 100);
});

test("Cost budget: exceeding cost budget triggers budget_exceeded", async () => {
  const agent = defineAgent({
    id: "cost-exceed-agent",
    role: "Cost exceed test agent."
  }).useReasoner({
    name: "cost-exceed-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "respond" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Done",
        description: "cost test",
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });

  const profile = agent.getProfile();
  profile.cost_per_token = 10;
  profile.cost_budget = 0.001;

  const handle = agent.createSession({
    agent_id: "cost-exceed-agent",
    tenant_id: "cost-tenant",
    initial_input: {
      input_id: "inp_cost_2",
      content: "test cost exceed",
      created_at: new Date().toISOString()
    }
  });

  const result = await handle.run();
  const session = handle.getSession();
  assert.ok(session.budget_state.cost_budget_used >= session.budget_state.cost_budget_total,
    "cost should exceed budget");
});
