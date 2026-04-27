export type BaselineAssertionSeverity = "blocker" | "major" | "minor";

export interface BaselineAssertionRecord {
  id: string;
  group: string;
  passed: boolean;
  severity: BaselineAssertionSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface BaselineVerdict {
  baseline_id: "PA-BL-001";
  status: "pass" | "fail";
  assertion_count: number;
  passed_count: number;
  failed_count: number;
  blocker_count: number;
  generated_at: string;
  assertions: BaselineAssertionRecord[];
}

export class BaselineVerdictBuilder {
  private readonly records: BaselineAssertionRecord[] = [];

  public assert(
    id: string,
    group: string,
    condition: unknown,
    message: string,
    severity: BaselineAssertionSeverity = "blocker",
    details?: Record<string, unknown>
  ): void {
    this.records.push({
      id,
      group,
      passed: Boolean(condition),
      severity,
      message,
      details
    });
  }

  public pass(
    id: string,
    group: string,
    message: string,
    severity: BaselineAssertionSeverity = "blocker",
    details?: Record<string, unknown>
  ): void {
    this.assert(id, group, true, message, severity, details);
  }

  public fail(
    id: string,
    group: string,
    message: string,
    severity: BaselineAssertionSeverity = "blocker",
    details?: Record<string, unknown>
  ): void {
    this.assert(id, group, false, message, severity, details);
  }

  public build(): BaselineVerdict {
    const failed = this.records.filter((record) => !record.passed);
    const blockers = failed.filter((record) => record.severity === "blocker");
    return {
      baseline_id: "PA-BL-001",
      status: failed.length === 0 ? "pass" : "fail",
      assertion_count: this.records.length,
      passed_count: this.records.length - failed.length,
      failed_count: failed.length,
      blocker_count: blockers.length,
      generated_at: new Date().toISOString(),
      assertions: this.records.map((record) => ({ ...record }))
    };
  }
}

export function includesText(value: unknown, pattern: string | RegExp): boolean {
  const text = typeof value === "string" ? value : "";
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

export function countPassed(verdict: BaselineVerdict): number {
  return verdict.assertions.filter((record) => record.passed).length;
}

export function countFailed(verdict: BaselineVerdict): number {
  return verdict.assertions.filter((record) => !record.passed).length;
}
