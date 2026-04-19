import type { ReflectionRule, ReflectionStore } from "@neurocore/protocol";

export class InMemoryReflectionStore implements ReflectionStore {
  private readonly rules = new Map<string, ReflectionRule>();

  public save(rule: ReflectionRule) {
    this.rules.set(rule.rule_id, structuredClone(rule));
  }

  public list(sessionId?: string) {
    const values = Array.from(this.rules.values());
    return values
      .filter((rule) => (sessionId ? rule.session_id === sessionId : true))
      .sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""));
  }

  public findByTaskBucket(taskBucket: string, riskLevel?: string) {
    return this.list().filter((rule) => {
      if (rule.task_bucket !== taskBucket) {
        return false;
      }
      if (riskLevel && rule.risk_level && rule.risk_level !== riskLevel) {
        return false;
      }
      return true;
    });
  }

  public deleteSession(sessionId: string) {
    for (const [ruleId, rule] of this.rules.entries()) {
      if (rule.session_id === sessionId) {
        this.rules.delete(ruleId);
      }
    }
  }
}
