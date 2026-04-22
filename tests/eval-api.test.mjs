import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectRemoteEval } from "@neurocore/eval-core";
import { defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

const agent = defineAgent({
  id: "test-eval-api-agent",
  role: "Deterministic eval API test agent."
}).useReasoner({
  name: "test-eval-api-reasoner",
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
        payload: { summary: "Echo the input back." }
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
  },
  async *streamText(_ctx, action) {
    yield action.description ?? action.title;
  }
});

test("C: remote eval API - POST /v1/evals/runs creates report, GET retrieves it", async () => {
  const server = createRuntimeServer({ agents: [agent] });
  const { url } = await server.listen();

  try {
    const evalClient = connectRemoteEval({ baseUrl: url });

    const cases = [
      {
        case_id: "echo-hello",
        description: "Agent should echo the input.",
        input: { content: "hello eval" },
        expectations: {
          final_state: "completed",
          output_includes: ["hello eval"]
        }
      },
      {
        case_id: "echo-world",
        description: "Agent should echo a different input.",
        input: { content: "world eval" },
        expectations: {
          final_state: "completed",
          output_includes: ["world eval"]
        }
      }
    ];

    const report = await evalClient.runEval("test-eval-api-agent", cases, { parallelism: 2 });

    assert.equal(typeof report.run_id, "string");
    assert.ok(report.run_id.length > 0);
    assert.equal(report.case_count, 2);
    assert.equal(report.pass_count, 2);
    assert.equal(report.pass_rate, 1);
    assert.equal(report.results.length, 2);
    assert.ok(report.results.every((r) => r.passed));

    const fetched = await evalClient.getEvalReport(report.run_id);
    assert.equal(fetched.run_id, report.run_id);
    assert.equal(fetched.pass_count, 2);
    assert.equal(fetched.case_count, 2);
  } finally {
    await server.close();
  }
});

test("C: remote eval API - GET unknown run_id returns 404", async () => {
  const server = createRuntimeServer({ agents: [agent] });
  const { url } = await server.listen();

  try {
    const evalClient = connectRemoteEval({ baseUrl: url });
    await assert.rejects(
      () => evalClient.getEvalReport("nonexistent-run-id"),
      /404/
    );
  } finally {
    await server.close();
  }
});

test("C: remote eval API - POST with unknown agent_id returns 404", async () => {
  const server = createRuntimeServer({ agents: [agent] });
  const { url } = await server.listen();

  try {
    const evalClient = connectRemoteEval({ baseUrl: url });
    await assert.rejects(
      () => evalClient.runEval("nonexistent-agent", []),
      /404/
    );
  } finally {
    await server.close();
  }
});

test("C: remote eval API - eval reports persist across server restart with SQLite eval store", async () => {
  const filename = join(tmpdir(), `neurocore-eval-api-${randomUUID()}.sqlite`);
  let server = createRuntimeServer({
    agents: [agent],
    evalStoreFilename: filename
  });
  let url;
  let running = false;

  try {
    ({ url } = await server.listen());
    running = true;
    const evalClient = connectRemoteEval({ baseUrl: url });
    const report = await evalClient.runEval("test-eval-api-agent", [
      {
        case_id: "echo-persisted",
        description: "Agent should echo the input.",
        input: { content: "persist me" },
        expectations: {
          final_state: "completed",
          output_includes: ["persist me"]
        }
      }
    ]);

    await server.close();
    running = false;

    server = createRuntimeServer({
      agents: [agent],
      evalStoreFilename: filename
    });
    ({ url } = await server.listen());
    running = true;

    const restartedClient = connectRemoteEval({ baseUrl: url });
    const fetched = await restartedClient.getEvalReport(report.run_id);
    assert.equal(fetched.run_id, report.run_id);
    assert.equal(fetched.pass_count, 1);
    assert.equal(fetched.case_count, 1);
  } finally {
    if (running) {
      await server.close();
    }
    if (existsSync(filename)) {
      rmSync(filename, { force: true });
    }
  }
});
