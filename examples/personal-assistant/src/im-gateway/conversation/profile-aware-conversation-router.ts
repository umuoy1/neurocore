import type { AgentSessionHandle } from "@neurocore/sdk-core";
import type { UserInput } from "@neurocore/protocol";
import type { PlatformUserLinkStore } from "./platform-user-link-store.js";
import type { SessionMappingStore, SessionRouteScope } from "./session-mapping-store.js";
import type { ConversationRouting, ResolvedConversation } from "./conversation-router.js";
import {
  attachConversationHandoff,
  buildConversationHandoff,
  isIdle,
  isTerminalState
} from "./conversation-router.js";
import type { AgentProfileRegistry, AgentProfileResolution } from "./agent-profile-store.js";
import type { SessionRoute, UnifiedMessage } from "../types.js";

export interface ProfileAwareConversationRouterOptions {
  profileRegistry: AgentProfileRegistry;
  mappingStore: SessionMappingStore;
  userLinkStore?: PlatformUserLinkStore;
  idleTimeoutMs?: number;
}

export class ProfileAwareConversationRouter implements ConversationRouting {
  private readonly idleTimeoutMs: number;

  public constructor(private readonly options: ProfileAwareConversationRouterOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
  }

  public resolveOrCreate(message: UnifiedMessage, input: UserInput): ResolvedConversation {
    const canonicalUserId = this.resolveCanonicalUserId(message);
    const resolution = this.options.profileRegistry.resolve(message, { canonicalUserId });
    const routeScope = toRouteScope(resolution);
    const runtimeInput = attachAgentProfileMetadata(input, resolution);
    const route = this.options.mappingStore.getRoute(message.platform, message.chat_id, routeScope);
    let handoff: ResolvedConversation["handoff"];

    if (route) {
      const handle = resolution.builder.connectSession(route.session_id);
      const session = handle.getSession();
      if (session && !isTerminalState(session.state) && !isIdle(session.state, session.last_active_at, this.idleTimeoutMs)) {
        this.options.mappingStore.upsertRoute({
          ...route,
          sender_id: message.sender_id,
          canonical_user_id: canonicalUserId,
          agent_profile_id: resolution.profile.profile_id,
          workspace_id: resolution.workspace_id,
          route_scope_key: resolution.route_scope_key,
          memory_scope: resolution.profile.memory_scope,
          tool_scope: resolution.profile.tool_scope,
          policy_scope: resolution.profile.policy_scope,
          updated_at: input.created_at,
          last_active_at: input.created_at
        });

        return {
          session_id: route.session_id,
          handle,
          is_new: false,
          resumed_from_checkpoint: false,
          canonical_user_id: canonicalUserId,
          agent_profile_id: resolution.profile.profile_id,
          workspace_id: resolution.workspace_id,
          runtime_input: runtimeInput
        };
      }

      if (session) {
        handoff = buildConversationHandoff(
          handle,
          route.session_id,
          isTerminalState(session.state) ? "terminal" : "idle",
          input.created_at
        );
      }

      if (session && !isTerminalState(session.state)) {
        try {
          handle.checkpoint();
        } catch {}
      }
    }

    const initialInput = handoff ? attachConversationHandoff(runtimeInput, handoff) : runtimeInput;
    const handle = resolution.builder.createSession({
      agent_id: resolution.builder.getProfile().agent_id,
      tenant_id: resolution.profile.tenant_id,
      user_id: canonicalUserId,
      session_mode: "sync",
      initial_input: initialInput
    });

    const newRoute: SessionRoute = {
      platform: message.platform,
      chat_id: message.chat_id,
      route_scope_key: resolution.route_scope_key,
      session_id: handle.id,
      sender_id: message.sender_id,
      canonical_user_id: canonicalUserId,
      agent_profile_id: resolution.profile.profile_id,
      workspace_id: resolution.workspace_id,
      memory_scope: resolution.profile.memory_scope,
      tool_scope: resolution.profile.tool_scope,
      policy_scope: resolution.profile.policy_scope,
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
      canonical_user_id: canonicalUserId,
      handoff,
      agent_profile_id: resolution.profile.profile_id,
      workspace_id: resolution.workspace_id,
      runtime_input: initialInput
    };
  }

  public clearRoute(message: Pick<UnifiedMessage, "platform" | "chat_id" | "sender_id" | "channel" | "metadata">): void {
    const canonicalUserId = this.resolveCanonicalUserId(message);
    const resolution = this.options.profileRegistry.resolve(message as UnifiedMessage, { canonicalUserId });
    this.options.mappingStore.deleteRoute(message.platform, message.chat_id, toRouteScope(resolution));
  }

  public listRoutesForUser(userId: string): SessionRoute[] {
    return this.options.mappingStore.listRoutesForUser(userId);
  }

  public connect(sessionId: string): AgentSessionHandle {
    for (const { builder } of this.options.profileRegistry.listRuntimeProfiles()) {
      try {
        return builder.connectSession(sessionId);
      } catch {}
    }
    throw new Error(`Unknown session: ${sessionId}`);
  }

  private resolveCanonicalUserId(message: Pick<UnifiedMessage, "platform" | "sender_id">): string {
    return (
      this.options.userLinkStore?.resolveCanonicalUserId(message.platform, message.sender_id) ??
      message.sender_id
    );
  }
}

function attachAgentProfileMetadata(input: UserInput, resolution: AgentProfileResolution): UserInput {
  return {
    ...input,
    metadata: {
      ...(input.metadata ?? {}),
      agent_profile_id: resolution.profile.profile_id,
      workspace_id: resolution.workspace_id,
      agent_profile: {
        profile_id: resolution.profile.profile_id,
        agent_id: resolution.profile.agent_id,
        tenant_id: resolution.profile.tenant_id,
        display_name: resolution.profile.display_name,
        memory_scope: resolution.profile.memory_scope,
        tool_scope: resolution.profile.tool_scope,
        policy_scope: resolution.profile.policy_scope,
        default_workspace_id: resolution.profile.default_workspace_id,
        binding_id: resolution.binding?.binding_id,
        route_scope_key: resolution.route_scope_key
      }
    }
  };
}

function toRouteScope(resolution: AgentProfileResolution): SessionRouteScope {
  return {
    agent_profile_id: resolution.profile.profile_id,
    workspace_id: resolution.workspace_id,
    route_scope_key: resolution.route_scope_key
  };
}
