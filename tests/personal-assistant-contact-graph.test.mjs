import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildContactMessageConfirmation,
  ContactResolver,
  createContactAwareEmailSendTool,
  createContactGraphTools,
  SqliteContactGraphStore
} from "../examples/personal-assistant/dist/main.js";

test("contact graph resolves people organizations channel identities and relationships", async () => {
  const { tempDir, store } = createStore();
  try {
    const userId = "user-contact";
    const org = store.upsertOrganization({
      user_id: userId,
      name: "Acme Research",
      aliases: ["Acme"],
      domain: "acme.example"
    });
    const boss = store.upsertContact({
      user_id: userId,
      display_name: "Ada Manager",
      aliases: ["Ada"],
      email: "ada.manager@example.com",
      organization_id: org.organization_id,
      trust_level: "trusted",
      default_memory_scope: "work:contacts"
    });
    const alexA = store.upsertContact({
      user_id: userId,
      display_name: "Alex Chen",
      aliases: ["Alex"],
      email: "alex.chen@example.com"
    });
    store.upsertContact({
      user_id: userId,
      display_name: "Alex Kim",
      aliases: ["Alex"],
      email: "alex.kim@example.com"
    });
    store.upsertChannelIdentity({
      user_id: userId,
      contact_id: alexA.contact_id,
      platform: "slack",
      handle: "@alex-dev"
    });
    const relationship = store.upsertRelationship({
      user_id: userId,
      contact_id: boss.contact_id,
      relationship_type: "boss",
      label: "manager",
      trust_level: "trusted",
      memory_scope: "work:leadership",
      confirmation_policy: "never"
    });

    const resolver = new ContactResolver(store);
    assert.equal(resolver.resolve(userId, "Ada").contact.contact_id, boss.contact_id);
    assert.equal(resolver.resolve(userId, "Acme").contact.contact_id, boss.contact_id);
    assert.equal(resolver.resolve(userId, "@alex-dev").contact.contact_id, alexA.contact_id);
    assert.equal(resolver.resolve(userId, "boss").memory_scope, "work:leadership");
    assert.equal(resolver.resolve(userId, "Alex").status, "ambiguous");
    assert.equal(resolver.resolve(userId, "missing").status, "not_found");

    const ready = buildContactMessageConfirmation(resolver.resolve(userId, "boss"));
    assert.equal(ready.status, "ready");
    assert.equal(ready.memory_scope, "work:leadership");

    store.upsertRelationship({
      ...relationship,
      trust_level: "external",
      memory_scope: "work:external-review",
      confirmation_policy: "always"
    });
    const changed = buildContactMessageConfirmation(resolver.resolve(userId, "boss"));
    assert.equal(changed.status, "confirmation_required");
    assert.equal(changed.memory_scope, "work:external-review");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("contact-aware email requires clarification or confirmation before sending", async () => {
  const { tempDir, store } = createStore();
  const sent = [];
  const provider = {
    async send(args) {
      sent.push(args);
      return { message_id: `msg-${sent.length}`, sent_at: "2026-04-28T02:20:00.000Z" };
    }
  };

  try {
    const userId = "user-contact";
    const boss = store.upsertContact({
      user_id: userId,
      display_name: "Ada Manager",
      aliases: ["Ada"],
      email: "ada.manager@example.com",
      trust_level: "trusted"
    });
    store.upsertContact({
      user_id: userId,
      display_name: "Alex Chen",
      aliases: ["Alex"],
      email: "alex.chen@example.com"
    });
    store.upsertContact({
      user_id: userId,
      display_name: "Alex Kim",
      aliases: ["Alex"],
      email: "alex.kim@example.com"
    });
    store.upsertRelationship({
      user_id: userId,
      contact_id: boss.contact_id,
      relationship_type: "boss",
      trust_level: "external",
      memory_scope: "work:external-review",
      confirmation_policy: "always"
    });

    const emailTool = createContactAwareEmailSendTool(provider, store);
    const ambiguous = await emailTool.invoke({
      user_id: userId,
      to: ["Alex"],
      subject: "Question",
      body: "Hi"
    }, { tenant_id: "tenant-contact", session_id: "sess-contact", cycle_id: "cycle-contact" });
    assert.equal(ambiguous.payload.status, "clarification_required");
    assert.equal(sent.length, 0);

    const confirmation = await emailTool.invoke({
      user_id: userId,
      to: ["boss"],
      subject: "Review",
      body: "Please review"
    }, { tenant_id: "tenant-contact", session_id: "sess-contact", cycle_id: "cycle-contact" });
    assert.equal(confirmation.payload.status, "confirmation_required");
    assert.equal(sent.length, 0);

    const sentResult = await emailTool.invoke({
      user_id: userId,
      to: ["boss"],
      confirmed_contact_ids: [boss.contact_id],
      subject: "Review",
      body: "Please review"
    }, { tenant_id: "tenant-contact", session_id: "sess-contact", cycle_id: "cycle-contact" });
    assert.equal(sentResult.payload.message_id, "msg-1");
    assert.deepEqual(sent[0].to, ["ada.manager@example.com"]);
    assert.deepEqual(sentResult.payload.memory_scopes, ["work:external-review"]);

    const tools = new Map(createContactGraphTools(store).map((tool) => [tool.name, tool]));
    const resolved = await tools.get("contact_resolve").invoke({
      user_id: userId,
      query: "boss"
    }, { tenant_id: "tenant-contact", session_id: "sess-contact", cycle_id: "cycle-contact" });
    assert.equal(resolved.payload.status, "resolved");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-contact-"));
  return {
    tempDir,
    store: new SqliteContactGraphStore({ filename: join(tempDir, "assistant.sqlite") })
  };
}
