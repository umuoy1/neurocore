import type { AgentBuilder } from "@neurocore/sdk-core";
import type { JsonValue, Tool } from "@neurocore/protocol";
import type { IMPlatform, PersonalChannelKind } from "../im-gateway/types.js";
import type {
  AgentProfileBinding,
  AgentProfileRegistry,
  AgentProfileStore,
  AgentProfileToolPolicy,
  PersonalAgentProfile
} from "../im-gateway/conversation/agent-profile-store.js";

export interface PersonalProfileServiceOptions {
  registry: AgentProfileRegistry;
  store: AgentProfileStore;
  builder: AgentBuilder;
  tenantId: string;
  agentId: string;
  defaultProfileId?: string;
  now?: () => string;
}

export interface CreatePersonalProfileInput {
  profile_id: string;
  actor_id: string;
  display_name?: string;
  memory_scope?: string;
  tool_scope?: string;
  policy_scope?: string;
  default_workspace_id?: string;
  tool_policy?: AgentProfileToolPolicy;
  metadata?: Record<string, unknown>;
}

export interface SwitchPersonalProfileInput {
  profile_id: string;
  actor_id: string;
  user_id: string;
  platform?: IMPlatform;
  chat_id?: string;
  channel_kind?: PersonalChannelKind;
  workspace_id?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface ProfileIsolationViolation {
  left_profile_id: string;
  right_profile_id: string;
  scope: "memory_scope" | "tool_scope" | "policy_scope";
  value: string;
}

export class PersonalProfileProductService {
  private readonly now: () => string;
  private auditSequence = 0;

  public constructor(private readonly options: PersonalProfileServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public ensureDefaultProfile(): PersonalAgentProfile {
    const profileId = this.options.defaultProfileId ?? "default";
    const current = this.options.store.getProfile(profileId);
    if (current) {
      return current;
    }
    return this.options.registry.registerProfile({
      builder: this.options.builder,
      profile: {
        profile_id: profileId,
        agent_id: this.options.agentId,
        tenant_id: this.options.tenantId,
        display_name: "Default",
        memory_scope: "memory:default",
        tool_scope: "tools:default",
        policy_scope: "policy:default",
        metadata: { product_default: true }
      }
    });
  }

  public createProfile(input: CreatePersonalProfileInput): PersonalAgentProfile {
    const profile = this.options.registry.registerProfile({
      builder: this.options.builder,
      profile: {
        profile_id: input.profile_id,
        agent_id: this.options.agentId,
        tenant_id: this.options.tenantId,
        display_name: input.display_name,
        memory_scope: input.memory_scope ?? `memory:${input.profile_id}`,
        tool_scope: input.tool_scope ?? `tools:${input.profile_id}`,
        policy_scope: input.policy_scope ?? `policy:${input.profile_id}`,
        default_workspace_id: input.default_workspace_id,
        tool_policy: input.tool_policy,
        metadata: {
          ...(input.metadata ?? {}),
          created_by: input.actor_id
        }
      }
    });
    this.options.store.recordPolicyAudit({
      audit_id: this.nextAuditId(`pap_${input.profile_id}`),
      profile_id: profile.profile_id,
      actor_id: input.actor_id,
      change_type: "policy_scope_update",
      before: {},
      after: {
        memory_scope: profile.memory_scope,
        tool_scope: profile.tool_scope,
        policy_scope: profile.policy_scope
      },
      metadata: { action: "profile.created" },
      created_at: this.now()
    });
    return profile;
  }

  public inspectProfile(profileId: string): { profile: PersonalAgentProfile; bindings: AgentProfileBinding[]; isolation: ProfileIsolationViolation[] } {
    const profile = this.options.store.getProfile(profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${profileId}`);
    }
    return {
      profile,
      bindings: this.options.store.listBindings({ profileId }),
      isolation: this.detectIsolationViolations().filter((violation) =>
        violation.left_profile_id === profileId || violation.right_profile_id === profileId
      )
    };
  }

  public listProfiles(): { profiles: PersonalAgentProfile[]; isolation: ProfileIsolationViolation[] } {
    return {
      profiles: this.options.store.listProfiles(),
      isolation: this.detectIsolationViolations()
    };
  }

  public switchProfile(input: SwitchPersonalProfileInput): AgentProfileBinding {
    if (!this.options.store.getProfile(input.profile_id)) {
      throw new Error(`Unknown profile: ${input.profile_id}`);
    }
    for (const binding of this.options.store.listBindings({ activeOnly: true })) {
      if (
        binding.user_id === input.user_id &&
        binding.platform === input.platform &&
        binding.chat_id === input.chat_id &&
        binding.workspace_id === input.workspace_id
      ) {
        this.options.registry.upsertBinding({ ...binding, active: false });
      }
    }
    const binding = this.options.registry.upsertBinding({
      profile_id: input.profile_id,
      user_id: input.user_id,
      platform: input.platform,
      chat_id: input.chat_id,
      channel_kind: input.channel_kind,
      workspace_id: input.workspace_id,
      priority: input.priority ?? 100,
      active: true,
      metadata: {
        ...(input.metadata ?? {}),
        switched_by: input.actor_id
      }
    });
    this.options.store.recordPolicyAudit({
      audit_id: this.nextAuditId(`pap_switch_${binding.binding_id}`),
      profile_id: input.profile_id,
      actor_id: input.actor_id,
      change_type: "channel_policy_update",
      before: {},
      after: {
        binding_id: binding.binding_id,
        user_id: binding.user_id,
        platform: binding.platform,
        chat_id: binding.chat_id,
        workspace_id: binding.workspace_id
      },
      metadata: { action: "profile.switched" },
      created_at: this.now()
    });
    return binding;
  }

  public detectIsolationViolations(): ProfileIsolationViolation[] {
    const profiles = this.options.store.listProfiles();
    const violations: ProfileIsolationViolation[] = [];
    for (let leftIndex = 0; leftIndex < profiles.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < profiles.length; rightIndex += 1) {
        const left = profiles[leftIndex];
        const right = profiles[rightIndex];
        for (const scope of ["memory_scope", "tool_scope", "policy_scope"] as const) {
          if (left[scope] === right[scope]) {
            violations.push({
              left_profile_id: left.profile_id,
              right_profile_id: right.profile_id,
              scope,
              value: left[scope]
            });
          }
        }
      }
    }
    return violations;
  }

  private nextAuditId(prefix: string): string {
    this.auditSequence += 1;
    return `${prefix}_${Date.now()}_${this.auditSequence}`;
  }
}

export function createProfileProductTools(service: PersonalProfileProductService): Tool[] {
  return [
    {
      name: "profile_create",
      description: "Create or update a personal assistant profile with isolated memory, tool and policy scopes.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          profile_id: { type: "string" },
          actor_id: { type: "string" },
          display_name: { type: "string" },
          memory_scope: { type: "string" },
          tool_scope: { type: "string" },
          policy_scope: { type: "string" },
          default_workspace_id: { type: "string" }
        },
        required: ["profile_id", "actor_id"]
      },
      async invoke(input) {
        const profile = service.createProfile({
          profile_id: readRequiredString(input.profile_id, "profile_id"),
          actor_id: readRequiredString(input.actor_id, "actor_id"),
          display_name: readOptionalString(input.display_name),
          memory_scope: readOptionalString(input.memory_scope),
          tool_scope: readOptionalString(input.tool_scope),
          policy_scope: readOptionalString(input.policy_scope),
          default_workspace_id: readOptionalString(input.default_workspace_id)
        });
        return { summary: `Profile ${profile.profile_id} saved.`, payload: toJsonRecord(profile) };
      }
    },
    {
      name: "profile_switch",
      description: "Switch a user/channel/workspace route to a personal assistant profile.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          profile_id: { type: "string" },
          actor_id: { type: "string" },
          user_id: { type: "string" },
          platform: { type: "string" },
          chat_id: { type: "string" },
          channel_kind: { type: "string" },
          workspace_id: { type: "string" }
        },
        required: ["profile_id", "actor_id", "user_id"]
      },
      async invoke(input) {
        const binding = service.switchProfile({
          profile_id: readRequiredString(input.profile_id, "profile_id"),
          actor_id: readRequiredString(input.actor_id, "actor_id"),
          user_id: readRequiredString(input.user_id, "user_id"),
          platform: readPlatform(input.platform),
          chat_id: readOptionalString(input.chat_id),
          channel_kind: readChannelKind(input.channel_kind),
          workspace_id: readOptionalString(input.workspace_id)
        });
        return { summary: `Switched to profile ${binding.profile_id}.`, payload: toJsonRecord(binding) };
      }
    },
    {
      name: "profile_inspect",
      description: "Inspect a personal assistant profile, bindings and isolation status.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          profile_id: { type: "string" }
        },
        required: ["profile_id"]
      },
      async invoke(input) {
        const result = service.inspectProfile(readRequiredString(input.profile_id, "profile_id"));
        return { summary: `Profile ${result.profile.profile_id} inspected.`, payload: toJsonRecord(result) };
      }
    },
    {
      name: "profile_list",
      description: "List personal assistant profiles and cross-profile isolation violations.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {}
      },
      async invoke() {
        const result = service.listProfiles();
        return { summary: `Listed ${result.profiles.length} profile(s).`, payload: toJsonRecord(result) };
      }
    }
  ];
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPlatform(value: unknown): IMPlatform | undefined {
  const platform = readOptionalString(value);
  if (!platform) return undefined;
  if (["web", "feishu", "slack", "discord", "telegram", "email", "cli", "whatsapp", "signal", "wechat", "matrix", "teams"].includes(platform)) return platform as IMPlatform;
  throw new Error(`Unsupported platform: ${platform}`);
}

function readChannelKind(value: unknown): PersonalChannelKind | undefined {
  const channelKind = readOptionalString(value);
  if (!channelKind) return undefined;
  if (["dm", "group", "channel", "email_thread", "web_chat", "cli"].includes(channelKind)) return channelKind as PersonalChannelKind;
  throw new Error(`Unsupported channel kind: ${channelKind}`);
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
