import assert from "node:assert/strict";
import test from "node:test";
import { BASELINE_CASES, EvalRunner, createSessionExecutor } from "@neurocore/eval-core";
import { defineAgent } from "@neurocore/sdk-core";

function makeId() {
  return `inp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

test("D1: baseline eval - simple respond completes with echoed output", async () => {
  const agent = defineAgent({
    id: "d1-echo-agent",
    role: "Echo agent."
  }).useReasoner({
    name: "d1-echo-reasoner",
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
          payload: { summary: "Echo the input." }
        }
      ];
    },
    async respond(ctx) {
      const input =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Echo",
          description: input,
          side_effect_level: "none"
        }
      ];
    }
  });

  const executor = createSessionExecutor((testCase) =>
    agent.createSession({
      agent_id: "d1-echo-agent",
      tenant_id: "d1-tenant",
      initial_input: {
        content: testCase.input.content,
        input_id: makeId(),
        created_at: new Date().toISOString()
      }
    })
  );

  const runner = new EvalRunner(executor);
  const d1Cases = BASELINE_CASES.filter((c) => c.case_id.startsWith("d1-"));
  const report = await runner.run(d1Cases);

  assert.equal(report.case_count, 2);
  assert.equal(report.pass_count, 2);
  assert.equal(report.pass_rate, 1);
  assert.ok(report.results.every((r) => r.passed));
});

test("D2: baseline eval - single tool call then respond", async () => {
  const agent = defineAgent({
    id: "d2-tool-agent",
    role: "Single tool call agent."
  })
    .useReasoner({
      name: "d2-tool-reasoner",
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
            payload: { summary: "Call fetch_data then respond." }
          }
        ];
      },
      async respond(ctx) {
        const input =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";
        if (input.includes("fetch-result")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Done",
              description: "fetch_data returned fetch-result.",
              side_effect_level: "none"
            }
          ];
        }
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Fetch data",
            tool_name: "fetch_data",
            tool_args: {},
            side_effect_level: "none"
          }
        ];
      }
    })
    .registerTool({
      name: "fetch_data",
      description: "Fetches baseline data.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "fetch-result", payload: { data: "fetch-result" } };
      }
    });

  const executor = createSessionExecutor((testCase) =>
    agent.createSession({
      agent_id: "d2-tool-agent",
      tenant_id: "d2-tenant",
      initial_input: {
        content: testCase.input.content,
        input_id: makeId(),
        created_at: new Date().toISOString()
      }
    })
  );

  const runner = new EvalRunner(executor);
  const report = await runner.run([
    BASELINE_CASES.find((c) => c.case_id === "d2-single-tool")
  ]);

  assert.equal(report.pass_count, 1);
  assert.equal(report.pass_rate, 1);
  assert.ok(report.results[0].passed);
});

test("D3: baseline eval - clarification trigger leaves session waiting", async () => {
  const agent = defineAgent({
    id: "d3-clarify-agent",
    role: "Clarification trigger agent."
  }).useReasoner({
    name: "d3-clarify-reasoner",
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
          payload: { summary: "Ask user for clarification." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Clarify",
          description: "What do you want me to do?",
          side_effect_level: "none"
        }
      ];
    }
  });

  const executor = createSessionExecutor((testCase) =>
    agent.createSession({
      agent_id: "d3-clarify-agent",
      tenant_id: "d3-tenant",
      initial_input: {
        content: testCase.input.content,
        input_id: makeId(),
        created_at: new Date().toISOString()
      }
    })
  );

  const runner = new EvalRunner(executor);
  const report = await runner.run([
    BASELINE_CASES.find((c) => c.case_id === "d3-clarification")
  ]);

  assert.equal(report.pass_count, 1);
  assert.equal(report.pass_rate, 1);
  assert.ok(report.results[0].passed, JSON.stringify(report.results[0].failures));
});

test("D4: baseline eval - high-risk tool triggers approval escalation", async () => {
  const agent = defineAgent({
    id: "d4-approval-agent",
    role: "Approval trigger agent."
  })
    .useReasoner({
      name: "d4-approval-reasoner",
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
            payload: { summary: "Call destructive tool." }
          }
        ];
      },
      async respond(ctx) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Destructive op",
            tool_name: "destructive_op",
            tool_args: {},
            side_effect_level: "high"
          }
        ];
      }
    })
    .registerTool({
      name: "destructive_op",
      description: "A high-risk destructive operation.",
      sideEffectLevel: "high",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "done", payload: {} };
      }
    });

  const executor = createSessionExecutor((testCase) =>
    agent.createSession({
      agent_id: "d4-approval-agent",
      tenant_id: "d4-tenant",
      initial_input: {
        content: testCase.input.content,
        input_id: makeId(),
        created_at: new Date().toISOString()
      }
    })
  );

  const runner = new EvalRunner(executor);
  const report = await runner.run([
    BASELINE_CASES.find((c) => c.case_id === "d4-approval-escalation")
  ]);

  assert.equal(report.pass_count, 1);
  assert.equal(report.pass_rate, 1);
  assert.ok(report.results[0].passed, JSON.stringify(report.results[0].failures));
});

test("D5: baseline eval - multi-tool chain produces correct executed sequence", async () => {
  const agent = defineAgent({
    id: "d5-chain-agent",
    role: "Multi-tool chain agent."
  })
    .useReasoner({
      name: "d5-chain-reasoner",
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
            payload: { summary: "Call step_a then step_b then respond." }
          }
        ];
      },
      async respond(ctx) {
        const input =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";
        if (input.includes("step-b-done")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Chain complete",
              description: "step_a and step_b both ran.",
              side_effect_level: "none"
            }
          ];
        }
        if (input.includes("step-a-done")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "call_tool",
              title: "Step B",
              tool_name: "step_b",
              tool_args: {},
              side_effect_level: "none"
            }
          ];
        }
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Step A",
            tool_name: "step_a",
            tool_args: {},
            side_effect_level: "none"
          }
        ];
      }
    })
    .registerTool({
      name: "step_a",
      description: "First step.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "step-a-done", payload: { step: "step-a-done" } };
      }
    })
    .registerTool({
      name: "step_b",
      description: "Second step.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "step-b-done", payload: { step: "step-b-done" } };
      }
    });

  const executor = createSessionExecutor((testCase) =>
    agent.createSession({
      agent_id: "d5-chain-agent",
      tenant_id: "d5-tenant",
      initial_input: {
        content: testCase.input.content,
        input_id: makeId(),
        created_at: new Date().toISOString()
      }
    })
  );

  const runner = new EvalRunner(executor);
  const report = await runner.run([
    BASELINE_CASES.find((c) => c.case_id === "d5-tool-chain")
  ]);

  assert.equal(report.pass_count, 1);
  assert.equal(report.pass_rate, 1);
  assert.ok(report.results[0].passed, JSON.stringify(report.results[0].failures));
});
