import assert from "node:assert/strict";
import test from "node:test";
import { connectRemoteAgent, defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

function buildReasoner() {
  return {
    name: "sdk-tightening-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: `echo:${input}`,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

test("AgentBuilder rejects invalid agent ids and duplicate registrations", async () => {
  assert.throws(
    () => defineAgent({ id: "bad id", role: "tester" }),
    /Invalid agent id/
  );

  const agent = defineAgent({
    id: "sdk-tightening-agent",
    role: "tester"
  }).useReasoner(buildReasoner());

  agent.registerTool({
    name: "echo",
    description: "Echoes text.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } }
    },
    async invoke(input) {
      return {
        summary: String(input.text ?? "")
      };
    }
  });

  assert.throws(
    () =>
      agent.registerTool({
        name: "echo",
        description: "Duplicate.",
        sideEffectLevel: "none",
        inputSchema: { type: "object" },
        async invoke() {
          return { summary: "duplicate" };
        }
      }),
    /Duplicate tool registration/
  );
});

test("AgentBuilder validate/build freeze shared runtime and sync configurePolicy with policy_ids", async () => {
  const agent = defineAgent({
    id: "sdk-build-agent",
    role: "tester"
  })
    .useReasoner(buildReasoner())
    .configurePolicy({
      requiredApprovalTools: ["dangerous_tool"]
    });

  const validation = agent.validate();
  assert.equal(validation.valid, true);
  assert.deepEqual(agent.getProfile().policies.policy_ids, ["tool-policy-provider"]);

  const built = agent.build();
  const sessionA = built.createSession({
    agent_id: "sdk-build-agent",
    tenant_id: "tenant_sdk",
    initial_input: {
      content: "first"
    }
  });
  const sessionB = built.createSession({
    agent_id: "sdk-build-agent",
    tenant_id: "tenant_sdk",
    initial_input: {
      content: "second"
    }
  });

  await sessionA.run();
  await sessionB.run();

  assert.equal(built.getRuntime(), built.getRuntime());
  assert.equal(built.getProfile().agent_id, "sdk-build-agent");
});

test("local and remote session handles expose aligned checkpoint/replay/waitForSettled semantics", async () => {
  const builder = defineAgent({
    id: "sdk-handle-agent",
    role: "tester"
  }).useReasoner(buildReasoner());

  const localSession = builder.createSession({
    agent_id: "sdk-handle-agent",
    tenant_id: "tenant_sdk",
    initial_input: {
      content: "local"
    }
  });

  await localSession.run();
  const localCheckpoint = await localSession.checkpoint();
  const localReplay = await localSession.replay();
  const localSettled = await localSession.waitForSettled();

  assert.ok(localCheckpoint.checkpoint_id);
  assert.equal(localReplay.session_id, localSession.id);
  assert.ok(localSettled);

  const server = createRuntimeServer({ agents: [builder] });
  const address = await server.listen();
  try {
    const client = connectRemoteAgent({
      agentId: "sdk-handle-agent",
      baseUrl: address.url
    });
    const remoteSession = await client.createSession({
      agent_id: "sdk-handle-agent",
      tenant_id: "tenant_sdk",
      initial_input: {
        content: "remote"
      }
    }, { runImmediately: true });

    await remoteSession.waitForSettled();
    const remoteCheckpoint = await remoteSession.checkpoint();
    const remoteReplay = await remoteSession.replay();

    assert.ok(remoteCheckpoint.checkpoint_id);
    assert.equal(remoteReplay.session_id, remoteSession.id);
  } finally {
    await server.close();
  }
});

test("remote trace, episode, and event endpoints support pagination", async () => {
  const builder = defineAgent({
    id: "sdk-pagination-agent",
    role: "tester"
  }).useReasoner({
    name: "sdk-pagination-reasoner",
    async plan() {
      return [];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      if (input === "page one") {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "ask_user",
            title: "Need follow-up",
            description: "continue",
            prompt: "continue"
          }
        ];
      }
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: `echo:${input}`,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  });
  const server = createRuntimeServer({ agents: [builder] });
  const address = await server.listen();

  try {
    const client = connectRemoteAgent({
      agentId: "sdk-pagination-agent",
      baseUrl: address.url
    });
    const session = await client.createSession({
      agent_id: "sdk-pagination-agent",
      tenant_id: "tenant_sdk",
      initial_input: {
        content: "page one"
      }
    }, { runImmediately: true });

    await session.waitForSettled();
    await session.resumeText("page two");
    await session.waitForSettled();

    const tracesPage = await session.getTraceRecordsPage({ offset: 0, limit: 1 });
    const episodesPage = await session.getEpisodesPage({ offset: 0, limit: 1 });
    const eventsPage = await session.getEventsPage({ offset: 0, limit: 2 });

    assert.equal(tracesPage.items.length, 1);
    assert.ok(tracesPage.total >= 2);
    assert.equal(tracesPage.has_more, true);

    assert.equal(episodesPage.items.length, 1);
    assert.ok(episodesPage.total >= 2);

    assert.equal(eventsPage.items.length, 2);
    assert.ok(eventsPage.total >= 2);
    assert.equal(typeof eventsPage.items[0].sequence_no, "number");
  } finally {
    await server.close();
  }
});
