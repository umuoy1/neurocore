import type { IMPlatform, SessionRoute } from "../types.js";

export interface SessionMappingStore {
  getRoute(platform: IMPlatform, chatId: string): SessionRoute | undefined;
  upsertRoute(route: SessionRoute): void;
  deleteRoute(platform: IMPlatform, chatId: string): void;
  listRoutesForUser(userId: string): SessionRoute[];
}
