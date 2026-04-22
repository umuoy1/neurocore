import type { SkillPolicyState } from "@neurocore/protocol";
import type { SkillPolicyStateStore } from "./skill-policy-store.js";

export class InMemorySkillPolicyStateStore implements SkillPolicyStateStore {
  private readonly entries = new Map<string, SkillPolicyState>();

  public save(state: SkillPolicyState): void {
    this.entries.set(toKey(state.tenant_id, state.skill_id, state.context_key), structuredClone(state));
  }

  public get(tenantId: string, skillId: string, contextKey?: string): SkillPolicyState | undefined {
    const entry = this.entries.get(toKey(tenantId, skillId, contextKey));
    return entry ? structuredClone(entry) : undefined;
  }

  public list(tenantId: string): SkillPolicyState[] {
    const result: SkillPolicyState[] = [];
    for (const [key, value] of this.entries.entries()) {
      if (key.startsWith(`${tenantId}:`)) {
        result.push(structuredClone(value));
      }
    }
    return result.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  public deleteTenant(tenantId: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.entries.delete(key);
      }
    }
  }
}

function toKey(tenantId: string, skillId: string, contextKey?: string) {
  return `${tenantId}:${skillId}:${contextKey ?? "__global__"}`;
}
