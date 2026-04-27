import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import {
  BrowserSessionManager,
  createBrowserSessionTools
} from "../examples/personal-assistant/dist/browser/browser-session-tools.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";

test("browser profile tools keep login state, capture artifacts and cleanup profile", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-browser-"));
  const server = await startLoginServer();
  try {
    const profileRoot = join(workspace, "profiles");
    const manager = new BrowserSessionManager({ profileRoot });
    const tools = new Map(createBrowserSessionTools(manager).map((tool) => [tool.name, tool]));

    const start = await tools.get("browser_session_start").invoke({ profile_id: "alice" }, {});
    const sessionId = start.payload.session_id;
    const profileDir = start.payload.profile_dir;
    assert.equal(start.payload.status, "open");
    assert.equal(existsSync(profileDir), true);

    const login = await tools.get("browser_session_navigate").invoke({
      session_id: sessionId,
      url: `${server.origin}/login`
    }, {});
    assert.match(login.payload.content, /Login/);
    assert.equal(login.payload.untrusted_content, true);

    await tools.get("browser_session_type").invoke({
      session_id: sessionId,
      selector: "#username",
      text: "alice"
    }, {});
    await tools.get("browser_session_type").invoke({
      session_id: sessionId,
      selector: "#password",
      text: "secret"
    }, {});
    const clicked = await tools.get("browser_session_click").invoke({
      session_id: sessionId,
      selector: "#submit"
    }, {});
    assert.match(clicked.payload.content, /Dashboard for alice/);
    assert.equal(clicked.payload.cookies.auth, "ok");

    const app = await tools.get("browser_session_navigate").invoke({
      session_id: sessionId,
      url: `${server.origin}/app`
    }, {});
    assert.match(app.payload.content, /Private app for alice/);

    const screenshot = await tools.get("browser_session_screenshot").invoke({ session_id: sessionId }, {});
    assert.equal(screenshot.payload.artifact_type, "browser_screenshot");
    assert.match(Buffer.from(screenshot.payload.data_base64, "base64").toString("utf8"), /Private app/);

    const pdf = await tools.get("browser_session_pdf").invoke({ session_id: sessionId }, {});
    assert.equal(pdf.payload.mime_type, "application/pdf");
    assert.match(Buffer.from(pdf.payload.data_base64, "base64").toString("utf8"), /^%PDF-1\.1/);

    const snapshot = await tools.get("browser_session_snapshot").invoke({ session_id: sessionId }, {});
    assert.match(snapshot.payload.content, /Private app/);
    assert.equal(snapshot.payload.browser_trace.profile_id, "alice");

    const closed = await tools.get("browser_session_close").invoke({ session_id: sessionId }, {});
    assert.equal(closed.payload.status, "closed");
    assert.equal(existsSync(profileDir), false);
  } finally {
    await server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("browser profile click requires approval before mutating browser state", { concurrency: false }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-browser-approval-"));
  const server = await startLoginServer();
  try {
    const manager = new BrowserSessionManager({ profileRoot: join(workspace, "profiles") });
    const started = manager.start("approval");
    await manager.navigate(started.session_id, `${server.origin}/login`);
    await manager.type(started.session_id, "#username", "alice");
    await manager.type(started.session_id, "#password", "secret");

    const config = {
      db_path: join(workspace, "assistant.sqlite"),
      tenant_id: "tenant-browser",
      reasoner: createBrowserClickReasoner(started.session_id),
      agent: {
        approvers: ["owner"]
      },
      browser_profile: {
        enabled: true,
        profile_root: join(workspace, "profiles")
      }
    };
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath: config.db_path,
      buildAgent: () => createPersonalAssistantAgent(config, { browserSessionManager: manager })
    });
    const agent = runtimeFactory.getBuilder();
    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-browser",
      initial_input: {
        content: "click login"
      }
    });

    await session.run();
    const approval = session.getPendingApproval();
    assert.equal(approval?.action.tool_name, "browser_session_click");
    const before = await manager.snapshot(started.session_id);
    assert.match(before.content, /Login/);

    const approved = await session.approve({
      approval_id: approval.approval_id,
      approver_id: "owner"
    });
    assert.equal(approved.approval.status, "approved");
    const after = await manager.snapshot(started.session_id);
    assert.match(after.content, /Dashboard for alice/);
  } finally {
    await server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

async function startLoginServer() {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html>
        <title>Login</title>
        <form action="/login" method="POST">
          <input id="username" name="username" />
          <input id="password" name="password" />
          <button id="submit" type="submit">Sign in</button>
        </form>`);
      return;
    }
    if (req.method === "POST" && req.url === "/login") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      if (params.get("username") === "alice" && params.get("password") === "secret") {
        res.writeHead(200, {
          "content-type": "text/html",
          "set-cookie": "auth=ok; Path=/"
        });
        res.end("<!doctype html><title>Dashboard</title><main>Dashboard for alice</main>");
        return;
      }
      res.writeHead(403, { "content-type": "text/html" });
      res.end("<title>Denied</title>Denied");
      return;
    }
    if (req.method === "GET" && req.url === "/app") {
      if (String(req.headers.cookie ?? "").includes("auth=ok")) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>Private</title><main>Private app for alice</main>");
        return;
      }
      res.writeHead(401, { "content-type": "text/html" });
      res.end("<title>Unauthorized</title>Unauthorized");
      return;
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<title>Missing</title>Missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function createBrowserClickReasoner(browserSessionId) {
  return {
    name: "browser-click-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "browser-click-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.9,
          risk: 0.5,
          payload: { summary: "Click browser login." }
        }
      ];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";
      if (input.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Browser result",
            description: input,
            side_effect_level: "none"
          }
        ];
      }
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Click browser",
          tool_name: "browser_session_click",
          tool_args: {
            session_id: browserSessionId,
            selector: "#submit"
          },
          side_effect_level: "high"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
