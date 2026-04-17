import type { IMAdapter } from "../adapter/im-adapter.js";
import type { IMPlatform, MessageContent, PushNotificationOptions } from "../types.js";
import type { SessionMappingStore } from "../conversation/session-mapping-store.js";

export interface NotificationDispatcherOptions {
  getAdapter: (platform: IMPlatform) => IMAdapter | undefined;
  mappingStore: SessionMappingStore;
}

export class NotificationDispatcher {
  public constructor(private readonly options: NotificationDispatcherOptions) {}

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
  ): Promise<{ message_id: string; platform: IMPlatform; chat_id: string }> {
    const routes = this.options.mappingStore
      .listRoutesForUser(userId)
      .filter((route) => (options?.platform ? route.platform === options.platform : true));

    const selected = options?.chat_id
      ? routes.find((route) => route.chat_id === options.chat_id)
      : routes[0];

    if (!selected) {
      throw new Error(`No route found for user ${userId}.`);
    }

    const result = await this.sendToChat(selected.platform, selected.chat_id, content);
    return {
      message_id: result.message_id,
      platform: selected.platform,
      chat_id: selected.chat_id
    };
  }
}
