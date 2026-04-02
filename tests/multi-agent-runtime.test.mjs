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
      }
    });
}

function makeWorkerAgent(id, capabilityName, proficiency, summary) {
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
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return worker output",
            description: summary,
            side_effect_level: "none"
          }
        ];
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
