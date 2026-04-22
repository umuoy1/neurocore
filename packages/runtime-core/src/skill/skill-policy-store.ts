import type { SkillPolicyState } from "@neurocore/protocol";

export interface SkillPolicyStateStore {
  save(state: SkillPolicyState): void;
  get(tenantId: string, skillId: string, contextKey?: string): SkillPolicyState | undefined;
  list(tenantId: string): SkillPolicyState[];
  deleteTenant(tenantId: string): void;
  close?(): void;
}
