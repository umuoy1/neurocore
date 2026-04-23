import type { AutonomyPlanStore, AutonomousPlan } from "@neurocore/protocol";

export class InMemoryAutonomyPlanStore implements AutonomyPlanStore {
  private readonly plansBySession = new Map<string, AutonomousPlan[]>();

  public save(plan: AutonomousPlan): void {
    const plans = this.plansBySession.get(plan.session_id) ?? [];
    const nextPlans = plans.filter((candidate) => candidate.plan_id !== plan.plan_id);
    nextPlans.push(structuredClone(plan));
    this.plansBySession.set(plan.session_id, nextPlans);
  }

  public list(sessionId: string): AutonomousPlan[] {
    return structuredClone(this.plansBySession.get(sessionId) ?? []);
  }

  public deleteSession(sessionId: string): void {
    this.plansBySession.delete(sessionId);
  }
}
