import type { SkillDefinition, SkillStore } from "@neurocore/protocol";

interface SkillEntry {
  skill: SkillDefinition;
  tenantId: string;
}

export class InMemorySkillStore implements SkillStore {
  private readonly entries = new Map<string, SkillEntry>();

  public save(skill: SkillDefinition): void {
    const tenantId =
      skill.metadata && typeof skill.metadata.tenant_id === "string"
        ? skill.metadata.tenant_id
        : "default";
    this.entries.set(skill.skill_id, { skill: structuredClone(skill), tenantId });
  }

  public get(skillId: string): SkillDefinition | undefined {
    const entry = this.entries.get(skillId);
    return entry ? structuredClone(entry.skill) : undefined;
  }

  public list(tenantId: string): SkillDefinition[] {
    const result: SkillDefinition[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tenantId === tenantId) {
        result.push(structuredClone(entry.skill));
      }
    }
    return result;
  }

  public findByTrigger(tenantId: string, context: Record<string, unknown>): SkillDefinition[] {
    const matched: SkillDefinition[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tenantId !== tenantId) continue;
      if (entry.skill.trigger_conditions.length === 0) continue;

      const allMatch = entry.skill.trigger_conditions.every((condition) => {
        const actual = context[condition.field];
        if (actual === undefined) return false;

        switch (condition.operator) {
          case "eq":
            return actual === condition.value;
          case "contains":
            return typeof actual === "string" && typeof condition.value === "string" && actual.includes(condition.value);
          case "gt":
            return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
          case "lt":
            return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
          default:
            return false;
        }
      });

      if (allMatch) {
        matched.push(structuredClone(entry.skill));
      }
    }
    return matched;
  }

  public delete(skillId: string): void {
    this.entries.delete(skillId);
  }

  public deleteByTenant(tenantId: string): void {
    for (const [skillId, entry] of this.entries.entries()) {
      if (entry.tenantId === tenantId) {
        this.entries.delete(skillId);
      }
    }
  }
}
