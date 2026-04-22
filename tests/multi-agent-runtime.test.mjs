import assert from "node:assert/strict";
import test from "node:test";
import { defineAgent, InProcessAgentMesh } from "@neurocore/sdk-core";

function makeSupervisorAgent(id, workerTarget, mode = "unicast", capabilities = ["research"]) {
  return defineAgent({
    id,
    role: "Supervisor"
  })
    .configureMultiAgent({
      enabled: true,
      capabilities: [{ name: "orchestration", proficiency: 0.9 }]
    })
    .useReasoner({
      name: `${id}-reasoner`,
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
              summary: "Delegate to a worker, then synthesize the result."
            }
          }
        ];
      },
      async respond(ctx) {
        const input = typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

        if (input.startsWith("Delegation observation:")) {
          return [
            {
              action_id: ctx.services.generateId("act"),
              action_type: "respond",
              title: "Return delegated result",
              description: input.replace(/^Delegation observation:\s*/, "").trim(),
              side_effect_level: "none"
            }
          ];
        }

        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "delegate",
            title: "Delegate work",
            side_effect_level: "low",
            tool_args: {
              delegation_mode: mode,
              target_agent_id: mode === "unicast" ? workerTarget : undefined,
              target_capabilities: mode === "auction" ? capabilities : undefined,
              goal: {
                title: "Produce delegated result",
                description: "Return a concise worker summary.",
                goal_type: "task",
                priority: 1
              }
            }
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });
}

function makeWorkerAgent(id, capabilityName, proficiency, summary, options = {}) {
  return defineAgent({
    id,
    role: "Worker"
  })
    .configureMultiAgent({
      enabled: true,
      capabilities: [{ name: capabilityName, proficiency }],
      max_capacity: 2
    })
    .useReasoner({
      name: `${id}-reasoner`,
      async plan(ctx) {
        return [
          {
            proposal_id: ctx.services.generateId("prp"),
            schema_version: ctx.profile.schema_version,
            session_id: ctx.session.session_id,
            cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
            module_name: this.name,
            proposal_type: "plan",
            salience_score: 0.7,
            confidence: 0.9,
            risk: 0,
            payload: {
              summary: "Complete the delegated goal directly."
            }
          }
        ];
      },
      async respond(ctx) {
        if (typeof options.onRespond === "function") {
          return options.onRespond(ctx);
        }
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return worker output",
            description: summary,
            side_effect_level: "none"
          }
        ];
      },
      async *streamText(_ctx, action) {
        yield action.description ?? action.title;
      }
    });
}

test("multi-agent runtime continues after delegated worker completes", async () => {
  const mesh = new InProcessAgentMesh();
  const supervisor = makeSupervisorAgent("supervisor-agent", "worker-agent");
  const worker = makeWorkerAgent("worker-agent", "research", 0.92, "worker result ready");

  await mesh.registerAgents([supervisor, worker]);

  try {
    const session = supervisor.createSession({
      agent_id: "supervisor-agent",
      tenant_id: "team-a",
      initial_input: {
        content: "Need delegated help."
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");
    assert.equal(result.steps.length, 2);
    assert.equal(result.outputText, "worker result ready");

    const delegationStep = result.steps[0];
    assert.equal(delegationStep.selectedAction?.action_type, "delegate");
    assert.equal(delegationStep.observation?.structured_payload?.delegation_status, "completed");
    assert.equal(delegationStep.observation?.structured_payload?.assigned_agent_id, "worker-agent");
    assert.equal(
      delegationStep.observation?.structured_payload?.result?.payload?.final_state,
      "completed"
    );
  } finally {
    await mesh.close();
  }
});

test("auction delegation executes selected worker and feeds result back into supervisor", async () => {
  const mesh = new InProcessAgentMesh();
  const supervisor = makeSupervisorAgent("auction-supervisor", "unused", "auction");
  const workerA = makeWorkerAgent("worker-basic", "research", 0.7, "basic worker result");
  const workerB = makeWorkerAgent("worker-best", "research", 0.98, "best worker result");

  await mesh.registerAgents([supervisor, workerA, workerB]);

  try {
    const session = supervisor.createSession({
      agent_id: "auction-supervisor",
      tenant_id: "team-b",
      initial_input: {
        content: "Find the best worker."
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");
    assert.equal(result.outputText, "best worker result");

    const delegationStep = result.steps[0];
    assert.equal(delegationStep.observation?.structured_payload?.delegation_status, "completed");
    assert.equal(delegationStep.observation?.structured_payload?.assigned_agent_id, "worker-best");
    assert.equal(delegationStep.observation?.structured_payload?.selected_bid?.agent_id, "worker-best");
    assert.equal(delegationStep.observation?.structured_payload?.result?.summary, "best worker result");
  } finally {
    await mesh.close();
  }
});

test("delegated child session forwards context and exposes assigned session id", async () => {
  const mesh = new InProcessAgentMesh();
  const supervisor = makeSupervisorAgent("forwarding-supervisor", "forwarding-worker");
  const worker = makeWorkerAgent(
    "forwarding-worker",
    "research",
    0.95,
    "unused",
    {
      onRespond(ctx) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return forwarded metadata",
            description: JSON.stringify({
              input: ctx.runtime_state.current_input_content,
              metadata: ctx.runtime_state.current_input_metadata
            }),
            side_effect_level: "none"
          }
        ];
      }
    }
  );

  await mesh.registerAgents([supervisor, worker]);

  try {
    const session = supervisor.createSession({
      agent_id: "forwarding-supervisor",
      tenant_id: "team-c",
      initial_input: {
        content: "Forward the delegated goal."
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");

    const delegationStep = result.steps[0];
    assert.equal(delegationStep.observation?.structured_payload?.delegation_status, "completed");
    assert.equal(typeof delegationStep.observation?.structured_payload?.assigned_session_id, "string");

    const payload = JSON.parse(result.outputText);
    assert.match(payload.input, /Produce delegated result/);
    assert.equal(payload.metadata.delegation_mode, "unicast");
    assert.equal(payload.metadata.source_agent_id, "forwarding-supervisor");
    assert.equal(payload.metadata.target_agent_id, "forwarding-worker");
    assert.equal(payload.metadata.source_goal_id, session.getGoals()[0].goal_id);

    const eventTypes = session.getEvents().map((event) => event.event_type);
    assert.ok(eventTypes.includes("delegation.requested"));
    assert.ok(eventTypes.includes("delegation.completed"));
  } finally {
    await mesh.close();
  }
});

test("mesh exposes configured coordination strategy and publishes agent lifecycle events", async () => {
  const mesh = new InProcessAgentMesh();
  const lifecycleEvents = [];
  mesh.bus.subscribe("agent.lifecycle", async (message) => {
    lifecycleEvents.push(message.payload.type);
  });

  const agent = defineAgent({
    id: "market-agent",
    role: "Coordinator"
  }).configureMultiAgent({
    enabled: true,
    coordination_strategy: "market_based"
  });

  await mesh.registerAgent(agent);

  try {
    assert.equal(mesh.getCoordinationStrategy("market-agent").name, "market_based");
    assert.ok(lifecycleEvents.includes("agent.registered"));
  } finally {
    await mesh.close();
  }
});
