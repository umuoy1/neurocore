import type { AutonomyHealthStore, HealthReport } from "@neurocore/protocol";

export class InMemoryAutonomyHealthStore implements AutonomyHealthStore {
  private readonly reportsBySession = new Map<string, HealthReport[]>();

  public append(report: HealthReport): void {
    const reports = this.reportsBySession.get(report.session_id) ?? [];
    reports.push(structuredClone(report));
    this.reportsBySession.set(report.session_id, reports);
  }

  public list(sessionId: string): HealthReport[] {
    return structuredClone(this.reportsBySession.get(sessionId) ?? []);
  }

  public deleteSession(sessionId: string): void {
    this.reportsBySession.delete(sessionId);
  }
}
