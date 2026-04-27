import { randomUUID } from "node:crypto";
import type { NotificationDispatcher } from "../notification/notification-dispatcher.js";
import type { IMPlatform, PlatformPairingCode, UnifiedMessage } from "../types.js";
import type { PlatformUserLinkStore } from "./platform-user-link-store.js";

export interface PairingManagerOptions {
  store: PlatformUserLinkStore;
  requirePairingFor?: IMPlatform[];
  codeTtlMs?: number;
  now?: () => Date;
  generateCode?: () => string;
}

export interface CreatePairingCodeInput {
  canonical_user_id: string;
  created_by_platform?: IMPlatform;
  created_by_sender_id?: string;
  created_by_chat_id?: string;
}

export class PairingManager {
  private readonly requirePairingFor: Set<IMPlatform>;
  private readonly codeTtlMs: number;
  private readonly now: () => Date;
  private readonly generateCode: () => string;

  public constructor(private readonly options: PairingManagerOptions) {
    this.requirePairingFor = new Set(options.requirePairingFor ?? ["telegram", "slack", "discord", "email"]);
    this.codeTtlMs = options.codeTtlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.generateCode = options.generateCode ?? (() => randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase());
  }

  public requiresPairing(platform: IMPlatform): boolean {
    return this.requirePairingFor.has(platform);
  }

  public isPaired(message: Pick<UnifiedMessage, "platform" | "sender_id" | "identity">): boolean {
    if (!this.requiresPairing(message.platform)) {
      return true;
    }
    if (message.identity?.trust_level === "paired" || message.identity?.trust_level === "trusted") {
      return true;
    }
    return Boolean(this.options.store.resolveCanonicalUserId(message.platform, message.sender_id));
  }

  public shouldBlock(message: UnifiedMessage): boolean {
    return !this.isPaired(message);
  }

  public isPairCommand(message: UnifiedMessage): boolean {
    const text = message.content.type === "text" || message.content.type === "markdown" ? message.content.text.trim().toLowerCase() : "";
    return text === "/pair" || text.startsWith("/pair ");
  }

  public async sendPairingPrompt(dispatcher: NotificationDispatcher, message: UnifiedMessage): Promise<void> {
    const createdAt = this.now().toISOString();
    this.options.store.recordAuditEvent({
      audit_id: `pia_${randomUUID()}`,
      event_type: "blocked_unpaired",
      platform: message.platform,
      sender_id: message.sender_id,
      chat_id: message.chat_id,
      created_at: createdAt,
      metadata: {
        message_id: message.message_id
      }
    });
    await dispatcher.sendToChat(message.platform, message.chat_id, {
      type: "text",
      text: "This sender is not paired. Send /pair <code> from this chat after creating a pairing code from a trusted channel."
    });
  }

  public createPairingCode(input: CreatePairingCodeInput): PlatformPairingCode {
    const createdAt = this.now();
    const code = {
      code: this.generateCode(),
      canonical_user_id: input.canonical_user_id,
      created_at: createdAt.toISOString(),
      expires_at: new Date(createdAt.getTime() + this.codeTtlMs).toISOString()
    };
    this.options.store.createPairingCode(code);
    this.options.store.recordAuditEvent({
      audit_id: `pia_${randomUUID()}`,
      event_type: "pair_code_created",
      platform: input.created_by_platform,
      sender_id: input.created_by_sender_id,
      canonical_user_id: input.canonical_user_id,
      chat_id: input.created_by_chat_id,
      created_at: code.created_at,
      metadata: {
        expires_at: code.expires_at
      }
    });
    return code;
  }

  public consumePairingCode(message: UnifiedMessage, code: string): { ok: true; canonical_user_id: string } | { ok: false; reason: string } {
    const consumedAt = this.now().toISOString();
    const pairing = this.options.store.consumePairingCode(code.trim(), {
      platform: message.platform,
      sender_id: message.sender_id,
      consumed_at: consumedAt
    });
    if (!pairing) {
      return {
        ok: false,
        reason: "Pairing code is invalid, expired or already used."
      };
    }

    this.options.store.upsertLink({
      platform: message.platform,
      sender_id: message.sender_id,
      canonical_user_id: pairing.canonical_user_id,
      created_at: consumedAt,
      updated_at: consumedAt
    });
    this.options.store.recordAuditEvent({
      audit_id: `pia_${randomUUID()}`,
      event_type: "paired",
      platform: message.platform,
      sender_id: message.sender_id,
      canonical_user_id: pairing.canonical_user_id,
      chat_id: message.chat_id,
      created_at: consumedAt,
      metadata: {
        code: pairing.code
      }
    });
    return {
      ok: true,
      canonical_user_id: pairing.canonical_user_id
    };
  }

  public revoke(message: UnifiedMessage): { ok: true; canonical_user_id: string } | { ok: false; reason: string } {
    const canonicalUserId = this.options.store.resolveCanonicalUserId(message.platform, message.sender_id);
    if (!canonicalUserId) {
      return {
        ok: false,
        reason: "No pairing exists for this sender."
      };
    }
    const createdAt = this.now().toISOString();
    this.options.store.deleteLink(message.platform, message.sender_id);
    this.options.store.recordAuditEvent({
      audit_id: `pia_${randomUUID()}`,
      event_type: "revoked",
      platform: message.platform,
      sender_id: message.sender_id,
      canonical_user_id: canonicalUserId,
      chat_id: message.chat_id,
      created_at: createdAt,
      metadata: {}
    });
    return {
      ok: true,
      canonical_user_id: canonicalUserId
    };
  }

  public setHomeChannel(message: UnifiedMessage): { ok: true; canonical_user_id: string } | { ok: false; reason: string } {
    const canonicalUserId = this.options.store.resolveCanonicalUserId(message.platform, message.sender_id) ?? message.sender_id;
    if (this.requiresPairing(message.platform) && !this.options.store.resolveCanonicalUserId(message.platform, message.sender_id)) {
      return {
        ok: false,
        reason: "Pair this sender before setting it as home channel."
      };
    }
    const now = this.now().toISOString();
    this.options.store.setHomeChannel({
      canonical_user_id: canonicalUserId,
      platform: message.platform,
      chat_id: message.chat_id,
      sender_id: message.sender_id,
      created_at: now,
      updated_at: now
    });
    this.options.store.recordAuditEvent({
      audit_id: `pia_${randomUUID()}`,
      event_type: "home_channel_set",
      platform: message.platform,
      sender_id: message.sender_id,
      canonical_user_id: canonicalUserId,
      chat_id: message.chat_id,
      created_at: now,
      metadata: {}
    });
    return {
      ok: true,
      canonical_user_id: canonicalUserId
    };
  }
}
