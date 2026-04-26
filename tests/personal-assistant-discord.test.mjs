import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAdapter } from "../examples/personal-assistant/dist/im-gateway/adapter/discord.js";

test("discord adapter normalizes gateway messages and rejects unauthorized or bot authors", async () => {
  const adapter = new DiscordAdapter({ fetch: createDiscordFetchRecorder().fetch });
  const observed = [];

  adapter.onMessage((message) => {
    observed.push(message);
  });
  await adapter.start({
    auth: {
      bot_token: "discord-token"
    },
    allowed_senders: ["U123"]
  });

  assert.equal(await adapter.receiveGatewayEvent({
    t: "MESSAGE_CREATE",
    d: {
      id: "M123",
      channel_id: "C123",
      guild_id: "G123",
      author: {
        id: "U123",
        username: "ada",
        global_name: "Ada"
      },
      content: "**hello** from discord",
      timestamp: "2026-04-27T03:02:00.000Z",
      message_reference: {
        message_id: "M122"
      }
    }
  }), true);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "discord");
  assert.equal(observed[0].chat_id, "C123");
  assert.equal(observed[0].sender_id, "U123");
  assert.equal(observed[0].content.type, "markdown");
  assert.equal(observed[0].content.text, "**hello** from discord");
  assert.equal(observed[0].reply_to, "M122");
  assert.equal(observed[0].channel.kind, "im");
  assert.equal(observed[0].channel.capabilities.markdown, true);
  assert.equal(observed[0].channel.capabilities.threads, true);
  assert.equal(observed[0].channel.metadata.transport, "discord_gateway");
  assert.equal(observed[0].channel.metadata.target_kind, "channel");
  assert.equal(observed[0].identity.trust_level, "paired");
  assert.equal(observed[0].identity.display_name, "Ada");

  assert.equal(await adapter.receiveGatewayEvent({
    t: "MESSAGE_CREATE",
    d: {
      id: "M124",
      channel_id: "C123",
      author: {
        id: "U999"
      },
      content: "blocked"
    }
  }), false);

  assert.equal(await adapter.receiveGatewayEvent({
    t: "MESSAGE_CREATE",
    d: {
      id: "M125",
      channel_id: "C123",
      author: {
        id: "BOT1",
        bot: true
      },
      content: "bot loop"
    }
  }), false);
  assert.equal(observed.length, 1);
});

test("discord adapter delivery supports channel, dm and thread targets", async () => {
  const recorder = createDiscordFetchRecorder();
  const adapter = new DiscordAdapter({ fetch: recorder.fetch });
  await adapter.start({
    auth: {
      bot_token: "discord-token",
      api_base_url: "https://discord.test/api/v10"
    }
  });

  const channel = await adapter.sendMessage("C123", { type: "markdown", text: "**channel** reply" });
  const dm = await adapter.sendMessage("dm:U123", { type: "text", text: "dm reply" });
  const thread = await adapter.sendMessage("TH123", {
    type: "status",
    text: "Running",
    phase: "reasoning",
    state: "in_progress",
    detail: "Thinking",
    data: {
      step: 4
    }
  });
  const approval = await adapter.sendMessage("C123", {
    type: "approval_request",
    text: "Approve Discord action?",
    approval_id: "apv-discord-1",
    approve_label: "Allow",
    reject_label: "Deny"
  });
  await adapter.editMessage("C123", channel.message_id, { type: "markdown", text: "**edited**" });
  await adapter.typingIndicator("C123");

  assert.equal(channel.message_id, "MSG0");
  assert.equal(dm.message_id, "MSG2");
  assert.equal(thread.message_id, "MSG3");
  assert.equal(approval.message_id, "MSG4");
  assert.equal(recorder.requests[0].method, "POST");
  assert.equal(recorder.requests[0].path, "/channels/C123/messages");
  assert.equal(recorder.requests[0].body.content, "**channel** reply");
  assert.equal(recorder.requests[0].headers.authorization, "Bot discord-token");
  assert.equal(recorder.requests[1].path, "/users/@me/channels");
  assert.equal(recorder.requests[1].body.recipient_id, "U123");
  assert.equal(recorder.requests[2].path, "/channels/DM123/messages");
  assert.equal(recorder.requests[2].body.content, "dm reply");
  assert.equal(recorder.requests[3].path, "/channels/TH123/messages");
  assert.match(recorder.requests[3].body.content, /Reasoning · in progress/);
  assert.match(recorder.requests[3].body.content, /step: 4/);
  assert.equal(recorder.requests[4].body.components[0].components[0].custom_id, "approve:apv-discord-1");
  assert.equal(recorder.requests[4].body.components[0].components[1].custom_id, "reject:apv-discord-1");
  assert.equal(recorder.requests[5].method, "PATCH");
  assert.equal(recorder.requests[5].path, `/channels/C123/messages/${channel.message_id}`);
  assert.equal(recorder.requests[6].path, "/channels/C123/typing");
});

test("discord adapter normalizes button interactions to approval actions", async () => {
  const adapter = new DiscordAdapter({ fetch: createDiscordFetchRecorder().fetch });
  const observed = [];

  adapter.onMessage((message) => {
    observed.push(message);
  });
  await adapter.start({
    auth: {
      bot_token: "discord-token"
    },
    allowed_senders: ["U123"]
  });

  assert.equal(await adapter.receiveGatewayEvent({
    type: 3,
    id: "interaction-1",
    guild_id: "G123",
    channel_id: "C123",
    user: {
      id: "U123",
      username: "ada"
    },
    message: {
      id: "M500"
    },
    data: {
      custom_id: "approve:apv-discord-1"
    }
  }), true);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "discord");
  assert.equal(observed[0].chat_id, "C123");
  assert.equal(observed[0].content.type, "action");
  assert.equal(observed[0].content.action, "approve");
  assert.equal(observed[0].content.params.approval_id, "apv-discord-1");
  assert.equal(observed[0].reply_to, "M500");
  assert.equal(observed[0].channel.metadata.transport, "discord_interaction");
});

function createDiscordFetchRecorder() {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      const parsed = new URL(String(url));
      const body = init.body ? JSON.parse(init.body) : {};
      requests.push({
        url: String(url),
        method: init.method,
        path: parsed.pathname.replace("/api/v10", ""),
        headers: init.headers,
        body
      });

      if (parsed.pathname.endsWith("/users/@me/channels")) {
        return new Response(JSON.stringify({ id: "DM123" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (parsed.pathname.endsWith("/typing")) {
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({ id: `MSG${requests.length - 1}` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };
}
