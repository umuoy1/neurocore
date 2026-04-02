import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createUserInput } from "../examples/personal-assistant/dist/im-gateway/input/input-factory.js";
import { ConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/conversation-router.js";
import { SqliteSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-session-mapping-store.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";

test("personal assistant router reconnects to waiting sessions for the same chat", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-router-"));
  const dbPath = join(tempDir, "assistant.sqlite");

  try {
    const runtimeFactory = new AssistantRuntimeFactory({
      dbPath,
      buildAgent: () => createPersonalAssistantAgent({
        db_path: dbPath,
        tenant_id: "test-tenant",
        reasoner: createAskUserReasoner()
      })
    });
    const builder = runtimeFactory.getBuilder();
    const router = new ConversationRouter({
      builder,
      tenantId: "test-tenant",
      mappingStore: new SqliteSessionMappingStore({ filename: dbPath })
    });

    const message = {
      message_id: "msg-1",
      platform: "web",
      chat_id: "chat-1",
      sender_id: "user-1",
      timestamp: new Date().toISOString(),
      content: { type: "text", text: "hello" },
      metadata: {}
    };

    const first = router.resolveOrCreate(message, createUserInput("hello"));
    const firstRun = await first.handle.run();
    assert.equal(first.is_new, true);
    assert.equal(firstRun.finalState, "waiting");

    const second = router.resolveOrCreate(
      { ...message, message_id: "msg-2", content: { type: "text", text: "tell me more" } },
      createUserInput("tell me more")
    );

    assert.equal(second.is_new, false);
    assert.equal(second.session_id, first.session_id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createAskUserReasoner() {
  return {
    name: "ask-user-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "ask-user-reasoner",
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: "Ask a follow-up question." }
        }
      ];
    },
    async respond(ctx) {
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "ask_user",
          title: "Ask a follow-up",
          description: "What should I do next?",
          side_effect_level: "none"
        }
      ];
    }
  };
}
