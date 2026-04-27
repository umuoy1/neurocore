import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { createWorkspaceFileTools } from "../examples/personal-assistant/dist/files/workspace-file-tools.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";

test("workspace file tools read, write, edit, patch, diff, search and rollback inside root", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-files-"));
  try {
    const tools = new Map(createWorkspaceFileTools({ workspaceRoot: workspace }).map((tool) => [tool.name, tool]));

    const write = await tools.get("workspace_file_write").invoke({
      path: "notes/a.txt",
      content: "hello old\n"
    }, {});
    assert.equal(readFileSync(join(workspace, "notes", "a.txt"), "utf8"), "hello old\n");
    assert.match(write.payload.diff, /\+hello old/);
    assert.ok(write.payload.rollback_id);

    const read = await tools.get("workspace_file_read").invoke({ path: "notes/a.txt" }, {});
    assert.equal(read.payload.content, "hello old\n");

    const edit = await tools.get("workspace_file_edit").invoke({
      path: "notes/a.txt",
      find: "old",
      replace: "new"
    }, {});
    assert.match(edit.payload.diff, /-hello old/);
    assert.match(edit.payload.diff, /\+hello new/);
    assert.equal(readFileSync(join(workspace, "notes", "a.txt"), "utf8"), "hello new\n");

    const patch = await tools.get("workspace_file_apply_patch").invoke({
      path: "notes/a.txt",
      replacements: [{ find: "hello new", replace: "final value" }]
    }, {});
    assert.equal(readFileSync(join(workspace, "notes", "a.txt"), "utf8"), "final value\n");

    const search = await tools.get("workspace_file_search").invoke({ query: "final" }, {});
    assert.equal(search.payload.matches[0].path, "notes/a.txt");

    const diff = await tools.get("workspace_file_diff").invoke({
      path: "notes/a.txt",
      content: "final value\nnext\n"
    }, {});
    assert.match(diff.payload.diff, /\+next/);

    const rollback = await tools.get("workspace_file_rollback").invoke({
      rollback_id: patch.payload.rollback_id
    }, {});
    assert.match(rollback.payload.diff, /-final value/);
    assert.equal(readFileSync(join(workspace, "notes", "a.txt"), "utf8"), "hello new\n");

    await assert.rejects(
      () => tools.get("workspace_file_read").invoke({ path: "../escape.txt" }, {}),
      /Path escapes workspace root/
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("workspace file write requires approval before mutating the workspace", { concurrency: false }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "neurocore-pa-file-approval-"));
  try {
    const config = {
      db_path: join(workspace, "assistant.sqlite"),
      tenant_id: "tenant-files",
      reasoner: createFileWriteReasoner(),
      agent: {
        approvers: ["owner"]
      },
      files: {
        enabled: true,
        workspace_root: workspace
      }
    };
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath: config.db_path,
      buildAgent: () => createPersonalAssistantAgent(config)
    });
    const agent = runtimeFactory.getBuilder();

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "tenant-files",
      initial_input: {
        content: "write file"
      }
    });

    await session.run();
    const approval = session.getPendingApproval();
    assert.equal(approval?.action.tool_name, "workspace_file_write");
    assert.equal(existsSync(join(workspace, "approved.txt")), false);

    const approved = await session.approve({
      approval_id: approval.approval_id,
      approver_id: "owner"
    });

    assert.equal(readFileSync(join(workspace, "approved.txt"), "utf8"), "approved content\n");
    assert.equal(approved.approval.status, "approved");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createFileWriteReasoner() {
  return {
    name: "file-write-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "file-write-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.9,
          risk: 0.4,
          payload: { summary: "Write a workspace file." }
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
            title: "File result",
            description: input,
            side_effect_level: "none"
          }
        ];
      }
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Write workspace file",
          tool_name: "workspace_file_write",
          tool_args: {
            path: "approved.txt",
            content: "approved content\n"
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
