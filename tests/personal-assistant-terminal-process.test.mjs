import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import {
  createTerminalBackgroundProcessTools,
  TerminalBackgroundProcessManager
} from "../examples/personal-assistant/dist/terminal/background-process-tools.js";

test("terminal background process tools start, log, write, wait and update task ledger", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-terminal-"));
  try {
    const manager = new TerminalBackgroundProcessManager({ cwd: workspace, defaultTimeoutMs: 10_000 });
    const tools = new Map(createTerminalBackgroundProcessTools(manager).map((tool) => [tool.name, tool]));
    const script = [
      "process.stdout.write('ready\\n');",
      "process.stdin.on('data', chunk => {",
      "  process.stdout.write('stdin:' + chunk.toString());",
      "  if (chunk.toString().includes('done')) process.exit(0);",
      "});",
      "setTimeout(() => {}, 10000);"
    ].join("");
    const start = await tools.get("terminal_process_start").invoke({
      command: `${quoteShell(process.execPath)} -e ${quoteShell(script)}`,
      description: "stdin echo"
    }, {});

    const processId = start.payload.process_id;
    assert.equal(start.payload.status, "running");
    assert.ok(start.payload.task_id);
    assert.equal(manager.taskLedger.get(start.payload.task_id).status, "running");

    await waitForLog(tools, processId, /ready/);
    const firstLog = await tools.get("terminal_process_log").invoke({ process_id: processId }, {});
    assert.match(firstLog.payload.stdout, /ready/);

    await tools.get("terminal_process_write").invoke({
      process_id: processId,
      stdin: "done\n"
    }, {});
    const waited = await tools.get("terminal_process_wait").invoke({
      process_id: processId,
      timeout_ms: 3_000
    }, {});

    assert.equal(waited.payload.status, "exited");
    assert.equal(waited.payload.exit_code, 0);
    const finalLog = await tools.get("terminal_process_log").invoke({
      process_id: processId,
      stdout_offset: firstLog.payload.next_stdout_offset
    }, {});
    assert.match(finalLog.payload.stdout, /stdin:done/);
    assert.equal(manager.taskLedger.get(start.payload.task_id).status, "succeeded");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("terminal background process kill leaves no live child and failed exits enter task ledger", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-terminal-kill-"));
  try {
    const manager = new TerminalBackgroundProcessManager({ cwd: workspace, defaultTimeoutMs: 10_000 });
    const tools = new Map(createTerminalBackgroundProcessTools(manager).map((tool) => [tool.name, tool]));

    const longScript = "setInterval(() => {}, 1000);";
    const started = await tools.get("terminal_process_start").invoke({
      command: `${quoteShell(process.execPath)} -e ${quoteShell(longScript)}`
    }, {});
    const killed = await tools.get("terminal_process_kill").invoke({
      process_id: started.payload.process_id,
      wait_ms: 2_000
    }, {});
    assert.equal(killed.payload.status, "killed");
    assert.equal(manager.taskLedger.get(started.payload.task_id).status, "cancelled");
    assertNoLiveProcess(started.payload.pid);

    const failScript = "process.stderr.write('boom'); process.exit(7);";
    const failedStart = await tools.get("terminal_process_start").invoke({
      command: `${quoteShell(process.execPath)} -e ${quoteShell(failScript)}`
    }, {});
    const failed = await tools.get("terminal_process_wait").invoke({
      process_id: failedStart.payload.process_id,
      timeout_ms: 3_000
    }, {});
    assert.equal(failed.payload.status, "failed");
    assert.equal(failed.payload.exit_code, 7);
    assert.equal(manager.taskLedger.get(failedStart.payload.task_id).status, "failed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("terminal process start requires approval before spawning in personal assistant sessions", { concurrency: false }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-terminal-approval-"));
  try {
    const manager = new TerminalBackgroundProcessManager({ cwd: workspace });
    const config = {
      db_path: join(workspace, "assistant.sqlite"),
      tenant_id: "tenant-terminal",
      reasoner: createTerminalReasoner(),
      agent: {
        approvers: ["owner"]
      },
      terminal: {
        enabled: true,
        cwd: workspace
      }
    };
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath: config.db_path,
      buildAgent: () => createPersonalAssistantAgent(config, { terminalProcessManager: manager })
    });
    const agent = runtimeFactory.getBuilder();
    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-terminal",
      initial_input: {
        content: "start terminal process"
      }
    });

    await session.run();
    const approval = session.getPendingApproval();
    assert.equal(approval?.action.tool_name, "terminal_process_start");
    assert.equal(manager.list().length, 0);

    const approved = await session.approve({
      approval_id: approval.approval_id,
      approver_id: "owner"
    });
    assert.equal(approved.approval.status, "approved");
    assert.equal(manager.list().length, 1);
    const snapshot = await manager.wait(manager.list()[0].process_id, 3_000);
    assert.equal(snapshot.status, "exited");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

async function waitForLog(tools, processId, pattern) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const log = await tools.get("terminal_process_log").invoke({ process_id: processId }, {});
    if (pattern.test(log.payload.stdout) || pattern.test(log.payload.stderr)) {
      return log;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for log ${pattern}`);
}

function assertNoLiveProcess(pid) {
  if (!pid) {
    return;
  }
  assert.throws(() => process.kill(pid, 0));
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createTerminalReasoner() {
  return {
    name: "terminal-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "terminal-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.9,
          risk: 0.6,
          payload: { summary: "Start a terminal background process." }
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
            title: "Terminal result",
            description: input,
            side_effect_level: "none"
          }
        ];
      }
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Start terminal process",
          tool_name: "terminal_process_start",
          tool_args: {
            command: `${quoteShell(process.execPath)} -e ${quoteShell("process.stdout.write('approved\\n')")}`
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
