import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { IMPlatform } from "../im-gateway/types.js";
import { isIMPlatform } from "../im-gateway/types.js";

export type AgentSkillRiskLevel = "none" | "low" | "medium" | "high";

export interface AgentSkillRecord {
  id: string;
  name: string;
  description: string;
  directory: string;
  skill_path: string;
  permissions: string[];
  channels: IMPlatform[];
  risk_level: AgentSkillRiskLevel;
  enabled: boolean;
  content_hash: string;
  instructions: string;
}

export interface AgentSkillInvokeResult {
  skill: AgentSkillRecord;
  input: string;
  platform?: IMPlatform;
  allowed: boolean;
}

export interface AgentSkillRegistryConfig {
  directories?: string[];
  enabled?: boolean;
  marketplace_enabled?: boolean;
  marketplace_fixture?: boolean;
}

export interface AgentSkillContext {
  platform?: IMPlatform;
}

export class AgentSkillRegistry {
  private readonly skillsById = new Map<string, AgentSkillRecord>();

  public static fromDirectories(directories: string[]): AgentSkillRegistry {
    const registry = new AgentSkillRegistry();
    registry.loadDirectories(directories);
    return registry;
  }

  public loadDirectories(directories: string[]): void {
    for (const directory of directories) {
      for (const skillPath of discoverSkillFiles(directory)) {
        this.registerSkill(parseSkillFile(skillPath));
      }
    }
  }

  public registerSkill(skill: AgentSkillRecord): void {
    this.skillsById.set(skill.id, skill);
  }

  public removeSkill(skillId: string): AgentSkillRecord | undefined {
    const skill = this.skillsById.get(skillId);
    this.skillsById.delete(skillId);
    return skill;
  }

  public listSkills(context: AgentSkillContext = {}): AgentSkillRecord[] {
    return [...this.skillsById.values()]
      .filter((skill) => skill.enabled)
      .filter((skill) => isSkillVisible(skill, context.platform))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  public listAllSkills(context: AgentSkillContext = {}): AgentSkillRecord[] {
    return [...this.skillsById.values()]
      .filter((skill) => isSkillVisible(skill, context.platform))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  public searchSkills(query: string, context: AgentSkillContext = {}): AgentSkillRecord[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.listSkills(context);
    }
    return this.listSkills(context).filter((skill) =>
      [skill.id, skill.name, skill.description, skill.permissions.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }

  public getSkill(skillId: string): AgentSkillRecord | undefined {
    return this.skillsById.get(skillId);
  }

  public setSkillEnabled(skillId: string, enabled: boolean): AgentSkillRecord {
    const skill = this.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} is not installed.`);
    }
    const next = { ...skill, enabled };
    this.skillsById.set(skillId, next);
    return next;
  }

  public invokeSkill(skillId: string, input: string, context: AgentSkillContext = {}): AgentSkillInvokeResult {
    const skill = this.getSkill(skillId);
    if (!skill || !skill.enabled || !isSkillVisible(skill, context.platform)) {
      throw new Error(`Skill ${skillId} is not available in this channel.`);
    }
    return {
      skill,
      input,
      platform: context.platform,
      allowed: true
    };
  }
}

export function createAgentSkillRegistryFromConfig(config: AgentSkillRegistryConfig | undefined): AgentSkillRegistry | undefined {
  if (!config || config.enabled === false || !config.directories || config.directories.length === 0) {
    return undefined;
  }
  return AgentSkillRegistry.fromDirectories(config.directories);
}

function discoverSkillFiles(directory: string): string[] {
  const root = resolve(directory);
  if (!existsSync(root)) {
    return [];
  }
  const directSkill = join(root, "SKILL.md");
  if (existsSync(directSkill)) {
    return [directSkill];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) {
      return [];
    }
    return discoverSkillFiles(join(root, entry.name));
  });
}

function parseSkillFile(skillPath: string): AgentSkillRecord {
  const resolved = resolve(skillPath);
  const content = readFileSync(resolved, "utf8");
  const directory = resolve(join(resolved, ".."));
  const metadata = parseFrontmatter(content);
  const body = stripFrontmatter(content);
  const name = metadata.name ?? firstHeading(body) ?? basename(directory);
  const description = metadata.description ?? firstParagraph(body) ?? "";
  const enabled = metadata.enabled === undefined ? true : metadata.enabled !== "false";
  const permissions = parseList(metadata.permissions);
  const channels = parseList(metadata.channels).filter(isIMPlatform);
  const riskLevel = parseRiskLevel(metadata.risk_level);
  const id = normalizeSkillId(metadata.id ?? basename(directory));
  return {
    id,
    name,
    description,
    directory,
    skill_path: resolved,
    permissions,
    channels,
    risk_level: riskLevel,
    enabled,
    content_hash: createHash("sha256").update(content).digest("hex"),
    instructions: body.trim()
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) {
    return {};
  }
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(":");
        if (index === -1) {
          return undefined;
        }
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  );
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function firstHeading(content: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(content);
  return match?.[1]?.trim();
}

function firstParagraph(content: string): string | undefined {
  return content
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith("#"));
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseRiskLevel(value: string | undefined): AgentSkillRiskLevel {
  if (value === "none" || value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isSkillVisible(skill: AgentSkillRecord, platform: IMPlatform | undefined): boolean {
  return skill.channels.length === 0 || (platform !== undefined && skill.channels.includes(platform));
}
