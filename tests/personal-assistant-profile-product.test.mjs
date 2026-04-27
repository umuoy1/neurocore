import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { AgentProfileRegistry } from "../examples/personal-assistant/dist/im-gateway/conversation/agent-profile-store.js";
import { SqliteAgentProfileStore } from "../examples/personal-assistant/dist/im-gateway/conversation/sqlite-agent-profile-store.js";
import {
  createProfileProductTools,
  PersonalProfileProductService
} from "../examples/personal-assistant/dist/profiles/profile-product-service.js";

test("profile product service creates inspects switches and detects isolation leaks", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-profile-product-"));
  const dbPath = join(tempDir, "profiles.sqlite");
  const store = new SqliteAgentProfileStore({ filename: dbPath });
  const builder = createPersonalAssistantAgent({
    db_path: dbPath,
    tenant_id: "tenant-profile",
    reasoner: createReasoner()
  });
  const registry = new AgentProfileRegistry({ store, defaultProfileId: "default", generateId: (prefix) => `${prefix}_test` });
  const service = new PersonalProfileProductService({
    registry,
    store,
    builder,
    tenantId: "tenant-profile",
    agentId: "personal-assistant",
    defaultProfileId: "default",
    now: () => "2026-04-28T02:30:00.000Z"
  });

  try {
    const def = service.ensureDefaultProfile();
    assert.equal(def.profile_id, "default");

    const work = service.createProfile({
      profile_id: "work",
      actor_id: "operator",
      display_name: "Work",
      memory_scope: "memory:work",
      tool_scope: "tools:work",
      policy_scope: "policy:work"
    });
    const home = service.createProfile({
      profile_id: "home",
      actor_id: "operator",
      display_name: "Home",
      memory_scope: "memory:home",
      tool_scope: "tools:home",
      policy_scope: "policy:home"
    });
    assert.equal(service.detectIsolationViolations().length, 0);

    const binding = service.switchProfile({
      profile_id: work.profile_id,
      actor_id: "operator",
      user_id: "user-profile",
      platform: "web",
      chat_id: "chat-profile",
      workspace_id: "workspace-work"
    });
    assert.equal(binding.profile_id, "work");
    assert.equal(service.inspectProfile("work").bindings.length, 1);

    service.switchProfile({
      profile_id: home.profile_id,
      actor_id: "operator",
      user_id: "user-profile",
      platform: "web",
      chat_id: "chat-profile",
      workspace_id: "workspace-work"
    });
    assert.equal(store.listBindings({ activeOnly: true }).length, 1);
    assert.equal(store.listBindings({ activeOnly: true })[0].profile_id, "home");

    service.createProfile({
      profile_id: "leaky",
      actor_id: "operator",
      memory_scope: "memory:home",
      tool_scope: "tools:leaky",
      policy_scope: "policy:leaky"
    });
    const leak = service.detectIsolationViolations();
    assert.equal(leak.length, 1);
    assert.equal(leak[0].scope, "memory_scope");

    const tools = new Map(createProfileProductTools(service).map((tool) => [tool.name, tool]));
    const listed = await tools.get("profile_list").invoke({}, { tenant_id: "tenant-profile", session_id: "sess", cycle_id: "cyc" });
    assert.equal(listed.payload.profiles.length, 4);
    const inspected = await tools.get("profile_inspect").invoke({ profile_id: "home" }, { tenant_id: "tenant-profile", session_id: "sess", cycle_id: "cyc" });
    assert.equal(inspected.payload.profile.profile_id, "home");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("profile product console exposes create inspect switch and isolation entry points", () => {
  const app = readFileSync(new URL("../packages/console/src/App.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../packages/console/src/components/layout/AppLayout.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../packages/console/src/stores/personalAssistantProfiles.store.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../packages/console/src/pages/PersonalAssistantProfilesPage.tsx", import.meta.url), "utf8");

  assert.match(app, /\/personal-assistant\/profiles/);
  assert.match(layout, /Assistant Profiles/);
  assert.match(store, /\/v1\/personal-assistant\/profiles/);
  assert.match(store, /\/switch/);
  assert.match(page, /Create Profile/);
  assert.match(page, /Switch Route/);
  assert.match(page, /Zero Leakage/);
});

function createReasoner() {
  return {
    name: "profile-product-reasoner",
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: "profile-product-reasoner",
        proposal_type: "plan",
        salience_score: 0.8,
        confidence: 0.9,
        risk: 0,
        payload: { summary: "profile product test" }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "respond",
        title: "profile",
        description: String(ctx.runtime_state.current_input_metadata?.agent_profile?.profile_id ?? "none"),
        side_effect_level: "none"
      }];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
