import type { JsonObject, JsonValue, Tool } from "@neurocore/protocol";
import type { IMPlatform } from "../im-gateway/types.js";
import { isIMPlatform } from "../im-gateway/types.js";
import type { AgentSkillRecord, AgentSkillRegistry } from "./agent-skill-registry.js";

export function createPersonalSkillTools(registry: AgentSkillRegistry): Tool[] {
  return [
    {
      name: "personal_skill_list",
      description: "List available AgentSkills for an optional channel.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string" }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          skills: {
            type: "array",
            items: { type: "object" }
          }
        }
      },
      async invoke(input) {
        const platform = normalizePlatform(input.platform);
        const skills = registry.listSkills({ platform });
        return {
          summary: formatSkillList(skills),
          payload: {
            skills: skills.map(serializeSkill) as JsonValue[]
          }
        };
      }
    },
    {
      name: "personal_skill_invoke",
      description: "Invoke an indexed AgentSkill after channel visibility checks.",
      sideEffectLevel: "low",
      inputSchema: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
          input: { type: "string" },
          platform: { type: "string" }
        },
        required: ["skill_id"]
      },
      outputSchema: {
        type: "object",
        properties: {
          skill: { type: "object" },
          input: { type: "string" },
          allowed: { type: "boolean" },
          instructions: { type: "string" }
        }
      },
      async invoke(input) {
        const skillId = typeof input.skill_id === "string" ? input.skill_id : "";
        const skillInput = typeof input.input === "string" ? input.input : "";
        const platform = normalizePlatform(input.platform);
        const result = registry.invokeSkill(skillId, skillInput, { platform });
        const payload: JsonObject = {
          skill: serializeSkill(result.skill),
          input: result.input,
          allowed: result.allowed,
          platform: result.platform,
          instructions: result.skill.instructions
        };
        return {
          summary: `Skill ${result.skill.name} invoked. risk=${result.skill.risk_level}; permissions=${formatPermissions(result.skill.permissions)}`,
          payload
        };
      }
    }
  ];
}

export function serializeSkill(skill: AgentSkillRecord): Record<string, JsonValue> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    directory: skill.directory,
    skill_path: skill.skill_path,
    permissions: skill.permissions,
    channels: skill.channels,
    risk_level: skill.risk_level,
    enabled: skill.enabled,
    content_hash: skill.content_hash
  };
}

function formatSkillList(skills: AgentSkillRecord[]): string {
  if (skills.length === 0) {
    return "No skills are available for this channel.";
  }
  return `Available skills: ${skills.map((skill) => `${skill.id} (${skill.risk_level})`).join(", ")}`;
}

function formatPermissions(permissions: string[]): string {
  return permissions.length > 0 ? permissions.join(",") : "none";
}

function normalizePlatform(value: unknown): IMPlatform | undefined {
  return isIMPlatform(value) ? value : undefined;
}
