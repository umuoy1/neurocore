import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue, Tool } from "@neurocore/protocol";
import type { AgentSkillRegistry, AgentSkillRiskLevel } from "../skills/agent-skill-registry.js";
import type { PersonalMemoryStore } from "../memory/personal-memory-store.js";
import type { PersonalProfileProductService } from "../profiles/profile-product-service.js";
import type { PlatformUserLinkStore } from "../im-gateway/conversation/platform-user-link-store.js";
import type { IMPlatform, PersonalChannelKind } from "../im-gateway/types.js";
import { isIMPlatform } from "../im-gateway/types.js";

export type MigrationSourceKind = "openclaw" | "hermes";
export type MigrationObjectType = "persona" | "memory" | "skill" | "allowlist" | "channel" | "api_key_ref" | "workspace_instruction";
export type MigrationActionStatus = "planned" | "imported" | "duplicate" | "skipped" | "failed";

export interface PersonalAssistantMigrationInput {
  home_dir: string;
  source: MigrationSourceKind;
  dry_run?: boolean;
  canonical_user_id: string;
  actor_id?: string;
}

export interface MigrationAction {
  object_type: MigrationObjectType;
  source_id: string;
  target_id?: string;
  status: MigrationActionStatus;
  reason?: string;
  provenance: Record<string, unknown>;
  rollback?: Record<string, unknown>;
}

export interface MigrationRollbackArtifact {
  artifact_id: string;
  reversible: boolean;
  created_at: string;
  operations: Array<{
    object_type: MigrationObjectType;
    target_id: string;
    rollback_action: string;
  }>;
}

export interface PersonalAssistantMigrationReport {
  migration_id: string;
  source: MigrationSourceKind;
  dry_run: boolean;
  home_dir: string;
  canonical_user_id: string;
  created_at: string;
  actions: MigrationAction[];
  counts: Record<MigrationObjectType, number>;
  duplicates: MigrationAction[];
  rollback_artifact?: MigrationRollbackArtifact;
}

export interface PersonalAssistantMigrationImporterOptions {
  memoryStore?: PersonalMemoryStore;
  skillRegistry?: AgentSkillRegistry;
  profileService?: PersonalProfileProductService;
  userLinkStore?: PlatformUserLinkStore;
  tenantId: string;
  agentId: string;
}

interface NormalizedMigrationBundle {
  persona?: {
    profile_id?: string;
    display_name?: string;
    instructions?: string;
  };
  memories: Array<{ id?: string; content: string; created_at?: string }>;
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    instructions: string;
    permissions?: string[];
    risk_level?: AgentSkillRiskLevel;
    enabled?: boolean;
  }>;
  allowlist: Array<{ platform: IMPlatform; sender_id: string; canonical_user_id?: string }>;
  channels: Array<{ platform: IMPlatform; chat_id: string; sender_id?: string; home?: boolean; channel_kind?: PersonalChannelKind }>;
  api_key_refs: Array<{ name: string; ref: string; scope?: string }>;
  workspace_instructions?: string;
}

export class PersonalAssistantMigrationImporter {
  public constructor(private readonly options: PersonalAssistantMigrationImporterOptions) {}

  public run(input: PersonalAssistantMigrationInput): PersonalAssistantMigrationReport {
    const bundle = loadMigrationBundle(input.home_dir, input.source);
    const dryRun = input.dry_run !== false;
    const actions: MigrationAction[] = [];
    const rollbackOperations: MigrationRollbackArtifact["operations"] = [];
    const createdAt = new Date().toISOString();
    const provenanceBase = {
      source: input.source,
      home_dir: input.home_dir
    };

    if (bundle.persona) {
      const profileId = bundle.persona.profile_id ?? `${input.source}-imported`;
      const duplicate = this.profileExists(profileId);
      const action = this.action("persona", profileId, duplicate ? "duplicate" : dryRun ? "planned" : "imported", {
        ...provenanceBase,
        display_name: bundle.persona.display_name
      }, duplicate ? "profile_id already exists" : undefined, profileId);
      actions.push(action);
      if (!dryRun && !duplicate && this.options.profileService) {
        this.options.profileService.createProfile({
          profile_id: profileId,
          actor_id: input.actor_id ?? "migration",
          display_name: bundle.persona.display_name,
          metadata: {
            imported_from: input.source,
            persona_instructions: bundle.persona.instructions,
            workspace_instructions: bundle.workspace_instructions
          }
        });
        rollbackOperations.push({ object_type: "persona", target_id: profileId, rollback_action: "delete_profile_or_deactivate_bindings" });
      }
    }

    const seenMemory = new Set<string>();
    for (const memory of bundle.memories) {
      const sourceId = memory.id ?? memory.content;
      const normalized = memory.content.trim().toLowerCase();
      const duplicate = seenMemory.has(normalized) || this.memoryExists(input.canonical_user_id, memory.content);
      seenMemory.add(normalized);
      const action = this.action("memory", sourceId, duplicate ? "duplicate" : dryRun ? "planned" : "imported", {
        ...provenanceBase,
        content: memory.content
      }, duplicate ? "memory content already exists" : undefined);
      actions.push(action);
      if (!dryRun && !duplicate && this.options.memoryStore) {
        const record = this.options.memoryStore.remember({
          user_id: input.canonical_user_id,
          content: memory.content,
          created_at: memory.created_at,
          source: {
            message_id: `migration:${input.source}:${sourceId}`
          }
        });
        action.target_id = record.memory_id;
        action.rollback = { memory_id: record.memory_id };
        rollbackOperations.push({ object_type: "memory", target_id: record.memory_id, rollback_action: "forget" });
      }
    }

    const seenSkills = new Set<string>();
    for (const skill of bundle.skills) {
      const duplicate = seenSkills.has(skill.id) || Boolean(this.options.skillRegistry?.getSkill(skill.id));
      seenSkills.add(skill.id);
      const action = this.action("skill", skill.id, duplicate ? "duplicate" : dryRun ? "planned" : "imported", {
        ...provenanceBase,
        permissions: skill.permissions ?? [],
        risk_level: skill.risk_level ?? "low"
      }, duplicate ? "skill_id already exists" : undefined, skill.id);
      actions.push(action);
      if (!dryRun && !duplicate && this.options.skillRegistry) {
        this.options.skillRegistry.registerSkill({
          id: skill.id,
          name: skill.name,
          description: skill.description ?? "",
          directory: `migration://${input.source}/skills/${skill.id}`,
          skill_path: `migration://${input.source}/skills/${skill.id}`,
          permissions: skill.permissions ?? [],
          channels: [],
          risk_level: skill.risk_level ?? "low",
          enabled: skill.enabled !== false,
          content_hash: `migration_${randomUUID()}`,
          instructions: skill.instructions
        });
        rollbackOperations.push({ object_type: "skill", target_id: skill.id, rollback_action: "remove_skill" });
      }
    }

    for (const allow of bundle.allowlist) {
      const canonicalUserId = allow.canonical_user_id ?? input.canonical_user_id;
      const duplicate = this.options.userLinkStore?.resolveCanonicalUserId(allow.platform, allow.sender_id) === canonicalUserId;
      const sourceId = `${allow.platform}:${allow.sender_id}`;
      const action = this.action("allowlist", sourceId, duplicate ? "duplicate" : dryRun ? "planned" : "imported", {
        ...provenanceBase,
        canonical_user_id: canonicalUserId
      }, duplicate ? "platform sender already linked" : undefined, sourceId);
      actions.push(action);
      if (!dryRun && !duplicate && this.options.userLinkStore) {
        this.options.userLinkStore.upsertLink({
          platform: allow.platform,
          sender_id: allow.sender_id,
          canonical_user_id: canonicalUserId,
          created_at: createdAt,
          updated_at: createdAt
        });
        rollbackOperations.push({ object_type: "allowlist", target_id: sourceId, rollback_action: "delete_link" });
      }
    }

    for (const channel of bundle.channels) {
      const sourceId = `${channel.platform}:${channel.chat_id}`;
      const action = this.action("channel", sourceId, dryRun ? "planned" : "imported", {
        ...provenanceBase,
        home: channel.home === true
      }, undefined, sourceId);
      actions.push(action);
      if (!dryRun && channel.home === true && this.options.userLinkStore) {
        this.options.userLinkStore.setHomeChannel({
          canonical_user_id: input.canonical_user_id,
          platform: channel.platform,
          chat_id: channel.chat_id,
          sender_id: channel.sender_id ?? input.canonical_user_id,
          created_at: createdAt,
          updated_at: createdAt
        });
        rollbackOperations.push({ object_type: "channel", target_id: sourceId, rollback_action: "clear_home_channel_manually" });
      }
    }

    for (const ref of bundle.api_key_refs) {
      actions.push(this.action("api_key_ref", ref.name, dryRun ? "planned" : "skipped", {
        ...provenanceBase,
        ref: ref.ref,
        scope: ref.scope
      }, dryRun ? undefined : "secret values are not imported; only refs are mapped", ref.ref));
    }

    if (bundle.workspace_instructions) {
      actions.push(this.action("workspace_instruction", "workspace", dryRun ? "planned" : "imported", {
        ...provenanceBase,
        content: bundle.workspace_instructions
      }, undefined, "workspace"));
    }

    return {
      migration_id: `migration_${randomUUID()}`,
      source: input.source,
      dry_run: dryRun,
      home_dir: input.home_dir,
      canonical_user_id: input.canonical_user_id,
      created_at: createdAt,
      actions,
      counts: countActions(actions),
      duplicates: actions.filter((action) => action.status === "duplicate"),
      rollback_artifact: dryRun
        ? undefined
        : {
            artifact_id: `migration_rollback_${randomUUID()}`,
            reversible: true,
            created_at: createdAt,
            operations: rollbackOperations
          }
    };
  }

  private action(
    objectType: MigrationObjectType,
    sourceId: string,
    status: MigrationActionStatus,
    provenance: Record<string, unknown>,
    reason?: string,
    targetId?: string
  ): MigrationAction {
    return {
      object_type: objectType,
      source_id: sourceId,
      target_id: targetId,
      status,
      reason,
      provenance
    };
  }

  private memoryExists(userId: string, content: string): boolean {
    const records = this.options.memoryStore?.listForUser?.(userId, { includeInactive: false, limit: 1000 })
      ?? this.options.memoryStore?.listActive(userId, 1000)
      ?? [];
    return records.some((record) => record.content.trim().toLowerCase() === content.trim().toLowerCase());
  }

  private profileExists(profileId: string): boolean {
    try {
      return Boolean(this.options.profileService?.inspectProfile(profileId));
    } catch {
      return false;
    }
  }
}

export function createPersonalAssistantMigrationTools(importer: PersonalAssistantMigrationImporter): Tool[] {
  return [
    createMigrationTool(importer, true),
    createMigrationTool(importer, false)
  ];
}

function createMigrationTool(importer: PersonalAssistantMigrationImporter, dryRun: boolean): Tool {
  return {
    name: dryRun ? "personal_migration_dry_run" : "personal_migration_import",
    description: dryRun
      ? "Dry-run an OpenClaw or Hermes home migration and return a mapping report without writes."
      : "Import an OpenClaw or Hermes home and return a mapping report with rollback artifact.",
    sideEffectLevel: dryRun ? "none" : "high",
    inputSchema: {
      type: "object",
      properties: {
        home_dir: { type: "string" },
        source: { type: "string" },
        canonical_user_id: { type: "string" },
        actor_id: { type: "string" }
      },
      required: ["home_dir", "source", "canonical_user_id"]
    },
    async invoke(input) {
      const report = importer.run({
        home_dir: readRequiredString(input.home_dir, "home_dir"),
        source: readSource(input.source),
        canonical_user_id: readRequiredString(input.canonical_user_id, "canonical_user_id"),
        actor_id: readOptionalString(input.actor_id),
        dry_run: dryRun
      });
      return {
        summary: `${dryRun ? "Dry-run" : "Imported"} ${report.source} migration with ${report.actions.length} mapped objects and ${report.duplicates.length} duplicates.`,
        payload: toPayload({ report })
      };
    }
  };
}

function loadMigrationBundle(homeDir: string, source: MigrationSourceKind): NormalizedMigrationBundle {
  const filename = source === "openclaw" ? "openclaw.json" : "hermes-agent.json";
  const path = join(homeDir, filename);
  if (!existsSync(path)) {
    throw new Error(`Migration source file was not found: ${path}`);
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return source === "openclaw" ? normalizeOpenClaw(data) : normalizeHermes(data);
}

function normalizeOpenClaw(data: Record<string, unknown>): NormalizedMigrationBundle {
  return {
    persona: readRecord(data.persona),
    memories: readArray(data.memories).map(readMemory).filter(isDefined),
    skills: readArray(data.skills).map(readSkill).filter(isDefined),
    allowlist: readArray(data.allowlist).map(readAllow).filter(isDefined),
    channels: readArray(data.channels).map(readChannel).filter(isDefined),
    api_key_refs: readArray(data.api_key_refs).map(readApiKeyRef).filter(isDefined),
    workspace_instructions: readOptionalString(data.workspace_instructions)
  };
}

function normalizeHermes(data: Record<string, unknown>): NormalizedMigrationBundle {
  const agent = readRecord(data.agent) ?? {};
  const workspace = readRecord(data.workspace) ?? {};
  return {
    persona: readRecord(agent.persona) ?? readRecord(data.persona),
    memories: readArray(data.memory ?? data.memories).map(readMemory).filter(isDefined),
    skills: readArray(data.skills).map(readSkill).filter(isDefined),
    allowlist: readArray(data.allowlist).map(readAllow).filter(isDefined),
    channels: readArray(data.channels).map(readChannel).filter(isDefined),
    api_key_refs: readArray(data.api_key_refs ?? data.secrets).map(readApiKeyRef).filter(isDefined),
    workspace_instructions: readOptionalString(workspace.instructions) ?? readOptionalString(data.workspace_instructions)
  };
}

function readMemory(value: unknown): NormalizedMigrationBundle["memories"][number] | undefined {
  const record = readRecord(value);
  const content = readOptionalString(record?.content ?? value);
  if (!content) return undefined;
  return {
    id: readOptionalString(record?.id),
    content,
    created_at: readOptionalString(record?.created_at)
  };
}

function readSkill(value: unknown): NormalizedMigrationBundle["skills"][number] | undefined {
  const record = readRecord(value);
  const id = readOptionalString(record?.id ?? record?.skill_id);
  const instructions = readOptionalString(record?.instructions);
  if (!record || !id || !instructions) return undefined;
  return {
    id,
    name: readOptionalString(record.name) ?? id,
    description: readOptionalString(record.description),
    instructions,
    permissions: readStringArray(record.permissions),
    risk_level: readRisk(record.risk_level),
    enabled: record.enabled === false ? false : true
  };
}

function readAllow(value: unknown): NormalizedMigrationBundle["allowlist"][number] | undefined {
  const record = readRecord(value);
  const platform = readPlatform(record?.platform);
  const senderId = readOptionalString(record?.sender_id);
  if (!platform || !senderId) return undefined;
  return {
    platform,
    sender_id: senderId,
    canonical_user_id: readOptionalString(record?.canonical_user_id)
  };
}

function readChannel(value: unknown): NormalizedMigrationBundle["channels"][number] | undefined {
  const record = readRecord(value);
  const platform = readPlatform(record?.platform);
  const chatId = readOptionalString(record?.chat_id);
  if (!platform || !chatId) return undefined;
  return {
    platform,
    chat_id: chatId,
    sender_id: readOptionalString(record?.sender_id),
    home: record?.home === true,
    channel_kind: readChannelKind(record?.channel_kind)
  };
}

function readApiKeyRef(value: unknown): NormalizedMigrationBundle["api_key_refs"][number] | undefined {
  const record = readRecord(value);
  const name = readOptionalString(record?.name);
  const ref = readOptionalString(record?.ref);
  if (!name || !ref) return undefined;
  return {
    name,
    ref,
    scope: readOptionalString(record?.scope)
  };
}

function countActions(actions: MigrationAction[]): Record<MigrationObjectType, number> {
  return {
    persona: actions.filter((action) => action.object_type === "persona").length,
    memory: actions.filter((action) => action.object_type === "memory").length,
    skill: actions.filter((action) => action.object_type === "skill").length,
    allowlist: actions.filter((action) => action.object_type === "allowlist").length,
    channel: actions.filter((action) => action.object_type === "channel").length,
    api_key_ref: actions.filter((action) => action.object_type === "api_key_ref").length,
    workspace_instruction: actions.filter((action) => action.object_type === "workspace_instruction").length
  };
}

function readSource(value: unknown): MigrationSourceKind {
  if (value === "openclaw" || value === "hermes") return value;
  throw new Error(`Unsupported migration source: ${String(value)}`);
}

function readPlatform(value: unknown): IMPlatform | undefined {
  return isIMPlatform(value) ? value : undefined;
}

function readChannelKind(value: unknown): PersonalChannelKind | undefined {
  return value === "cli" || value === "im" || value === "web" ? value : undefined;
}

function readRisk(value: unknown): AgentSkillRiskLevel {
  return value === "none" || value === "low" || value === "medium" || value === "high" ? value : "low";
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toPayload(value: Record<string, unknown>): Record<string, JsonValue | undefined> {
  return value as Record<string, JsonValue | undefined>;
}
