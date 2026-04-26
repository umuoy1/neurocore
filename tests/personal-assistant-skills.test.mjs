import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { CommandHandler } from "../examples/personal-assistant/dist/im-gateway/command/command-handler.js";
import { normalizePersonalIngressMessage } from "../examples/personal-assistant/dist/im-gateway/ingress.js";
import { AgentSkillRegistry } from "../examples/personal-assistant/dist/skills/agent-skill-registry.js";

test("agent skill registry discovers SKILL.md metadata and enforces channel visibility", () => {
  const tempDir = createSkillFixture();
  try {
    const registry = AgentSkillRegistry.fromDirectories([tempDir]);
    const webSkills = registry.listSkills({ platform: "web" });
    const slackSkills = registry.listSkills({ platform: "slack" });

    assert.equal(webSkills.length, 1);
    assert.equal(webSkills[0].id, "alpha-skill");
    assert.equal(webSkills[0].name, "Alpha Skill");
    assert.equal(webSkills[0].risk_level, "medium");
    assert.deepEqual(webSkills[0].permissions, ["read", "web_search"]);
    assert.deepEqual(webSkills[0].channels, ["web", "telegram"]);
    assert.equal(slackSkills.length, 1);
    assert.equal(slackSkills[0].id, "slack-only");
    assert.equal(registry.searchSkills("alpha", { platform: "web" }).length, 1);
    assert.throws(() => registry.invokeSkill("slack-only", "input", { platform: "web" }), /not available/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("skills command lists, searches, audits and invokes visible skills", async () => {
  const tempDir = createSkillFixture();
  const sent = [];
  try {
    const registry = AgentSkillRegistry.fromDirectories([tempDir]);
    const handler = new CommandHandler({
      router: {},
      dispatcher: {
        async sendToChat(platform, chatId, content) {
          sent.push({ platform, chatId, content });
          return { message_id: `sent-${sent.length}` };
        }
      },
      skillRegistry: registry
    });

    await sendCommand(handler, "/skills", "web");
    assert.match(sent.at(-1).content.text, /alpha-skill: Alpha Skill/);
    assert.doesNotMatch(sent.at(-1).content.text, /slack-only/);

    await sendCommand(handler, "/skills search alpha", "web");
    assert.match(sent.at(-1).content.text, /Alpha Skill/);

    await sendCommand(handler, "/skills audit", "web");
    assert.match(sent.at(-1).content.text, /risk=medium/);
    assert.match(sent.at(-1).content.text, /permissions=read,web_search/);

    await sendCommand(handler, "/skills run alpha-skill summarize", "web");
    assert.match(sent.at(-1).content.text, /Skill invoked: Alpha Skill/);
    assert.match(sent.at(-1).content.text, /input: summarize/);

    await sendCommand(handler, "/skills run slack-only summarize", "web");
    assert.match(sent.at(-1).content.text, /not available/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("personal assistant can invoke indexed skills through governed tools", { concurrency: false }, async () => {
  const tempDir = createSkillFixture();
  try {
    const agent = createPersonalAssistantAgent({
      db_path: join(tempDir, "assistant.sqlite"),
      tenant_id: "test-tenant",
      reasoner: createSkillToolReasoner(),
      skills: {
        directories: [tempDir]
      }
    });

    const session = agent.createSession({
      agent_id: "personal-assistant",
      tenant_id: "test-tenant",
      initial_input: {
        content: "use alpha skill"
      }
    });

    const result = await session.run();
    assert.equal(result.finalState, "completed");
    assert.match(result.outputText ?? "", /Skill Alpha Skill invoked/);
    assert.match(result.outputText ?? "", /permissions=read,web_search/);

    const trace = session.getTraceRecords().find((record) =>
      record.selected_action?.tool_name === "personal_skill_invoke" &&
      record.observation?.status === "success"
    );
    assert.ok(trace);
    assert.equal(trace.observation.structured_payload.skill.id, "alpha-skill");
    assert.equal(trace.observation.structured_payload.allowed, true);
    assert.match(trace.observation.structured_payload.instructions, /Use this skill for alpha workflows/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createSkillFixture() {
  const root = mkdtempSync(join(tmpdir(), "neurocore-pa-skills-"));
  writeSkill(join(root, "alpha"), `---
id: alpha-skill
name: Alpha Skill
description: Handles alpha workflows.
permissions: read, web_search
channels: web, telegram
risk_level: medium
---
# Alpha Skill

Use this skill for alpha workflows.
`);
  writeSkill(join(root, "slack"), `---
id: slack-only
name: Slack Only
description: Visible only in Slack.
permissions: message
channels: slack
risk_level: low
---
# Slack Only

Use this skill only from Slack.
`);
  writeSkill(join(root, "disabled"), `---
id: disabled-skill
name: Disabled Skill
enabled: false
---
# Disabled Skill

Do not load.
`);
  return root;
}

function writeSkill(directory, content) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), content);
}

async function sendCommand(handler, text, platform) {
  await handler.tryHandle(normalizePersonalIngressMessage({
    platform,
    chat_id: `${platform}-chat`,
    sender_id: `${platform}-user`,
    content: text
  }));
}

function createSkillToolReasoner() {
  return {
    name: "skill-tool-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "skill-tool-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0.1,
          payload: { summary: "Invoke an indexed skill." }
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
            title: "Return skill result",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Invoke skill",
          tool_name: "personal_skill_invoke",
          tool_args: {
            skill_id: "alpha-skill",
            input,
            platform: "web"
          },
          side_effect_level: "low"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}
