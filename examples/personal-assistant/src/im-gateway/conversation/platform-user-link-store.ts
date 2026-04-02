import type { IMPlatform, PlatformUserLink } from "../types.js";

export interface PlatformUserLinkStore {
  resolveCanonicalUserId(platform: IMPlatform, senderId: string): string | undefined;
  upsertLink(link: PlatformUserLink): void;
  listLinks(canonicalUserId: string): PlatformUserLink[];
}
