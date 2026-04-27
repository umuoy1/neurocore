import type { IMPlatform, PlatformHomeChannel, PlatformIdentityAuditEvent, PlatformPairingCode, PlatformUserLink } from "../types.js";

export interface PlatformUserLinkStore {
  resolveCanonicalUserId(platform: IMPlatform, senderId: string): string | undefined;
  upsertLink(link: PlatformUserLink): void;
  deleteLink(platform: IMPlatform, senderId: string): void;
  listLinks(canonicalUserId: string): PlatformUserLink[];
  createPairingCode(code: PlatformPairingCode): void;
  consumePairingCode(code: string, input: { platform: IMPlatform; sender_id: string; consumed_at: string }): PlatformPairingCode | undefined;
  setHomeChannel(channel: PlatformHomeChannel): void;
  getHomeChannel(canonicalUserId: string): PlatformHomeChannel | undefined;
  recordAuditEvent(event: PlatformIdentityAuditEvent): void;
  listAuditEvents(input?: { canonical_user_id?: string; platform?: IMPlatform; sender_id?: string; limit?: number }): PlatformIdentityAuditEvent[];
}
