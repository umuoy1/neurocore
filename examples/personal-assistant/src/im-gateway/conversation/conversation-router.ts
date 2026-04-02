import type { AgentSessionHandle, AgentBuilder } from "@neurocore/sdk-core";
import type { UserInput, SessionState } from "@neurocore/protocol";
import type { SessionRoute, UnifiedMessage } from "../types.js";
import type { SessionMappingStore } from "./session-mapping-store.js";
import type { PlatformUserLinkStore } from "./platform-user-link-store.js";

export interface ConversationRouterOptions {
  builder: AgentBuilder;
  tenantId: string;
  mappingStore: SessionMappingStore;
  userLinkStore?: PlatformUserLinkStore;
  idleTimeoutMs?: number;
}

export interface ResolvedConversation {
  session_id: string;
  handle: AgentSessionHandle;
  is_new: boolean;
  resumed_from_checkpoint: boolean;
  canonical_user_id: string;
}

export class ConversationRouter {
  private readonly idleTimeoutMs: number;

  public constructor(private readonly options: ConversationRouterOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
  }

  public resolveOrCreate(message: UnifiedMessage, input: UserInput): ResolvedConversation {
    const canonicalUserId = this.resolveCanonicalUserId(message);
    const route = this.options.mappingStore.getRoute(message.platform, message.chat_id);

    if (route) {
      const handle = this.connectExisting(route.session_id);
      const session = handle.getSession();
      if (session && !isTerminalState(session.state) && !isIdle(session.state, session.last_active_at, this.idleTimeoutMs)) {
        this.options.mappingStore.upsertRoute({
          ...route,
          sender_id: message.sender_id,
          canonical_user_id: canonicalUserId,
          updated_at: input.created_at,
          last_active_at: input.created_at
        });

        return {
          session_id: route.session_id,
          handle,
          is_new: false,
          resumed_from_checkpoint: false,
          canonical_user_id: canonicalUserId
        };
      }

      if (session && !isTerminalState(session.state)) {
        try {
          handle.checkpoint();
        } catch {}
      }
    }

    const handle = this.options.builder.createSession({
      agent_id: this.options.builder.getProfile().agent_id,
      tenant_id: this.options.tenantId,
      user_id: canonicalUserId,
      session_mode: "sync",
      initial_input: input
    });

    const newRoute: SessionRoute = {
      platform: message.platform,
      chat_id: message.chat_id,
      session_id: handle.id,
      sender_id: message.sender_id,
      canonical_user_id: canonicalUserId,
      created_at: input.created_at,
      updated_at: input.created_at,
      last_active_at: input.created_at
    };
    this.options.mappingStore.upsertRoute(newRoute);

    if (this.options.userLinkStore) {
      this.options.userLinkStore.upsertLink({
        platform: message.platform,
        sender_id: message.sender_id,
        canonical_user_id: canonicalUserId,
        created_at: input.created_at,
        updated_at: input.created_at
      });
    }

    return {
      session_id: handle.id,
      handle,
      is_new: true,
      resumed_from_checkpoint: false,
      canonical_user_id: canonicalUserId
    };
  }

  public clearRoute(message: Pick<UnifiedMessage, "platform" | "chat_id">): void {
    this.options.mappingStore.deleteRoute(message.platform, message.chat_id);
  }

  public listRoutesForUser(userId: string): SessionRoute[] {
    return this.options.mappingStore.listRoutesForUser(userId);
  }

  public connect(sessionId: string): AgentSessionHandle {
    return this.connectExisting(sessionId);
  }

  private resolveCanonicalUserId(message: UnifiedMessage): string {
    return (
      this.options.userLinkStore?.resolveCanonicalUserId(message.platform, message.sender_id) ??
      message.sender_id
    );
  }

  private connectExisting(sessionId: string): AgentSessionHandle {
    return this.options.builder.connectSession(sessionId);
  }
}

function isTerminalState(state: SessionState): boolean {
  return state === "completed" || state === "failed" || state === "aborted";
}

function isIdle(state: SessionState, lastActiveAt: string | undefined, idleTimeoutMs: number): boolean {
  if (state === "suspended" || state === "hydrated") {
    return false;
  }
  if (!lastActiveAt) {
    return false;
  }
  return Date.now() - Date.parse(lastActiveAt) > idleTimeoutMs;
}
