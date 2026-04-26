import assert from "node:assert/strict";
import test from "node:test";
import { TelegramAdapter } from "../examples/personal-assistant/dist/im-gateway/adapter/telegram.js";

test("telegram adapter normalizes allowed inbound messages and rejects unauthorized senders", async () => {
  const adapter = new TelegramAdapter({ fetch: createTelegramFetchRecorder().fetch });
  const observed = [];

  adapter.onMessage((message) => {
    observed.push(message);
  });
  await adapter.start({
    auth: {
      bot_token: "test-token"
    },
    allowed_senders: ["42"]
  });

  assert.equal(await adapter.receiveUpdate({
    update_id: 100,
    message: {
      message_id: 200,
      date: 1777240000,
      chat: {
        id: 9001,
        type: "private"
      },
      from: {
        id: 42,
        first_name: "Ada",
        last_name: "Lovelace",
        username: "ada"
      },
      text: "hello telegram"
    }
  }), true);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "telegram");
  assert.equal(observed[0].chat_id, "9001");
  assert.equal(observed[0].sender_id, "42");
  assert.equal(observed[0].content.text, "hello telegram");
  assert.equal(observed[0].channel.kind, "im");
  assert.equal(observed[0].channel.capabilities.markdown, true);
  assert.equal(observed[0].channel.capabilities.status, true);
  assert.equal(observed[0].channel.metadata.transport, "telegram_bot_api");
  assert.equal(observed[0].identity.trust_level, "paired");
  assert.equal(observed[0].identity.display_name, "Ada Lovelace");

  assert.equal(await adapter.receiveUpdate({
    update_id: 101,
    message: {
      message_id: 201,
      chat: {
        id: 9001,
        type: "private"
      },
      from: {
        id: 99
      },
      text: "blocked"
    }
  }), false);
  assert.equal(observed.length, 1);
});

test("telegram adapter delivers text, markdown, status and approval messages", async () => {
  const recorder = createTelegramFetchRecorder();
  const adapter = new TelegramAdapter({ fetch: recorder.fetch });
  await adapter.start({
    auth: {
      bot_token: "test-token",
      api_base_url: "https://telegram.test"
    }
  });

  const text = await adapter.sendMessage("9001", { type: "text", text: "plain text" });
  const markdown = await adapter.sendMessage("9001", { type: "markdown", text: "**bold**" });
  const status = await adapter.sendMessage("9001", {
    type: "status",
    text: "Running",
    phase: "reasoning",
    state: "in_progress",
    detail: "Thinking",
    data: {
      step: 2
    }
  });
  const approval = await adapter.sendMessage("9001", {
    type: "approval_request",
    text: "Send this message?",
    approval_id: "apv-1",
    approve_label: "Allow",
    reject_label: "Deny"
  });
  await adapter.editMessage("9001", text.message_id, { type: "text", text: "edited" });
  await adapter.typingIndicator("9001");

  assert.equal(text.message_id, "500");
  assert.equal(markdown.message_id, "501");
  assert.equal(status.message_id, "502");
  assert.equal(approval.message_id, "503");
  assert.equal(recorder.requests[0].method, "sendMessage");
  assert.equal(recorder.requests[0].body.text, "plain text");
  assert.equal(recorder.requests[1].body.parse_mode, "Markdown");
  assert.equal(recorder.requests[1].body.text, "**bold**");
  assert.match(recorder.requests[2].body.text, /Reasoning · in progress/);
  assert.match(recorder.requests[2].body.text, /step: 2/);
  assert.equal(recorder.requests[3].body.reply_markup.inline_keyboard[0][0].callback_data, "approve:apv-1");
  assert.equal(recorder.requests[3].body.reply_markup.inline_keyboard[0][1].callback_data, "reject:apv-1");
  assert.equal(recorder.requests[4].method, "editMessageText");
  assert.equal(recorder.requests[4].body.text, "edited");
  assert.equal(recorder.requests[5].method, "sendChatAction");
  assert.equal(recorder.requests[5].body.action, "typing");
});

test("telegram callback query normalizes approval decisions to action messages", async () => {
  const adapter = new TelegramAdapter({ fetch: createTelegramFetchRecorder().fetch });
  const observed = [];

  adapter.onMessage((message) => {
    observed.push(message);
  });
  await adapter.start({
    auth: {
      bot_token: "test-token"
    },
    allowed_senders: ["42"]
  });

  assert.equal(await adapter.receiveUpdate({
    update_id: 102,
    callback_query: {
      id: "callback-1",
      from: {
        id: 42,
        first_name: "Ada"
      },
      message: {
        message_id: 700,
        chat: {
          id: 9001,
          type: "private"
        }
      },
      data: "reject:apv-1"
    }
  }), true);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "telegram");
  assert.equal(observed[0].content.type, "action");
  assert.equal(observed[0].content.action, "reject");
  assert.equal(observed[0].content.params.approval_id, "apv-1");
  assert.equal(observed[0].reply_to, "700");
  assert.equal(observed[0].channel.metadata.callback_query_id, "callback-1");
});

function createTelegramFetchRecorder() {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      const body = JSON.parse(init.body);
      const method = String(url).split("/").at(-1);
      requests.push({
        url: String(url),
        method,
        body
      });
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message_id: 500 + requests.length - 1
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  };
}
