import type { AgentBuilder } from "@neurocore/sdk-core";
import type { IMPlatform, PersonalChannelKind, UnifiedMessage } from "../types.js";

export interface AgentProfileToolPolicy {
  allowed_tools?: string[];
  blocked_tools?: string[];
  required_approval_tools?: string[];
  required_sandbox_tools?: string[];
}

export interface PersonalAgentProfile {
  profile_id: string;
  agent_id: string;
  tenant_id: string;
  display_name?: string;
  memory_scope: string;
  tool_scope: string;
  policy_scope: string;
  default_workspace_id?: string;
  tool_policy?: AgentProfileToolPolicy;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentProfileBinding {
  binding_id: string;
  profile_id: string;
  priority: number;
  user_id?: string;
  platform?: IMPlatform;
  chat_id?: string;
  channel_kind?: PersonalChannelKind;
  workspace_id?: string;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type AgentProfilePolicyChangeType =
  | "tool_policy_update"
  | "policy_scope_update"
  | "approval_policy_update"
  | "channel_policy_update";

export interface AgentProfilePolicyAuditEntry {
  audit_id: string;
  profile_id: string;
  actor_id: string;
  change_type: AgentProfilePolicyChangeType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentProfileStore {
  upsertProfile(profile: PersonalAgentProfile): void;
  getProfile(profileId: string): PersonalAgentProfile | undefined;
  listProfiles(): PersonalAgentProfile[];
  upsertBinding(binding: AgentProfileBinding): void;
  getBinding(bindingId: string): AgentProfileBinding | undefined;
  listBindings(options?: { activeOnly?: boolean; profileId?: string }): AgentProfileBinding[];
  recordPolicyAudit(entry: AgentProfilePolicyAuditEntry): void;
  listPolicyAudit(profileId?: string): AgentProfilePolicyAuditEntry[];
}

export interface AgentProfileRuntimeRegistration {
  profile: Partial<PersonalAgentProfile> & {
    profile_id: string;
    tenant_id: string;
  };
  builder: AgentBuilder;
}

export interface AgentProfileResolution {
  profile: PersonalAgentProfile;
  builder: AgentBuilder;
  binding?: AgentProfileBinding;
  workspace_id?: string;
  route_scope_key: string;
}

export class InMemoryAgentProfileStore implements AgentProfileStore {
  private readonly profiles = new Map<string, PersonalAgentProfile>();
  private readonly bindings = new Map<string, AgentProfileBinding>();
  private readonly auditEntries: AgentProfilePolicyAuditEntry[] = [];

  public upsertProfile(profile: PersonalAgentProfile): void {
    this.profiles.set(profile.profile_id, cloneProfile(profile));
  }

  public getProfile(profileId: string): PersonalAgentProfile | undefined {
    const profile = this.profiles.get(profileId);
    return profile ? cloneProfile(profile) : undefined;
  }

  public listProfiles(): PersonalAgentProfile[] {
    return [...this.profiles.values()].map(cloneProfile);
  }

  public upsertBinding(binding: AgentProfileBinding): void {
    this.bindings.set(binding.binding_id, cloneBinding(binding));
  }

  public getBinding(bindingId: string): AgentProfileBinding | undefined {
    const binding = this.bindings.get(bindingId);
    return binding ? cloneBinding(binding) : undefined;
  }

  public listBindings(options: { activeOnly?: boolean; profileId?: string } = {}): AgentProfileBinding[] {
    return [...this.bindings.values()]
      .filter((binding) => !options.activeOnly || binding.active)
      .filter((binding) => !options.profileId || binding.profile_id === options.profileId)
      .sort(sortBindings)
      .map(cloneBinding);
  }

  public recordPolicyAudit(entry: AgentProfilePolicyAuditEntry): void {
    this.auditEntries.push(cloneAuditEntry(entry));
  }

  public listPolicyAudit(profileId?: string): AgentProfilePolicyAuditEntry[] {
    return this.auditEntries
      .filter((entry) => !profileId || entry.profile_id === profileId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(cloneAuditEntry);
  }
}

export interface AgentProfileRegistryOptions {
  store?: AgentProfileStore;
  defaultProfileId?: string;
  now?: () => string;
  generateId?: (prefix: string) => string;
}

export class AgentProfileRegistry {
  private readonly store: AgentProfileStore;
  private readonly builders = new Map<string, AgentBuilder>();
  private defaultProfileId?: string;
  private readonly now: () => string;
  private readonly generateId: (prefix: string) => string;

  public constructor(options: AgentProfileRegistryOptions = {}) {
    this.store = options.store ?? new InMemoryAgentProfileStore();
    this.defaultProfileId = options.defaultProfileId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`);
  }

  public registerProfile(registration: AgentProfileRuntimeRegistration): PersonalAgentProfile {
    const current = this.store.getProfile(registration.profile.profile_id);
    const timestamp = this.now();
    const builderProfile = registration.builder.getProfile();
    const profile: PersonalAgentProfile = {
      profile_id: registration.profile.profile_id,
      agent_id: registration.profile.agent_id ?? builderProfile.agent_id,
      tenant_id: registration.profile.tenant_id,
      display_name: registration.profile.display_name ?? current?.display_name,
      memory_scope: registration.profile.memory_scope ?? current?.memory_scope ?? registration.profile.profile_id,
      tool_scope: registration.profile.tool_scope ?? current?.tool_scope ?? registration.profile.profile_id,
      policy_scope: registration.profile.policy_scope ?? current?.policy_scope ?? registration.profile.profile_id,
      default_workspace_id: registration.profile.default_workspace_id ?? current?.default_workspace_id,
      tool_policy: cloneToolPolicy(registration.profile.tool_policy ?? current?.tool_policy),
      metadata: cloneRecord(registration.profile.metadata ?? current?.metadata ?? {}),
      created_at: registration.profile.created_at ?? current?.created_at ?? timestamp,
      updated_at: timestamp
    };

    this.store.upsertProfile(profile);
    this.builders.set(profile.profile_id, registration.builder);
    this.defaultProfileId ??= profile.profile_id;
    return cloneProfile(profile);
  }

  public upsertBinding(binding: Partial<AgentProfileBinding> & { profile_id: string }): AgentProfileBinding {
    if (!this.store.getProfile(binding.profile_id)) {
      throw new Error(`Unknown agent profile: ${binding.profile_id}`);
    }
    const current = binding.binding_id ? this.store.getBinding(binding.binding_id) : undefined;
    const timestamp = this.now();
    const next: AgentProfileBinding = {
      binding_id: binding.binding_id ?? this.generateId("apb"),
      profile_id: binding.profile_id,
      priority: binding.priority ?? current?.priority ?? 0,
      user_id: binding.user_id ?? current?.user_id,
      platform: binding.platform ?? current?.platform,
      chat_id: binding.chat_id ?? current?.chat_id,
      channel_kind: binding.channel_kind ?? current?.channel_kind,
      workspace_id: binding.workspace_id ?? current?.workspace_id,
      active: binding.active ?? current?.active ?? true,
      metadata: cloneRecord(binding.metadata ?? current?.metadata ?? {}),
      created_at: binding.created_at ?? current?.created_at ?? timestamp,
      updated_at: timestamp
    };

    this.store.upsertBinding(next);
    return cloneBinding(next);
  }

  public resolve(message: UnifiedMessage, options: { canonicalUserId?: string } = {}): AgentProfileResolution {
    const workspaceId = resolveWorkspaceId(message);
    const canonicalUserId = options.canonicalUserId ?? message.identity?.canonical_user_id ?? message.sender_id;
    const candidates = this.store
      .listBindings({ activeOnly: true })
      .filter((binding) => bindingMatches(binding, message, canonicalUserId, workspaceId));
    const binding = candidates[0];
    const profileId = binding?.profile_id ?? this.defaultProfileId;

    if (!profileId) {
      throw new Error("No agent profile is registered.");
    }

    const profile = this.store.getProfile(profileId);
    if (!profile) {
      throw new Error(`Unknown agent profile: ${profileId}`);
    }

    const builder = this.builders.get(profile.profile_id);
    if (!builder) {
      throw new Error(`Agent profile ${profile.profile_id} has no runtime builder.`);
    }

    const selectedWorkspaceId = binding?.workspace_id ?? workspaceId ?? profile.default_workspace_id;
    return {
      profile,
      builder,
      binding,
      workspace_id: selectedWorkspaceId,
      route_scope_key: buildAgentProfileRouteScopeKey(profile.profile_id, selectedWorkspaceId)
    };
  }

  public listProfiles(): PersonalAgentProfile[] {
    return this.store.listProfiles();
  }

  public listBindings(options?: { activeOnly?: boolean; profileId?: string }): AgentProfileBinding[] {
    return this.store.listBindings(options);
  }

  public listRuntimeProfiles(): Array<{ profile: PersonalAgentProfile; builder: AgentBuilder }> {
    return this.store
      .listProfiles()
      .flatMap((profile) => {
        const builder = this.builders.get(profile.profile_id);
        return builder ? [{ profile, builder }] : [];
      });
  }

  public updateProfileToolPolicy(input: {
    profile_id: string;
    actor_id: string;
    tool_policy: AgentProfileToolPolicy;
    metadata?: Record<string, unknown>;
    apply_runtime_policy?: boolean;
  }): AgentProfilePolicyAuditEntry {
    const profile = this.store.getProfile(input.profile_id);
    if (!profile) {
      throw new Error(`Unknown agent profile: ${input.profile_id}`);
    }

    const before = {
      tool_policy: cloneToolPolicy(profile.tool_policy) ?? {}
    };
    const after = {
      tool_policy: cloneToolPolicy(input.tool_policy) ?? {}
    };
    const timestamp = this.now();
    const nextProfile: PersonalAgentProfile = {
      ...profile,
      tool_policy: cloneToolPolicy(input.tool_policy),
      updated_at: timestamp
    };
    this.store.upsertProfile(nextProfile);

    if (input.apply_runtime_policy) {
      this.builders.get(input.profile_id)?.configurePolicy({
        blockedTools: input.tool_policy.blocked_tools,
        requiredApprovalTools: input.tool_policy.required_approval_tools
      });
    }

    const entry: AgentProfilePolicyAuditEntry = {
      audit_id: this.generateId("apa"),
      profile_id: input.profile_id,
      actor_id: input.actor_id,
      change_type: "tool_policy_update",
      before,
      after,
      metadata: cloneRecord(input.metadata ?? {}),
      created_at: timestamp
    };
    this.store.recordPolicyAudit(entry);
    return cloneAuditEntry(entry);
  }

  public recordPolicyAudit(entry: Omit<AgentProfilePolicyAuditEntry, "audit_id" | "created_at"> & {
    audit_id?: string;
    created_at?: string;
  }): AgentProfilePolicyAuditEntry {
    const next: AgentProfilePolicyAuditEntry = {
      audit_id: entry.audit_id ?? this.generateId("apa"),
      profile_id: entry.profile_id,
      actor_id: entry.actor_id,
      change_type: entry.change_type,
      before: cloneRecord(entry.before),
      after: cloneRecord(entry.after),
      metadata: cloneRecord(entry.metadata),
      created_at: entry.created_at ?? this.now()
    };
    this.store.recordPolicyAudit(next);
    return cloneAuditEntry(next);
  }

  public listPolicyAudit(profileId?: string): AgentProfilePolicyAuditEntry[] {
    return this.store.listPolicyAudit(profileId);
  }
}

export function buildAgentProfileRouteScopeKey(profileId: string, workspaceId?: string): string {
  return `profile:${profileId}|workspace:${workspaceId ?? "default"}`;
}

export function resolveWorkspaceId(message: UnifiedMessage): string | undefined {
  return (
    readString(message.channel?.metadata?.workspace_id) ??
    readString((message.channel?.metadata?.workspace as Record<string, unknown> | undefined)?.id) ??
    readString(message.metadata.workspace_id) ??
    readString((message.metadata.workspace as Record<string, unknown> | undefined)?.id)
  );
}

function bindingMatches(
  binding: AgentProfileBinding,
  message: UnifiedMessage,
  canonicalUserId: string,
  workspaceId: string | undefined
): boolean {
  if (binding.user_id && binding.user_id !== canonicalUserId && binding.user_id !== message.sender_id) {
    return false;
  }
  if (binding.platform && binding.platform !== message.platform) {
    return false;
  }
  if (binding.chat_id && binding.chat_id !== message.chat_id) {
    return false;
  }
  if (binding.channel_kind && binding.channel_kind !== message.channel?.kind) {
    return false;
  }
  if (binding.workspace_id && binding.workspace_id !== workspaceId) {
    return false;
  }
  return true;
}

function sortBindings(left: AgentProfileBinding, right: AgentProfileBinding): number {
  const priorityDelta = right.priority - left.priority;
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  const specificityDelta = bindingSpecificity(right) - bindingSpecificity(left);
  if (specificityDelta !== 0) {
    return specificityDelta;
  }
  return right.updated_at.localeCompare(left.updated_at);
}

function bindingSpecificity(binding: AgentProfileBinding): number {
  return [
    binding.user_id,
    binding.platform,
    binding.chat_id,
    binding.channel_kind,
    binding.workspace_id
  ].filter(Boolean).length;
}

function cloneProfile(profile: PersonalAgentProfile): PersonalAgentProfile {
  return {
    ...profile,
    tool_policy: cloneToolPolicy(profile.tool_policy),
    metadata: cloneRecord(profile.metadata)
  };
}

function cloneBinding(binding: AgentProfileBinding): AgentProfileBinding {
  return {
    ...binding,
    metadata: cloneRecord(binding.metadata)
  };
}

function cloneAuditEntry(entry: AgentProfilePolicyAuditEntry): AgentProfilePolicyAuditEntry {
  return {
    ...entry,
    before: cloneRecord(entry.before),
    after: cloneRecord(entry.after),
    metadata: cloneRecord(entry.metadata)
  };
}

function cloneToolPolicy(policy: AgentProfileToolPolicy | undefined): AgentProfileToolPolicy | undefined {
  if (!policy) {
    return undefined;
  }
  const next: AgentProfileToolPolicy = {};
  if (policy.allowed_tools) {
    next.allowed_tools = [...policy.allowed_tools];
  }
  if (policy.blocked_tools) {
    next.blocked_tools = [...policy.blocked_tools];
  }
  if (policy.required_approval_tools) {
    next.required_approval_tools = [...policy.required_approval_tools];
  }
  if (policy.required_sandbox_tools) {
    next.required_sandbox_tools = [...policy.required_sandbox_tools];
  }
  return next;
}

function cloneRecord(record: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...(record ?? {}) };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
