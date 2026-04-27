import type { IMAdapter } from "../adapter/im-adapter.js";
import type { IMPlatform, MessageContent, PushNotificationOptions } from "../types.js";
import type { SessionMappingStore } from "../conversation/session-mapping-store.js";
import { NotificationDeliveryPlanner, type NotificationPolicyStore } from "./notification-policy.js";

export interface NotificationDispatcherOptions {
  getAdapter: (platform: IMPlatform) => IMAdapter | undefined;
  mappingStore: SessionMappingStore;
  notificationPolicyStore?: NotificationPolicyStore;
  now?: () => Date;
}

export class NotificationDispatcher {
  private readonly planner: NotificationDeliveryPlanner;

  public constructor(private readonly options: NotificationDispatcherOptions) {
    this.planner = new NotificationDeliveryPlanner({
      store: options.notificationPolicyStore,
      now: options.now
    });
  }

  public async sendToChat(
    platform: IMPlatform,
    chatId: string,
    content: MessageContent
  ): Promise<{ message_id: string }> {
    const adapter = this.options.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Adapter for platform ${platform} is not registered.`);
    }
    return adapter.sendMessage(chatId, content);
  }

  public async editChat(
    platform: IMPlatform,
    chatId: string,
    messageId: string,
    content: MessageContent
  ): Promise<void> {
    const adapter = this.options.getAdapter(platform);
    if (!adapter) {
      throw new Error(`Adapter for platform ${platform} is not registered.`);
    }
    await adapter.editMessage(chatId, messageId, content);
  }

  public async pushToUser(
    userId: string,
    content: MessageContent,
    options?: PushNotificationOptions
  ): Promise<{ message_id: string; platform: IMPlatform; chat_id: string; suppressed?: boolean; deduped?: boolean }> {
    const routes = this.options.mappingStore
      .listRoutesForUser(userId)
      .filter((route) => (options?.platform ? route.platform === options.platform : true));

    const selected = options?.chat_id
      ? routes.find((route) => route.chat_id === options.chat_id)
      : routes[0];

    if (!selected) {
      throw new Error(`No route found for user ${userId}.`);
    }

    const plan = this.planner.plan({
      user_id: userId,
      selected_route: {
        platform: selected.platform,
        chat_id: selected.chat_id
      },
      options
    });
    if (plan.decision === "suppress") {
      return {
        message_id: `suppressed:${plan.reason ?? "notification"}`,
        platform: selected.platform,
        chat_id: selected.chat_id,
        suppressed: true
      };
    }
    if (plan.decision === "dedupe") {
      return {
        message_id: `dedupe:${plan.dedupe_key ?? "notification"}`,
        platform: selected.platform,
        chat_id: selected.chat_id,
        deduped: true
      };
    }

    let lastError: unknown;
    for (const route of plan.routes) {
      try {
        const result = await this.sendToChat(route.platform, route.chat_id, content);
        this.planner.recordDelivery(plan);
        return {
          message_id: result.message_id,
          platform: route.platform,
          chat_id: route.chat_id
        };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }
    const result = await this.sendToChat(selected.platform, selected.chat_id, content);
    this.planner.recordDelivery(plan);
    return {
      message_id: result.message_id,
      platform: selected.platform,
      chat_id: selected.chat_id
    };
  }
}
