import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SandboxPolicyProvider } from "@neurocore/policy-core";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import {
  DockerSandboxProvider,
  LocalSandboxProvider,
  SandboxManager,
  SshSandboxProvider
} from "../examples/personal-assistant/dist/sandbox/sandbox-provider.js";
import {
  createSandboxFileReadTool,
  createSandboxFileWriteTool,
  createSandboxShellTool
} from "../examples/personal-assistant/dist/sandbox/sandbox-tools.js";

test("sandbox providers support local, docker and ssh execution targets with trace metadata", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-sandbox-local-"));
  const local = new LocalSandboxProvider({ cwd: tempDir });
  const localResult = await local.execute({
    operation: "exec",
    command: "printf sandbox-ok",
    timeout_ms: 1000
  });
  assert.equal(localResult.target, "local");
  assert.equal(localResult.exit_code, 0);
  assert.equal(localResult.stdout, "sandbox-ok");
  assert.equal(localResult.trace.executable, "sh");
  rmSync(tempDir, { recursive: true, force: true });

  const dockerRunner = new CapturingRunner({ stdout: "docker-ok\n" });
  const docker = new DockerSandboxProvider({
    image: "sandbox-image:latest",
    hostWorkspace: "/host/workspace",
    containerWorkspace: "/workspace",
    runner: dockerRunner
  });
  const dockerResult = await docker.execute({
    operation: "exec",
    command: "echo docker-ok",
    timeout_ms: 2000
  });
  assert.equal(dockerResult.target, "docker");
  assert.equal(dockerResult.stdout, "docker-ok\n");
  assert.equal(dockerRunner.calls[0].executable, "docker");
  assert.deepEqual(dockerRunner.calls[0].args.slice(0, 4), ["run", "--rm", "-i", "-v"]);
  assert.ok(dockerRunner.calls[0].args.includes("sandbox-image:latest"));

  const sshRunner = new CapturingRunner({ stdout: "ssh-ok\n" });
  const ssh = new SshSandboxProvider({
    host: "sandbox.example",
    user: "agent",
    port: 2222,
    workspace: "/remote/workspace",
    runner: sshRunner
  });
  const sshResult = await ssh.execute({
    operation: "exec",
    command: "echo ssh-ok",
    timeout_ms: 2000
  });
  assert.equal(sshResult.target, "ssh");
  assert.equal(sshResult.stdout, "ssh-ok\n");
  assert.equal(sshRunner.calls[0].executable, "ssh");
  assert.deepEqual(sshRunner.calls[0].args.slice(0, 3), ["-p", "2222", "agent@sandbox.example"]);
  assert.match(sshRunner.calls[0].args.at(-1), /\/remote\/workspace/);
});

test("sandbox file and shell tools route operations through the selected provider", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-sandbox-tools-"));
  const manager = new SandboxManager([new LocalSandboxProvider({ cwd: tempDir })], "local");
  const shellTool = createSandboxShellTool(manager);
  const writeTool = createSandboxFileWriteTool(manager);
  const readTool = createSandboxFileReadTool(manager);

  try {
    const shell = await shellTool.invoke({ command: "printf shell-ok" }, toolCtx());
    assert.match(shell.summary, /SANDBOX_TRACE/);
    assert.equal(shell.payload?.sandbox?.target, "local");
    assert.equal(shell.payload?.stdout, "shell-ok");

    const write = await writeTool.invoke({
      path: "note.txt",
      content: "sandbox file"
    }, toolCtx());
    assert.equal(write.payload?.sandbox?.operation, "file_write");
    assert.equal(write.payload?.bytes_written, 12);
    assert.equal(readFileSync(join(tempDir, "note.txt"), "utf8"), "sandbox file");

    const read = await readTool.invoke({ path: "note.txt" }, toolCtx());
    assert.equal(read.payload?.sandbox?.operation, "file_read");
    assert.equal(read.payload?.stdout, "sandbox file");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant registers sandbox tools and keeps command output traceable", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-sandbox-"));
  const manager = new SandboxManager([new LocalSandboxProvider({ cwd: tempDir })], "local");

  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "tenant-sandbox",
      reasoner: createSandboxReasoner(),
      agent: {
        auto_approve: true
      },
      sandbox: {
        enabled: true,
        default_target: "local",
        force_tools: ["shell", "file_write"]
      }
    }, {
      sandboxManager: manager
    });

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-sandbox",
      initial_input: {
        content: "run sandbox shell"
      }
    });
    const result = await session.run();
    const observation = session.getTraceRecords().find((record) =>
      record.selected_action?.tool_name === "sandbox_shell" &&
      record.observation?.status === "success"
    )?.observation;

    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /SANDBOX_TRACE/);
    assert.match(result.outputText ?? "", /agent-sandbox-ok/);
    assert.equal(observation?.structured_payload?.sandbox?.target, "local");
    assert.equal(observation?.structured_payload?.sandbox?.operation, "exec");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sandbox policy can force high-risk shell and file operations into sandbox tools", async () => {
  const provider = new SandboxPolicyProvider({
    requiredSandboxTools: ["shell", "file_write"],
    sandboxedTools: ["sandbox_shell", "sandbox_file_write"]
  });
  const ctx = policyCtx();
  const shellDecisions = await provider.evaluateAction(ctx, {
    action_id: "act-shell",
    action_type: "call_tool",
    title: "Run shell",
    tool_name: "shell",
    tool_args: { command: "rm -rf tmp" },
    side_effect_level: "high"
  });
  assert.equal(shellDecisions[0].level, "block");
  assert.match(shellDecisions[0].reason, /sandbox provider/);

  const sandboxDecisions = await provider.evaluateAction(ctx, {
    action_id: "act-sandbox-shell",
    action_type: "call_tool",
    title: "Run sandbox shell",
    tool_name: "sandbox_shell",
    tool_args: { command: "printf ok" },
    side_effect_level: "high"
  });
  assert.deepEqual(sandboxDecisions, []);
});

class CapturingRunner {
  constructor(result) {
    this.result = result;
    this.calls = [];
  }

  async run(input) {
    this.calls.push(input);
    return {
      exit_code: 0,
      stdout: this.result.stdout ?? "",
      stderr: this.result.stderr ?? "",
      timed_out: false
    };
  }
}

function toolCtx() {
  return {
    tenant_id: "tenant-sandbox",
    session_id: "ses-sandbox",
    cycle_id: "cyc-sandbox"
  };
}

function policyCtx() {
  return {
    tenant_id: "tenant-sandbox",
    session: {
      session_id: "ses-sandbox",
      schema_version: "1.0.0",
      tenant_id: "tenant-sandbox",
      agent_id: "personal-assistant",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal-tree",
      budget_state: {},
      policy_state: {}
    },
    profile: {
      agent_id: "personal-assistant",
      schema_version: "1.0.0",
      name: "Personal Assistant",
      version: "1.0.0",
      role: "assistant",
      mode: "runtime",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: {
        working_memory_enabled: true,
        episodic_memory_enabled: true,
        semantic_memory_enabled: true,
        procedural_memory_enabled: true,
        write_policy: "hybrid"
      },
      runtime_config: {}
    },
    goals: [],
    runtime_state: {},
    services: {
      now: () => new Date().toISOString(),
      generateId: (prefix) => `${prefix}_test`
    }
  };
}

function createSandboxReasoner() {
  return {
    name: "sandbox-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "sandbox-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Run sandbox shell and return observation." }
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
            title: "Return sandbox output",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Run sandbox shell",
          tool_name: "sandbox_shell",
          tool_args: {
            command: "printf agent-sandbox-ok",
            timeout_ms: 1000
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
