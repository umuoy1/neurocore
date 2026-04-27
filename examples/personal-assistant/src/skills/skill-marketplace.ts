import { createHash } from "node:crypto";
import type { JsonValue, Tool } from "@neurocore/protocol";
import type { IMPlatform } from "../im-gateway/types.js";
import { isIMPlatform } from "../im-gateway/types.js";
import {
  AgentSkillRegistry,
  type AgentSkillRecord,
  type AgentSkillRiskLevel
} from "./agent-skill-registry.js";
import { serializeSkill } from "./skill-tools.js";

export interface MarketplaceSkillPackage {
  package_id: string;
  skill_id?: string;
  source_id: string;
  version: string;
  name: string;
  description: string;
  instructions: string;
  permissions: string[];
  channels?: IMPlatform[];
  risk_level: AgentSkillRiskLevel;
  metadata?: Record<string, unknown>;
}

export interface SkillMarketplaceSource {
  source_id: string;
  display_name: string;
  packages: MarketplaceSkillPackage[];
}

export interface InstalledMarketplaceSkill {
  skill_id: string;
  package_id: string;
  source_id: string;
  version: string;
  pinned_version?: string;
  enabled: boolean;
  installed_at: string;
  updated_at: string;
}

export interface SkillMarketplaceAuditEvent {
  audit_id: string;
  event_type: "searched" | "installed" | "updated" | "update_failed_rollback" | "update_blocked_pinned" | "enabled" | "disabled" | "removed";
  skill_id?: string;
  package_id?: string;
  source_id?: string;
  version?: string;
  actor_id?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface SkillMarketplaceOptions {
  registry: AgentSkillRegistry;
  sources?: SkillMarketplaceSource[];
}

export class SkillMarketplace {
  private readonly sources = new Map<string, SkillMarketplaceSource>();
  private readonly installed = new Map<string, InstalledMarketplaceSkill>();
  private readonly auditEvents: SkillMarketplaceAuditEvent[] = [];
  private sequence = 0;

  public constructor(private readonly options: SkillMarketplaceOptions) {
    for (const source of options.sources ?? []) {
      this.addSource(source);
    }
  }

  public addSource(source: SkillMarketplaceSource): void {
    this.sources.set(source.source_id, {
      ...source,
      packages: source.packages.map((pkg) => ({ ...pkg, source_id: source.source_id }))
    });
  }

  public search(query = "", input: { source_id?: string; actor_id?: string } = {}): MarketplaceSkillPackage[] {
    const normalized = query.trim().toLowerCase();
    const packages = this.listPackages(input.source_id).filter((pkg) => {
      if (!normalized) {
        return true;
      }
      return [
        pkg.package_id,
        pkg.skill_id ?? "",
        pkg.name,
        pkg.description,
        pkg.permissions.join(" "),
        pkg.risk_level
      ].join(" ").toLowerCase().includes(normalized);
    });
    this.audit({
      event_type: "searched",
      actor_id: input.actor_id,
      source_id: input.source_id,
      metadata: { query, result_count: packages.length }
    });
    return packages.map(clonePackage);
  }

  public install(input: {
    source_id: string;
    package_id: string;
    version?: string;
    enabled?: boolean;
    pin_version?: boolean;
    actor_id?: string;
  }): InstalledMarketplaceSkill {
    const pkg = this.resolvePackage(input.source_id, input.package_id, input.version);
    const skill = skillFromPackage(pkg, input.enabled === true);
    this.options.registry.registerSkill(skill);
    const timestamp = new Date().toISOString();
    const installed: InstalledMarketplaceSkill = {
      skill_id: skill.id,
      package_id: pkg.package_id,
      source_id: pkg.source_id,
      version: pkg.version,
      pinned_version: input.pin_version ? pkg.version : undefined,
      enabled: skill.enabled,
      installed_at: timestamp,
      updated_at: timestamp
    };
    this.installed.set(skill.id, installed);
    this.audit({
      event_type: "installed",
      skill_id: skill.id,
      package_id: pkg.package_id,
      source_id: pkg.source_id,
      version: pkg.version,
      actor_id: input.actor_id,
      metadata: {
        enabled: skill.enabled,
        permissions: pkg.permissions,
        risk_level: pkg.risk_level,
        pinned_version: installed.pinned_version
      }
    });
    return { ...installed };
  }

  public update(input: {
    skill_id: string;
    version?: string;
    force?: boolean;
    actor_id?: string;
  }): { installed: InstalledMarketplaceSkill; rolled_back: boolean; error?: string } {
    const current = this.requireInstalled(input.skill_id);
    if (current.pinned_version && !input.force) {
      this.audit({
        event_type: "update_blocked_pinned",
        skill_id: current.skill_id,
        package_id: current.package_id,
        source_id: current.source_id,
        version: current.version,
        actor_id: input.actor_id,
        metadata: { pinned_version: current.pinned_version }
      });
      return { installed: { ...current }, rolled_back: true, error: `Skill is pinned to ${current.pinned_version}.` };
    }
    const previousSkill = this.options.registry.getSkill(input.skill_id);
    const pkg = this.resolvePackage(current.source_id, current.package_id, input.version);
    if (pkg.metadata?.install_failure === true) {
      if (previousSkill) {
        this.options.registry.registerSkill(previousSkill);
      }
      this.audit({
        event_type: "update_failed_rollback",
        skill_id: current.skill_id,
        package_id: current.package_id,
        source_id: current.source_id,
        version: pkg.version,
        actor_id: input.actor_id,
        metadata: { previous_version: current.version, error: "package install failure" }
      });
      return { installed: { ...current }, rolled_back: true, error: "Package install failure; previous version retained." };
    }
    const skill = skillFromPackage(pkg, current.enabled);
    this.options.registry.registerSkill(skill);
    const next: InstalledMarketplaceSkill = {
      ...current,
      version: pkg.version,
      updated_at: new Date().toISOString()
    };
    this.installed.set(skill.id, next);
    this.audit({
      event_type: "updated",
      skill_id: skill.id,
      package_id: pkg.package_id,
      source_id: pkg.source_id,
      version: pkg.version,
      actor_id: input.actor_id,
      metadata: { previous_version: current.version }
    });
    return { installed: { ...next }, rolled_back: false };
  }

  public enable(skillId: string, actorId?: string): AgentSkillRecord {
    const skill = this.options.registry.setSkillEnabled(skillId, true);
    this.updateInstalledEnabled(skillId, true);
    this.audit({
      event_type: "enabled",
      skill_id: skillId,
      actor_id: actorId,
      metadata: { permissions: skill.permissions, risk_level: skill.risk_level }
    });
    return skill;
  }

  public disable(skillId: string, actorId?: string): AgentSkillRecord {
    const skill = this.options.registry.setSkillEnabled(skillId, false);
    this.updateInstalledEnabled(skillId, false);
    this.audit({
      event_type: "disabled",
      skill_id: skillId,
      actor_id: actorId
    });
    return skill;
  }

  public remove(skillId: string, actorId?: string): InstalledMarketplaceSkill | undefined {
    const installed = this.installed.get(skillId);
    this.options.registry.removeSkill(skillId);
    this.installed.delete(skillId);
    this.audit({
      event_type: "removed",
      skill_id: skillId,
      actor_id: actorId,
      package_id: installed?.package_id,
      source_id: installed?.source_id,
      version: installed?.version
    });
    return installed ? { ...installed } : undefined;
  }

  public listInstalled(): InstalledMarketplaceSkill[] {
    return [...this.installed.values()].map((item) => ({ ...item }));
  }

  public listAuditEvents(limit = 50): SkillMarketplaceAuditEvent[] {
    return this.auditEvents.slice(-limit).map((event) => ({ ...event, metadata: cloneRecord(event.metadata) }));
  }

  private listPackages(sourceId: string | undefined): MarketplaceSkillPackage[] {
    const sources = sourceId ? [this.requireSource(sourceId)] : [...this.sources.values()];
    return sources.flatMap((source) => source.packages).map(clonePackage);
  }

  private resolvePackage(sourceId: string, packageId: string, version: string | undefined): MarketplaceSkillPackage {
    const source = this.requireSource(sourceId);
    const candidates = source.packages.filter((pkg) => pkg.package_id === packageId);
    const pkg = version
      ? candidates.find((candidate) => candidate.version === version)
      : candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })).at(0);
    if (!pkg) {
      throw new Error(`Marketplace package was not found: ${sourceId}/${packageId}@${version ?? "latest"}`);
    }
    return clonePackage(pkg);
  }

  private requireSource(sourceId: string): SkillMarketplaceSource {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Skill marketplace source was not found: ${sourceId}`);
    }
    return source;
  }

  private requireInstalled(skillId: string): InstalledMarketplaceSkill {
    const installed = this.installed.get(skillId);
    if (!installed) {
      throw new Error(`Skill is not installed from marketplace: ${skillId}`);
    }
    return installed;
  }

  private updateInstalledEnabled(skillId: string, enabled: boolean): void {
    const installed = this.installed.get(skillId);
    if (!installed) {
      return;
    }
    this.installed.set(skillId, {
      ...installed,
      enabled,
      updated_at: new Date().toISOString()
    });
  }

  private audit(input: Omit<SkillMarketplaceAuditEvent, "audit_id" | "created_at">): SkillMarketplaceAuditEvent {
    this.sequence += 1;
    const event: SkillMarketplaceAuditEvent = {
      ...input,
      audit_id: `skill_audit_${this.sequence.toString().padStart(6, "0")}`,
      created_at: new Date().toISOString()
    };
    this.auditEvents.push(event);
    return event;
  }
}

export function createSkillMarketplaceTools(marketplace: SkillMarketplace): Tool[] {
  return [
    createSearchTool(marketplace),
    createInstallTool(marketplace),
    createUpdateTool(marketplace),
    createEnableTool(marketplace),
    createDisableTool(marketplace),
    createRemoveTool(marketplace),
    createAuditTool(marketplace)
  ];
}

export function createFixtureSkillMarketplaceSource(): SkillMarketplaceSource {
  return {
    source_id: "fixture",
    display_name: "Fixture Skills Hub",
    packages: [
      {
        source_id: "fixture",
        package_id: "briefing-writer",
        skill_id: "briefing-writer",
        version: "1.0.0",
        name: "Briefing Writer",
        description: "Draft concise executive briefings from user notes.",
        instructions: "Write concise briefings with context, decision and next action sections.",
        permissions: ["read", "write"],
        channels: ["web", "cli"],
        risk_level: "medium"
      },
      {
        source_id: "fixture",
        package_id: "briefing-writer",
        skill_id: "briefing-writer",
        version: "2.0.0",
        name: "Briefing Writer",
        description: "Draft concise executive briefings with improved structure.",
        instructions: "Write concise upgraded briefings with context, decision, risks and next action sections.",
        permissions: ["read", "write"],
        channels: ["web", "cli"],
        risk_level: "medium"
      }
    ]
  };
}

function createSearchTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_search",
    description: "Search marketplace skills and show permissions, risk and available versions before install.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        source_id: { type: "string" },
        actor_id: { type: "string" }
      }
    },
    async invoke(input) {
      const packages = marketplace.search(readOptionalString(input.query) ?? "", {
        source_id: readOptionalString(input.source_id),
        actor_id: readOptionalString(input.actor_id)
      });
      return {
        summary: `Found ${packages.length} marketplace skill package${packages.length === 1 ? "" : "s"}.`,
        payload: toPayload({ packages: packages.map(serializePackage) })
      };
    }
  };
}

function createInstallTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_install",
    description: "Install a marketplace skill at a selected version, initially disabled unless enabled is true.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        source_id: { type: "string" },
        package_id: { type: "string" },
        version: { type: "string" },
        enabled: { type: "boolean" },
        pin_version: { type: "boolean" },
        actor_id: { type: "string" }
      },
      required: ["source_id", "package_id"]
    },
    async invoke(input) {
      const installed = marketplace.install({
        source_id: readRequiredString(input.source_id, "source_id"),
        package_id: readRequiredString(input.package_id, "package_id"),
        version: readOptionalString(input.version),
        enabled: input.enabled === true,
        pin_version: input.pin_version === true,
        actor_id: readOptionalString(input.actor_id)
      });
      return {
        summary: `Installed skill ${installed.skill_id}@${installed.version}; enabled=${installed.enabled}.`,
        payload: toPayload({ installed })
      };
    }
  };
}

function createUpdateTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_update",
    description: "Update a marketplace-installed skill, rolling back automatically on install failure.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string" },
        version: { type: "string" },
        force: { type: "boolean" },
        actor_id: { type: "string" }
      },
      required: ["skill_id"]
    },
    async invoke(input) {
      const result = marketplace.update({
        skill_id: readRequiredString(input.skill_id, "skill_id"),
        version: readOptionalString(input.version),
        force: input.force === true,
        actor_id: readOptionalString(input.actor_id)
      });
      return {
        summary: result.error
          ? `Skill update retained ${result.installed.skill_id}@${result.installed.version}: ${result.error}`
          : `Updated skill ${result.installed.skill_id}@${result.installed.version}.`,
        payload: toPayload(result)
      };
    }
  };
}

function createEnableTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_enable",
    description: "Enable an installed marketplace skill after reviewing permissions and risk.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string" },
        actor_id: { type: "string" }
      },
      required: ["skill_id"]
    },
    async invoke(input) {
      const skill = marketplace.enable(readRequiredString(input.skill_id, "skill_id"), readOptionalString(input.actor_id));
      return {
        summary: `Enabled skill ${skill.id}. risk=${skill.risk_level}; permissions=${skill.permissions.join(",") || "none"}.`,
        payload: toPayload({ skill: serializeSkill(skill) })
      };
    }
  };
}

function createDisableTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_disable",
    description: "Disable an installed marketplace skill so it can no longer be invoked.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string" },
        actor_id: { type: "string" }
      },
      required: ["skill_id"]
    },
    async invoke(input) {
      const skill = marketplace.disable(readRequiredString(input.skill_id, "skill_id"), readOptionalString(input.actor_id));
      return {
        summary: `Disabled skill ${skill.id}.`,
        payload: toPayload({ skill: serializeSkill(skill) })
      };
    }
  };
}

function createRemoveTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_remove",
    description: "Remove an installed marketplace skill and write an audit event.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string" },
        actor_id: { type: "string" }
      },
      required: ["skill_id"]
    },
    async invoke(input) {
      const removed = marketplace.remove(readRequiredString(input.skill_id, "skill_id"), readOptionalString(input.actor_id));
      return {
        summary: removed ? `Removed skill ${removed.skill_id}.` : "Skill was not installed.",
        payload: toPayload({ removed })
      };
    }
  };
}

function createAuditTool(marketplace: SkillMarketplace): Tool {
  return {
    name: "skill_marketplace_audit",
    description: "List marketplace skill search, install, enable, disable, update and rollback audit events.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" }
      }
    },
    async invoke(input) {
      const events = marketplace.listAuditEvents(readOptionalNumber(input.limit) ?? 50);
      return {
        summary: `Listed ${events.length} skill marketplace audit event${events.length === 1 ? "" : "s"}.`,
        payload: toPayload({ events })
      };
    }
  };
}

function skillFromPackage(pkg: MarketplaceSkillPackage, enabled: boolean): AgentSkillRecord {
  const id = normalizeSkillId(pkg.skill_id ?? pkg.package_id);
  const content = [
    pkg.source_id,
    pkg.package_id,
    pkg.version,
    pkg.name,
    pkg.description,
    pkg.instructions,
    pkg.permissions.join(","),
    pkg.risk_level
  ].join("\n");
  return {
    id,
    name: pkg.name,
    description: pkg.description,
    directory: `marketplace://${pkg.source_id}/${pkg.package_id}`,
    skill_path: `marketplace://${pkg.source_id}/${pkg.package_id}@${pkg.version}`,
    permissions: [...pkg.permissions],
    channels: [...(pkg.channels ?? [])],
    risk_level: pkg.risk_level,
    enabled,
    content_hash: createHash("sha256").update(content).digest("hex"),
    instructions: pkg.instructions
  };
}

function serializePackage(pkg: MarketplaceSkillPackage): Record<string, JsonValue> {
  return {
    package_id: pkg.package_id,
    skill_id: pkg.skill_id ?? normalizeSkillId(pkg.package_id),
    source_id: pkg.source_id,
    version: pkg.version,
    name: pkg.name,
    description: pkg.description,
    permissions: pkg.permissions,
    channels: pkg.channels ?? [],
    risk_level: pkg.risk_level,
    metadata: (pkg.metadata ?? {}) as JsonValue
  };
}

function clonePackage(pkg: MarketplaceSkillPackage): MarketplaceSkillPackage {
  return {
    ...pkg,
    permissions: [...pkg.permissions],
    channels: pkg.channels ? [...pkg.channels] : undefined,
    metadata: cloneRecord(pkg.metadata)
  };
}

function cloneRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return record ? { ...record } : undefined;
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

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toPayload(value: Record<string, unknown>): Record<string, JsonValue | undefined> {
  return value as Record<string, JsonValue | undefined>;
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizeMarketplacePlatform(value: unknown): IMPlatform | undefined {
  return isIMPlatform(value) ? value : undefined;
}
