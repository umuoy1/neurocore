import assert from "node:assert/strict";
import test from "node:test";
import { defineAgent } from "@neurocore/sdk-core";

function makeId() {
  return `inp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

test("B1: clarification flow - ask_user transitions to waiting, resume completes", async () => {
  const agent = defineAgent({
    id: "test-b1-clarification-agent",
    role: "Clarification test agent."
  }).useReasoner({
    name: "test-b1-reasoner",
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
          payload: { summary: "Handle the request." }
        }
      ];
    },
    async respond(ctx) {
      const input =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (input.startsWith("clarify:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Clarification received",
            description: `Understood: ${input.slice("clarify:".length).trim()}`,
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Need clarification",
          description: "Please clarify your intent.",
          side_effect_level: "none"
        }
      ];
    }
  });

  const session = agent.createSession({
    agent_id: "test-b1-clarification-agent",
    tenant_id: "test-b1-tenant",
    initial_input: { content: "do something ambiguous", input_id: makeId(), created_at: new Date().toISOString() }
  });

  const first = await session.run();
  assert.equal(first.finalState, "waiting");

  const second = await session.resumeText("clarify: please do step A then step B");
  assert.equal(second.finalState, "completed");
  assert.ok((second.outputText ?? "").includes("step A"));

  const eventTypes = session.getEvents().map((e) => e.event_type);
  assert.ok(eventTypes.includes("session.created"));
  assert.ok(eventTypes.includes("session.completed"));

  const records = session.getTraceRecords();
  const hasAskUser = records.some((r) => r.selected_action?.action_type === "ask_user");
  assert.ok(hasAskUser, "trace should contain an ask_user action");
});

test("B2: multi-tool chaining - tool_a then tool_b then respond", async () => {
  const agent = defineAgent({
    id: "test-b2-chain-agent",
    role: "Multi-tool chaining test agent."
  })
    .useReasoner({
      name: "test-b2-reasoner",
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
            payload: { summary: "Call tool_a, then tool_b, then respond." }
          }
        ];
      },
      async respond(ctx) {
        const input =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";

        if (input.includes("alpha-result")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "call_tool",
              title: "Call tool_b",
              tool_name: "tool_b",
              tool_args: { value: "alpha-result" },
              side_effect_level: "none"
            }
          ];
        }

        if (input.includes("beta-result")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Chain complete",
              description: "tool_a and tool_b both ran successfully.",
              side_effect_level: "none"
            }
          ];
        }

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Call tool_a",
            tool_name: "tool_a",
            tool_args: {},
            side_effect_level: "none"
          }
        ];
      }
    })
    .registerTool({
      name: "tool_a",
      description: "First tool in the chain.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "alpha-result", payload: { step: "alpha-result" } };
      }
    })
    .registerTool({
      name: "tool_b",
      description: "Second tool in the chain.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      async invoke() {
        return { summary: "beta-result", payload: { step: "beta-result" } };
      }
    });

  const session = agent.createSession({
    agent_id: "test-b2-chain-agent",
    tenant_id: "test-b2-tenant",
    initial_input: { content: "run the chain", input_id: makeId(), created_at: new Date().toISOString() }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");

  const toolSteps = result.steps.filter((s) => s.selectedAction?.action_type === "call_tool");
  assert.equal(toolSteps.length, 2, "should have exactly two tool call steps");

  const replay = session.replay();
  const executedTools = replay.traces
    .map((r) =>
      r.action_execution && typeof r.selected_action?.tool_name === "string"
        ? r.selected_action.tool_name
        : undefined
    )
    .filter(Boolean);

  assert.deepEqual(executedTools, ["tool_a", "tool_b"]);
});

test("B3: high-risk approval - escalated then approve then completed", async () => {
  const agent = defineAgent({
    id: "test-b3-approval-agent",
    role: "High-risk approval test agent."
  })
    .useReasoner({
      name: "test-b3-reasoner",
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
            payload: { summary: "Call the risky tool, then respond." }
          }
        ];
      },
      async respond(ctx) {
        const input =
          typeof ctx.runtime_state.current_input_content === "string"
            ? ctx.runtime_state.current_input_content
            : "";

        if (input.includes("risky-done")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Done",
              description: "Risky operation completed.",
              side_effect_level: "none"
            }
          ];
        }

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Call risky tool",
            tool_name: "risky-tool",
            tool_args: {},
            side_effect_level: "high"
          }
        ];
      }
    })
    .registerTool({
      name: "risky-tool",
      description: "A tool with high side effects.",
      sideEffectLevel: "high",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "risky-done", payload: { result: "risky-done" } };
      }
    });

  const session = agent.createSession({
    agent_id: "test-b3-approval-agent",
    tenant_id: "test-b3-tenant",
    initial_input: { content: "do the risky thing", input_id: makeId(), created_at: new Date().toISOString() }
  });

  const first = await session.run();
  assert.equal(first.finalState, "escalated", "should be escalated waiting for approval");

  const pending = session.getPendingApproval();
  assert.ok(pending, "should have a pending approval request");

  const approveResult = await session.approve({ approver_id: "test-reviewer" });
  assert.ok(approveResult.run, "approve should return a run result");

  const final = await session.resume();
  assert.equal(final.finalState, "completed");

  const eventTypes = session.getEvents().map((e) => e.event_type);
  const executedCount = eventTypes.filter((t) => t === "action.executed").length;
  assert.ok(executedCount >= 1, "risky-tool should have been executed");
});

test("B4: memory recall - episode from session 1 visible in session 2 plan proposals", async () => {
  let session2RecallProposals = [];
  let session2Id = null;

  const agent = defineAgent({
    id: "test-b4-memory-agent",
    role: "Memory recall test agent."
  }).useReasoner({
    name: "test-b4-reasoner",
    async plan(ctx) {
      const recalls = Array.isArray(ctx.runtime_state.memory_recall_proposals)
        ? ctx.runtime_state.memory_recall_proposals
        : [];

      if (session2Id && ctx.session.session_id === session2Id) {
        session2RecallProposals = recalls;
      }

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
          payload: { summary: "Respond immediately." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Done",
          description: "Task complete.",
          side_effect_level: "none"
        }
      ];
    }
  });

  const session1 = agent.createSession({
    agent_id: "test-b4-memory-agent",
    tenant_id: "test-b4-tenant",
    initial_input: { content: "first task", input_id: makeId(), created_at: new Date().toISOString() }
  });

  const first = await session1.run();
  assert.equal(first.finalState, "completed");
  assert.ok(session1.getEpisodes().length >= 1, "session 1 should have at least one episode");

  const session2 = agent.createSession({
    agent_id: "test-b4-memory-agent",
    tenant_id: "test-b4-tenant",
    initial_input: { content: "second task", input_id: makeId(), created_at: new Date().toISOString() }
  });

  session2Id = session2.id;

  const second = await session2.run();
  assert.equal(second.finalState, "completed");

  assert.ok(
    session2RecallProposals.length > 0,
    "session 2 plan() should receive memory_recall_proposals from session 1"
  );
});
