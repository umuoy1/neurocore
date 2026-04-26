import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { createUserInput } from "../examples/personal-assistant/dist/im-gateway/input/input-factory.js";
import { AssistantRuntimeFactory } from "../examples/personal-assistant/dist/im-gateway/runtime/assistant-runtime-factory.js";
import { AgentProfileRegistry } from "../examples/personal-assistant/dist/im-gateway/conversation/agent-profile-store.js";
import { ProfileAwareConversationRouter } from "../examples/personal-assistant/dist/im-gateway/conversation/profile-aware-conversation-router.js";
import { SqliteAgentProfileStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-agent-profile-store.js";
import { SqliteProfileScopedSessionMappingStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-profile-scoped-session-mapping-store.js";

test("profile-aware router isolates profiles and selects by user channel and workspace", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-agent-profiles-"));
  const routeDbPath = join(tempDir, "profiles.sqlite");

  try {
    const workBuilder = createBuilder(join(tempDir, "work.sqlite"), "work-agent", "tenant-work", "work");
    const homeBuilder = createBuilder(join(tempDir, "home.sqlite"), "home-agent", "tenant-home", "home");
    workBuilder.registerTool(createTool("work_calendar"));
    homeBuilder.registerTool(createTool("home_media"));

    const profileStore = new SqliteAgentProfileStore({ filename: routeDbPath });
    const registry = new AgentProfileRegistry({
      store: profileStore,
      defaultProfileId: "home",
      generateId: deterministicId()
    });
    registry.registerProfile({
      profile: {
        profile_id: "home",
        tenant_id: "tenant-home",
        display_name: "Home Assistant",
        memory_scope: "memory:home",
        tool_scope: "tools:home",
        policy_scope: "policy:home",
        default_workspace_id: "home",
        tool_policy: {
          blocked_tools: ["work_calendar"]
        }
      },
      builder: homeBuilder
    });
    registry.registerProfile({
      profile: {
        profile_id: "work",
        tenant_id: "tenant-work",
        display_name: "Work Assistant",
        memory_scope: "memory:work",
        tool_scope: "tools:work",
        policy_scope: "policy:work",
        default_workspace_id: "work",
        tool_policy: {
          required_approval_tools: ["work_calendar"]
        }
      },
      builder: workBuilder
    });
    registry.upsertBinding({
      binding_id: "bind-work-chat",
      profile_id: "work",
      platform: "slack",
      chat_id: "shared-chat",
      workspace_id: "work",
      priority: 100
    });
    registry.upsertBinding({
      binding_id: "bind-home-chat",
      profile_id: "home",
      platform: "slack",
      chat_id: "shared-chat",
      workspace_id: "home",
      priority: 100
    });
    registry.upsertBinding({
      binding_id: "bind-home-user",
      profile_id: "home",
      user_id: "family-user",
      priority: 50
    });

    const mappingStore = new SqliteProfileScopedSessionMappingStore({ filename: routeDbPath });
    const router = new ProfileAwareConversationRouter({
      profileRegistry: registry,
      mappingStore
    });

    const work = router.resolveOrCreate(
      createMessage("msg-work-1", "slack", "shared-chat", "user-1", "work"),
      createUserInput("work question")
    );
    const home = router.resolveOrCreate(
      createMessage("msg-home-1", "slack", "shared-chat", "user-1", "home"),
      createUserInput("home question")
    );
    const family = router.resolveOrCreate(
      createMessage("msg-family-1", "telegram", "dm-1", "family-user"),
      createUserInput("family question")
    );
    const workAgain = router.resolveOrCreate(
      createMessage("msg-work-2", "slack", "shared-chat", "user-1", "work"),
      createUserInput("next work question")
    );

    assert.equal(work.agent_profile_id, "work");
    assert.equal(home.agent_profile_id, "home");
    assert.equal(family.agent_profile_id, "home");
    assert.equal(work.workspace_id, "work");
    assert.equal(home.workspace_id, "home");
    assert.notEqual(work.session_id, home.session_id);
    assert.equal(workAgain.is_new, false);
    assert.equal(workAgain.session_id, work.session_id);

    assert.equal(work.runtime_input.metadata.agent_profile.memory_scope, "memory:work");
    assert.equal(home.runtime_input.metadata.agent_profile.memory_scope, "memory:home");
    assert.equal(work.runtime_input.metadata.agent_profile.tool_scope, "tools:work");
    assert.equal(home.runtime_input.metadata.agent_profile.policy_scope, "policy:home");

    const workRun = await work.handle.run();
    const homeRun = await home.handle.run();
    assert.match(workRun.outputText, /work:work:memory:work:policy:work/);
    assert.match(homeRun.outputText, /home:home:memory:home:policy:home/);

    const scopedWorkRoute = mappingStore.getRoute("slack", "shared-chat", {
      agent_profile_id: "work",
      workspace_id: "work"
    });
    const scopedHomeRoute = mappingStore.getRoute("slack", "shared-chat", {
      agent_profile_id: "home",
      workspace_id: "home"
    });
    assert.equal(scopedWorkRoute.session_id, work.session_id);
    assert.equal(scopedHomeRoute.session_id, home.session_id);
    assert.equal(mappingStore.listRoutesForUser("user-1").length, 2);
    assert.equal(router.connect(work.session_id).id, work.session_id);
    assert.equal(router.connect(home.session_id).id, home.session_id);

    const profiles = registry.listProfiles();
    const workProfile = profiles.find((profile) => profile.profile_id === "work");
    const homeProfile = profiles.find((profile) => profile.profile_id === "home");
    assert.deepEqual(workProfile.tool_policy.required_approval_tools, ["work_calendar"]);
    assert.deepEqual(homeProfile.tool_policy.blocked_tools, ["work_calendar"]);
    assert.ok(workBuilder.getProfile().tool_refs.includes("work_calendar"));
    assert.ok(!workBuilder.getProfile().tool_refs.includes("home_media"));
    assert.ok(homeBuilder.getProfile().tool_refs.includes("home_media"));
    assert.ok(!homeBuilder.getProfile().tool_refs.includes("work_calendar"));

    profileStore.close();
    mappingStore.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent profile policy changes are audited and persisted", { concurrency: false }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-agent-profile-audit-"));
  const dbPath = join(tempDir, "profiles.sqlite");

  try {
    const builder = createBuilder(join(tempDir, "work.sqlite"), "work-agent", "tenant-work", "work");
    const store = new SqliteAgentProfileStore({ filename: dbPath });
    const registry = new AgentProfileRegistry({
      store,
      defaultProfileId: "work",
      generateId: deterministicId()
    });
    registry.registerProfile({
      profile: {
        profile_id: "work",
        tenant_id: "tenant-work",
        memory_scope: "memory:work",
        tool_scope: "tools:work",
        policy_scope: "policy:work",
        tool_policy: {
          blocked_tools: ["legacy_shell"]
        }
      },
      builder
    });

    const audit = registry.updateProfileToolPolicy({
      profile_id: "work",
      actor_id: "admin-user",
      tool_policy: {
        blocked_tools: ["shell"],
        required_approval_tools: ["email_send"]
      },
      metadata: {
        reason: "tighten production profile"
      },
      apply_runtime_policy: true
    });

    assert.equal(audit.profile_id, "work");
    assert.equal(audit.actor_id, "admin-user");
    assert.deepEqual(audit.before.tool_policy, { blocked_tools: ["legacy_shell"] });
    assert.deepEqual(audit.after.tool_policy, {
      blocked_tools: ["shell"],
      required_approval_tools: ["email_send"]
    });

    const persistedProfile = store.getProfile("work");
    assert.deepEqual(persistedProfile.tool_policy.blocked_tools, ["shell"]);
    assert.deepEqual(persistedProfile.tool_policy.required_approval_tools, ["email_send"]);

    const auditEntries = store.listPolicyAudit("work");
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0].change_type, "tool_policy_update");
    assert.equal(auditEntries[0].metadata.reason, "tighten production profile");
    assert.ok(builder.getProfile().policies.policy_ids.includes("tool-policy-provider"));

    store.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createBuilder(dbPath, agentId, tenantId, label) {
  const factory = new AssistantRuntimeFactory({
    dbPath,
    buildAgent: () => createPersonalAssistantAgent({
      db_path: dbPath,
      tenant_id: tenantId,
      agent: {
        id: agentId,
        name: `${label} assistant`
      },
      reasoner: createProfileReasoner(label)
    })
  });
  return factory.getBuilder();
}

function createProfileReasoner(label) {
  return {
    name: `${label}-profile-reasoner`,
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: `${label}-profile-reasoner`,
          proposal_type: "plan",
          salience_score: 0.8,
          confidence: 0.9,
          risk: 0,
          payload: { summary: `Respond as ${label}.` }
        }
      ];
    },
    async respond(ctx) {
      const profile = ctx.runtime_state.current_input_metadata?.agent_profile ?? {};
      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: `Respond as ${label}`,
          description: `${label}:${profile.profile_id}:${profile.memory_scope}:${profile.policy_scope}`,
          side_effect_level: "none"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function createTool(name) {
  return {
    name,
    description: `${name} test tool`,
    sideEffectLevel: "low",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    async invoke() {
      return {
        summary: `${name} invoked`
      };
    }
  };
}

function createMessage(messageId, platform, chatId, senderId, workspaceId) {
  return {
    message_id: messageId,
    platform,
    chat_id: chatId,
    sender_id: senderId,
    timestamp: new Date().toISOString(),
    content: { type: "text", text: "hello" },
    channel: {
      platform,
      kind: platform === "web" ? "web" : platform === "cli" ? "cli" : "im",
      chat_id: chatId,
      route_key: `${platform}:${chatId}`,
      capabilities: {
        text: true,
        markdown: true,
        status: true,
        images: false,
        files: false,
        actions: true,
        approval_requests: true,
        typing: false,
        streaming: false,
        edits: false,
        threads: false,
        reactions: false,
        voice: false
      },
      metadata: workspaceId ? { workspace_id: workspaceId } : {}
    },
    metadata: workspaceId ? { workspace_id: workspaceId } : {}
  };
}

function deterministicId() {
  let counter = 0;
  return (prefix) => `${prefix}-${++counter}`;
}
