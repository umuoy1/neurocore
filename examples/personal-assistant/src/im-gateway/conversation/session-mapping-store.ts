import type { IMPlatform, SessionRoute } from "../types.js";

export interface SessionRouteScope {
  agent_profile_id?: string;
  workspace_id?: string;
  route_scope_key?: string;
}

export interface SessionMappingStore {
  getRoute(platform: IMPlatform, chatId: string, scope?: SessionRouteScope): SessionRoute | undefined;
  upsertRoute(route: SessionRoute): void;
  deleteRoute(platform: IMPlatform, chatId: string, scope?: SessionRouteScope): void;
  listRoutesForUser(userId: string): SessionRoute[];
}
