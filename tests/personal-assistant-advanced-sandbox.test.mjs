import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent, createPersonalAssistantConfigFromEnv } from "../examples/personal-assistant/dist/main.js";
import {
  createSandboxManagerFromConfig,
  InMemorySandboxEnvironmentStateStore,
  SandboxManager,
  ServerlessSandboxProvider
} from "../examples/personal-assistant/dist/sandbox/sandbox-provider.js";
import { createSandboxTools } from "../examples/personal-assistant/dist/sandbox/sandbox-tools.js";

test("serverless sandbox hibernates resumes and restores workspace after manager restart", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-advanced-sandbox-"));
  const workspace = join(tempDir, "workspace");
  const statePath = join(tempDir, "serverless-state.json");
  const config = {
    enabled: true,
    default_target: "serverless",
    serverless: {
      enabled: true,
      backend: "modal-fixture",
      workspace,
      state_path: statePath,
      cost_per_second_usd: 0.05,
      cost_limit_usd: 1
    }
  };

  try {
    const tools = new Map(createSandboxTools(createSandboxManagerFromConfig(config)).map((tool) => [tool.name, tool]));
    const ctx = { tenant_id: "tenant-sandbox", session_id: "session-sandbox", cycle_id: "cycle-sandbox" };

    const initial = await tools.get("sandbox_environment_status").invoke({ target: "serverless" }, ctx);
    assert.equal(initial.payload.environment.lifecycle, "cold");
    assert.equal(initial.payload.environment.backend, "modal-fixture");

    const write = await tools.get("sandbox_shell").invoke({
      target: "serverless",
      command: "printf remote-state > restored.txt"
    }, ctx);
    assert.equal(write.payload.environment.lifecycle, "active");
    assert.equal(write.payload.environment.secrets_injected, false);
    assert.equal(typeof write.payload.cost.estimated_cost_usd, "number");

    const hibernated = await tools.get("sandbox_environment_hibernate").invoke({ target: "serverless" }, ctx);
    assert.equal(hibernated.payload.environment.lifecycle, "hibernated");
    assert.match(hibernated.payload.environment.checkpoint_id, /^ckpt_/);
    const checkpointId = hibernated.payload.environment.checkpoint_id;
    const environmentId = hibernated.payload.environment.environment_id;

    const restartedTools = new Map(createSandboxTools(createSandboxManagerFromConfig(config)).map((tool) => [tool.name, tool]));
    const restored = await restartedTools.get("sandbox_environment_status").invoke({ target: "serverless" }, ctx);
    assert.equal(restored.payload.environment.lifecycle, "hibernated");
    assert.equal(restored.payload.environment.checkpoint_id, checkpointId);
    assert.equal(restored.payload.environment.environment_id, environmentId);

    const resumed = await restartedTools.get("sandbox_environment_resume").invoke({ target: "serverless" }, ctx);
    assert.equal(resumed.payload.environment.lifecycle, "resumed");
    assert.equal(resumed.payload.environment.restore_count, 1);
    assert.equal(resumed.payload.environment.checkpoint_id, checkpointId);

    const read = await restartedTools.get("sandbox_file_read").invoke({
      target: "serverless",
      path: "restored.txt"
    }, ctx);
    assert.equal(read.payload.stdout, "remote-state");
    assert.equal(read.payload.environment.environment_id, environmentId);
    assert.equal(read.payload.environment.lifecycle, "active");
    assert.equal(read.payload.environment.restore_count, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("serverless sandbox strips secret env and exposes lifecycle cost metadata", async () => {
  let observedEnv;
  const runner = {
    async run(input) {
      observedEnv = input.env;
      return {
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        timed_out: false
      };
    }
  };
  const manager = new SandboxManager([
    new ServerlessSandboxProvider({
      runner,
      stateStore: new InMemorySandboxEnvironmentStateStore(),
      costPerSecondUsd: 0.25,
      costLimitUsd: 2
    })
  ], "serverless");

  const result = await manager.execute({
    target: "serverless",
    command: "env",
    env: {
      OPENAI_API_KEY: "should-not-enter",
      SAFE_VALUE: "visible"
    }
  });

  assert.equal(observedEnv.OPENAI_API_KEY, undefined);
  assert.equal(observedEnv.SAFE_VALUE, "visible");
  assert.equal(result.environment.target, "serverless");
  assert.equal(result.environment.secrets_injected, false);
  assert.equal(result.environment.cost_limit_usd, 2);
  assert.equal(typeof result.cost.estimated_cost_usd, "number");
});

test("personal assistant config and agent expose serverless sandbox target and lifecycle tools", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-advanced-sandbox-config-"));
  const workspace = join(tempDir, "workspace");
  const statePath = join(tempDir, "serverless-state.json");

  try {
    const config = createPersonalAssistantConfigFromEnv({
      PERSONAL_ASSISTANT_SANDBOX_ENABLED: "true",
      PERSONAL_ASSISTANT_SANDBOX_TARGET: "serverless",
      PERSONAL_ASSISTANT_SANDBOX_SERVERLESS_ENABLED: "true",
      PERSONAL_ASSISTANT_SANDBOX_SERVERLESS_BACKEND: "modal-fixture",
      PERSONAL_ASSISTANT_SANDBOX_SERVERLESS_WORKSPACE: workspace,
      PERSONAL_ASSISTANT_SANDBOX_SERVERLESS_STATE_PATH: statePath,
      PERSONAL_ASSISTANT_SANDBOX_SERVERLESS_COST_PER_SECOND_USD: "0.05",
      PERSONAL_ASSISTANT_SANDBOX_SERVERLESS_COST_LIMIT_USD: "1.5"
    }, { cwd: tempDir });

    assert.equal(config.sandbox.default_target, "serverless");
    assert.equal(config.sandbox.serverless.enabled, true);
    assert.equal(config.sandbox.serverless.backend, "modal-fixture");
    assert.equal(config.sandbox.serverless.cost_per_second_usd, 0.05);
    assert.equal(config.sandbox.serverless.cost_limit_usd, 1.5);

    const manager = createSandboxManagerFromConfig(config.sandbox);
    assert.ok(manager.listProviders().some((provider) => provider.target === "serverless"));

    const agent = createPersonalAssistantAgent({
      ...config,
      reasoner: createReasoner(),
      web_chat: {
        enabled: false
      }
    });
    assert.ok(agent.getProfile().tool_refs.includes("sandbox_environment_status"));
    assert.ok(agent.getProfile().tool_refs.includes("sandbox_environment_hibernate"));
    assert.ok(agent.getProfile().tool_refs.includes("sandbox_environment_resume"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createReasoner() {
  return {
    name: "advanced-sandbox-test-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "advanced-sandbox-test-reasoner",
        proposal_type: "plan",
        salience_score: 0.5,
        confidence: 0.8,
        risk: 0,
        payload: { summary: "sandbox test" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "sandbox",
        description: "sandbox test",
        side_effect_level: "none"
      }];
    }
  };
}
