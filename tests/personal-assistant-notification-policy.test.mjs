import assert from "node:assert/strict";
import test from "node:test";
import { NotificationDispatcher } from "../examples/personal-assistant/dist/im-gateway/notification/notification-dispatcher.js";
import { InMemoryNotificationPolicyStore } from "../examples/personal-assistant/dist/im-gateway/notification/notification-policy.js";

test("notification policy suppresses normal quiet-hours delivery but lets urgent through", async () => {
  const harness = createNotificationHarness({
    now: () => new Date("2026-04-28T23:30:00+08:00"),
    policy: {
      quiet_hours: {
        start: "22:00",
        end: "07:00"
      }
    }
  });

  const normal = await harness.dispatcher.pushToUser("user-1", {
    type: "text",
    text: "normal reminder"
  }, {
    priority: "normal"
  });
  assert.equal(normal.suppressed, true);
  assert.equal(harness.adapters.web.messages.length, 0);

  const urgent = await harness.dispatcher.pushToUser("user-1", {
    type: "text",
    text: "urgent reminder"
  }, {
    priority: "urgent"
  });
  assert.equal(urgent.platform, "web");
  assert.equal(harness.adapters.web.messages.length, 1);
});

test("notification policy falls back to secondary channel after primary failure", async () => {
  const harness = createNotificationHarness({
    failWeb: true,
    policy: {
      fallback_channels: [{ platform: "email", chat_id: "email:user@example.com" }]
    }
  });

  const result = await harness.dispatcher.pushToUser("user-1", {
    type: "text",
    text: "fallback reminder"
  });

  assert.equal(result.platform, "email");
  assert.equal(result.chat_id, "email:user@example.com");
  assert.equal(harness.adapters.web.messages.length, 0);
  assert.equal(harness.adapters.email.messages.length, 1);
});

test("notification policy dedupes repeated reminders inside window", async () => {
  let now = new Date("2026-04-28T09:00:00+08:00");
  const harness = createNotificationHarness({
    now: () => now,
    policy: {
      dedupe_window_ms: 60_000
    }
  });

  const first = await harness.dispatcher.pushToUser("user-1", {
    type: "text",
    text: "standup reminder"
  }, {
    dedupe_key: "standup"
  });
  assert.equal(first.deduped, undefined);
  assert.equal(harness.adapters.web.messages.length, 1);

  const second = await harness.dispatcher.pushToUser("user-1", {
    type: "text",
    text: "standup reminder"
  }, {
    dedupe_key: "standup"
  });
  assert.equal(second.deduped, true);
  assert.equal(harness.adapters.web.messages.length, 1);

  now = new Date("2026-04-28T09:02:00+08:00");
  const third = await harness.dispatcher.pushToUser("user-1", {
    type: "text",
    text: "standup reminder"
  }, {
    dedupe_key: "standup"
  });
  assert.equal(third.deduped, undefined);
  assert.equal(harness.adapters.web.messages.length, 2);
});

function createNotificationHarness(options = {}) {
  const policyStore = new InMemoryNotificationPolicyStore();
  if (options.policy) {
    policyStore.setPolicy("user-1", options.policy);
  }
  const adapters = {
    web: new FakeAdapter("web", options.failWeb),
    email: new FakeAdapter("email")
  };
  const dispatcher = new NotificationDispatcher({
    getAdapter(platform) {
      return adapters[platform];
    },
    mappingStore: {
      listRoutesForUser(userId) {
        return userId === "user-1"
          ? [
              {
                user_id: "user-1",
                platform: "web",
                chat_id: "web-chat",
                session_id: "ses-web",
                route_key: "web:web-chat",
                created_at: "2026-04-28T00:00:00.000Z",
                updated_at: "2026-04-28T00:00:00.000Z"
              },
              {
                user_id: "user-1",
                platform: "email",
                chat_id: "email:user@example.com",
                session_id: "ses-email",
                route_key: "email:user@example.com",
                created_at: "2026-04-28T00:00:00.000Z",
                updated_at: "2026-04-28T00:00:00.000Z"
              }
            ]
          : [];
      }
    },
    notificationPolicyStore: policyStore,
    now: options.now
  });
  return { dispatcher, adapters };
}

class FakeAdapter {
  constructor(platform, fail = false) {
    this.platform = platform;
    this.fail = fail;
    this.messages = [];
  }

  async start() {}

  async stop() {}

  onMessage() {}

  async sendMessage(chatId, content) {
    if (this.fail) {
      throw new Error(`${this.platform} failed`);
    }
    const message = {
      message_id: `${this.platform}-${this.messages.length + 1}`,
      chat_id: chatId,
      content
    };
    this.messages.push(message);
    return { message_id: message.message_id };
  }

  async editMessage() {}

  async typingIndicator() {}
}
