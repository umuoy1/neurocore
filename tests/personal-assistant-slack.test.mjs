import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { SlackAdapter } from "../examples/personal-assistant/dist/im-gateway/adapter/slack.js";

test("slack adapter verifies signing, normalizes events, and rejects unauthorized senders", async () => {
  const now = 1777240000000;
  const secret = "signing-secret";
  const adapter = new SlackAdapter({ fetch: createSlackFetchRecorder().fetch, now: () => now });
  const observed = [];

  adapter.onMessage((message) => {
    observed.push(message);
  });
  await adapter.start({
    auth: {
      bot_token: "xoxb-token",
      signing_secret: secret
    },
    allowed_senders: ["U123"]
  });

  const payload = {
    token: "legacy-token",
    team_id: "T123",
    event_id: "Ev123",
    event: {
      type: "message",
      channel: "C123",
      user: "U123",
      text: "*hello* from slack",
      ts: "1777240000.000200",
      thread_ts: "1777240000.000100",
      client_msg_id: "msg-123"
    }
  };
  const signed = signSlackPayload(secret, now, payload);

  assert.equal(await adapter.receiveEvent(payload, signed), true);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "slack");
  assert.equal(observed[0].chat_id, "C123:1777240000.000100");
  assert.equal(observed[0].sender_id, "U123");
  assert.equal(observed[0].content.type, "markdown");
  assert.equal(observed[0].content.text, "*hello* from slack");
  assert.equal(observed[0].channel.thread_id, "1777240000.000100");
  assert.equal(observed[0].channel.capabilities.markdown, true);
  assert.equal(observed[0].channel.capabilities.threads, true);
  assert.equal(observed[0].channel.metadata.transport, "slack_events_api");
  assert.equal(observed[0].identity.trust_level, "paired");

  assert.equal(await adapter.receiveEvent(payload, {
    rawBody: signed.rawBody,
    headers: {
      ...signed.headers,
      "x-slack-signature": "v0=bad"
    }
  }), false);

  const unauthorized = {
    ...payload,
    event: {
      ...payload.event,
      user: "U999",
      client_msg_id: "msg-999"
    }
  };
  assert.equal(await adapter.receiveEvent(unauthorized, signSlackPayload(secret, now, unauthorized)), false);
  assert.equal(observed.length, 1);
});

test("slack adapter delivery preserves markdown and thread targets", async () => {
  const recorder = createSlackFetchRecorder();
  const adapter = new SlackAdapter({ fetch: recorder.fetch });
  await adapter.start({
    auth: {
      bot_token: "xoxb-token",
      api_base_url: "https://slack.test/api"
    }
  });

  const markdown = await adapter.sendMessage("C123:1777240000.000100", {
    type: "markdown",
    text: "*bold* reply"
  });
  const status = await adapter.sendMessage("C123:1777240000.000100", {
    type: "status",
    text: "Running",
    phase: "reasoning",
    state: "in_progress",
    detail: "Thinking",
    data: {
      step: 3
    }
  });
  const approval = await adapter.sendMessage("C123:1777240000.000100", {
    type: "approval_request",
    text: "Approve Slack action?",
    approval_id: "apv-slack-1",
    approve_label: "Allow",
    reject_label: "Deny"
  });
  await adapter.editMessage("C123:1777240000.000100", markdown.message_id, {
    type: "markdown",
    text: "*edited*"
  });

  assert.equal(markdown.message_id, "1777240000.000500");
  assert.equal(status.message_id, "1777240001.000500");
  assert.equal(approval.message_id, "1777240002.000500");
  assert.equal(recorder.requests[0].method, "chat.postMessage");
  assert.equal(recorder.requests[0].body.channel, "C123");
  assert.equal(recorder.requests[0].body.thread_ts, "1777240000.000100");
  assert.equal(recorder.requests[0].body.mrkdwn, true);
  assert.equal(recorder.requests[0].headers.authorization, "Bearer xoxb-token");
  assert.match(recorder.requests[1].body.text, /Reasoning · in progress/);
  assert.match(recorder.requests[1].body.text, /step: 3/);
  assert.equal(recorder.requests[2].body.blocks[1].elements[0].value, "approve:apv-slack-1");
  assert.equal(recorder.requests[2].body.blocks[1].elements[1].value, "reject:apv-slack-1");
  assert.equal(recorder.requests[3].method, "chat.update");
  assert.equal(recorder.requests[3].body.ts, markdown.message_id);
  assert.equal(recorder.requests[3].body.text, "*edited*");
});

test("slack adapter normalizes interactive approval callbacks", async () => {
  const adapter = new SlackAdapter({ fetch: createSlackFetchRecorder().fetch });
  const observed = [];

  adapter.onMessage((message) => {
    observed.push(message);
  });
  await adapter.start({
    auth: {
      bot_token: "xoxb-token"
    },
    allowed_senders: ["U123"]
  });

  assert.equal(await adapter.receiveEvent({
    type: "block_actions",
    team: {
      id: "T123"
    },
    user: {
      id: "U123"
    },
    channel: {
      id: "C123"
    },
    message: {
      ts: "1777240000.000500",
      thread_ts: "1777240000.000100"
    },
    actions: [
      {
        action_id: "reject",
        value: "reject:apv-slack-1"
      }
    ]
  }), true);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].platform, "slack");
  assert.equal(observed[0].chat_id, "C123:1777240000.000100");
  assert.equal(observed[0].content.type, "action");
  assert.equal(observed[0].content.action, "reject");
  assert.equal(observed[0].content.params.approval_id, "apv-slack-1");
  assert.equal(observed[0].reply_to, "1777240000.000500");
  assert.equal(observed[0].channel.metadata.transport, "slack_interactivity");
});

function signSlackPayload(secret, now, payload) {
  const timestamp = String(Math.floor(now / 1000));
  const rawBody = JSON.stringify(payload);
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return {
    rawBody,
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature
    }
  };
}

function createSlackFetchRecorder() {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      const body = JSON.parse(init.body);
      const method = String(url).split("/").at(-1);
      requests.push({
        url: String(url),
        method,
        headers: init.headers,
        body
      });
      return new Response(JSON.stringify({
        ok: true,
        ts: `177724000${requests.length - 1}.000500`
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  };
}
