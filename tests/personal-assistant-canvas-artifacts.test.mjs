import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPersonalAssistantAgent,
  startPersonalAssistantApp
} from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import {
  createCanvasArtifactTools,
  InMemoryCanvasArtifactStore,
  sanitizeCanvasHtml
} from "../examples/personal-assistant/dist/canvas/canvas-artifact-store.js";

test("canvas artifact tools create update preview sanitize and rollback HTML versions", async () => {
  const store = new InMemoryCanvasArtifactStore();
  const tools = new Map(createCanvasArtifactTools(store).map((tool) => [tool.name, tool]));
  const ctx = { tenant_id: "tenant-canvas", session_id: "session-canvas", cycle_id: "cycle-canvas" };

  const create = await tools.get("canvas_artifact_create").invoke({
    artifact_id: "canvas-tool",
    title: "Tool Canvas",
    owner_id: "user-canvas",
    html: `<main onclick="alert(1)"><h1>Safe</h1><script>window.bad=1</script><a href="javascript:bad()">bad</a></main>`
  }, ctx);
  assert.equal(create.payload.artifact.current_version_no, 1);
  assert.doesNotMatch(create.payload.preview.html, /<script|onclick|javascript:/i);
  assert.match(create.payload.preview.content_security_policy, /script-src 'none'/);
  assert.doesNotMatch(create.payload.preview.iframe_sandbox, /allow-scripts/);

  const update = await tools.get("canvas_artifact_update").invoke({
    artifact_id: "canvas-tool",
    html: "<main><h1>Safe v2</h1><p>Added line</p></main>"
  }, ctx);
  assert.equal(update.payload.artifact.current_version_no, 2);
  assert.match(update.payload.version.diff, /\+<main><h1>Safe v2/);

  const preview = await tools.get("canvas_artifact_preview").invoke({
    artifact_id: "canvas-tool"
  }, ctx);
  assert.equal(preview.payload.preview.version_no, 2);

  const rollback = await tools.get("canvas_artifact_rollback").invoke({
    artifact_id: "canvas-tool",
    target_version_no: 1
  }, ctx);
  assert.equal(rollback.payload.artifact.current_version_no, 3);
  const artifact = store.inspect("canvas-tool");
  assert.equal(artifact.versions.length, 3);
  assert.doesNotMatch(artifact.versions.at(-1).sanitized_html, /<script|onclick|javascript:/i);
});

test("personal assistant runtime creates and updates a canvas artifact", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-canvas-runtime-"));
  const store = new InMemoryCanvasArtifactStore();

  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "tenant-canvas",
      reasoner: createCanvasReasoner(),
      agent: {
        auto_approve: true,
        max_cycles: 4
      }
    }, {
      canvasArtifactStore: store
    });
    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-canvas",
      initial_input: {
        content: "create and improve a canvas"
      }
    });
    const result = await session.run();
    const artifact = store.inspect("canvas-runtime");

    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /canvas artifact canvas-runtime/i);
    assert.equal(artifact.versions.length, 2);
    assert.match(artifact.versions.at(-1).sanitized_html, /Improved/);
    assert.doesNotMatch(artifact.versions.at(-1).sanitized_html, /<script/i);
    assert.ok(findToolObservations(session, "canvas_artifact_create").length === 1);
    assert.ok(findToolObservations(session, "canvas_artifact_update").length === 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant app config can register canvas tools", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-canvas-app-"));
  const app = await startPersonalAssistantApp({
    db_path: join(tempDir, "assistant.sqlite"),
    tenant_id: "tenant-canvas",
    reasoner: createCanvasReasoner(),
    web_chat: {
      enabled: false
    },
    canvas: {
      enabled: true
    }
  });

  try {
    assert.ok(app.canvasArtifactStore);
    assert.ok(app.builder.getProfile().tool_refs.includes("canvas_artifact_create"));
    assert.ok(app.builder.getProfile().tool_refs.includes("canvas_artifact_rollback"));
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("console exposes canvas artifact surface with CSP sandbox preview", () => {
  const app = readFileSync(new URL("../packages/console/src/App.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../packages/console/src/components/layout/AppLayout.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../packages/console/src/stores/personalAssistantCanvas.store.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../packages/console/src/pages/PersonalAssistantCanvasPage.tsx", import.meta.url), "utf8");

  assert.match(app, /\/personal-assistant\/canvas/);
  assert.match(layout, /Assistant Canvas/);
  assert.match(store, /\/v1\/personal-assistant\/canvas/);
  assert.match(store, /rollback/);
  assert.match(page, /iframe/);
  assert.match(page, /sandbox=\{preview\.iframe_sandbox\}/);
  assert.match(page, /content_security_policy/);
});

test("canvas sanitizer removes script event handlers and javascript URLs", () => {
  const sanitized = sanitizeCanvasHtml(`<section onmouseover="bad()"><script>bad()</script><a href='javascript:bad()'>x</a></section>`);
  assert.doesNotMatch(sanitized, /script|onmouseover|javascript:/i);
  assert.match(sanitized, /#blocked/);
});

function createCanvasReasoner() {
  let step = 0;
  return {
    name: "canvas-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "canvas-reasoner",
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: "Create and update canvas artifact." }
      }];
    },
    async respond(ctx) {
      if (step === 0) {
        step += 1;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Create canvas",
          tool_name: "canvas_artifact_create",
          tool_args: {
            artifact_id: "canvas-runtime",
            title: "Runtime Canvas",
            owner_id: "user-canvas",
            html: "<main><h1>Initial</h1></main>"
          },
          side_effect_level: "medium"
        }];
      }
      if (step === 1) {
        step += 1;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Update canvas",
          tool_name: "canvas_artifact_update",
          tool_args: {
            artifact_id: "canvas-runtime",
            html: "<main><h1>Improved</h1><script>bad()</script></main>"
          },
          side_effect_level: "medium"
        }];
      }
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "Return canvas result",
        description: "Canvas artifact canvas-runtime created and updated.",
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function findToolObservations(session, toolName) {
  return session.getTraceRecords().filter((candidate) =>
    candidate.selected_action?.tool_name === toolName &&
    candidate.observation?.status === "success"
  );
}
