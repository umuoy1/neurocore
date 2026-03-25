import type { AgentSessionHandle } from "@neurocore/sdk-core";
import type { EvalCase, EvalCaseResult, EvalObservedResult, EvalRunReport } from "./types.js";

export interface EvalExecutor {
  execute(testCase: EvalCase): Promise<EvalObservedResult>;
}

export class EvalRunner {
  public constructor(private readonly executor: EvalExecutor) {}

  public async run(cases: EvalCase[]): Promise<EvalRunReport> {
    const startedAt = new Date().toISOString();
    const results: EvalCaseResult[] = [];

    for (const testCase of cases) {
      const observed = await this.executor.execute(testCase);
      results.push(evaluateCase(testCase, observed));
    }

    const endedAt = new Date().toISOString();
    const passCount = results.filter((result) => result.passed).length;
    const averageScore =
      results.length === 0
        ? 1
        : results.reduce((sum, result) => sum + result.score, 0) / results.length;

    return {
      run_id: `evr_${Date.now()}`,
      started_at: startedAt,
      ended_at: endedAt,
      case_count: results.length,
      pass_count: passCount,
      pass_rate: results.length === 0 ? 1 : passCount / results.length,
      average_score: averageScore,
      results
    };
  }
}

export function createSessionExecutor(
  factory: (testCase: EvalCase) => AgentSessionHandle
): EvalExecutor {
  return {
    async execute(testCase: EvalCase): Promise<EvalObservedResult> {
      const session = factory(testCase);
      const result = await session.run();
      const replay = session.replay();
      const toolSequence = result.steps
        .map((step) => step.selectedAction?.tool_name)
        .filter((toolName): toolName is string => typeof toolName === "string");
      const executedToolSequence = replay.traces
        .map((record) =>
          record.action_execution && typeof record.selected_action?.tool_name === "string"
            ? record.selected_action.tool_name
            : undefined
        )
        .filter((toolName): toolName is string => typeof toolName === "string");

      return {
        session_id: result.sessionId,
        final_state: result.finalState,
        step_count: result.steps.length,
        output_text: result.outputText,
        tool_sequence: toolSequence,
        executed_tool_sequence: executedToolSequence,
        replay
      };
    }
  };
}

function evaluateCase(testCase: EvalCase, observed: EvalObservedResult): EvalCaseResult {
  const failures: string[] = [];
  const checks = testCase.expectations ? buildChecks(testCase, observed) : [];
  for (const check of checks) {
    if (!check.passed) {
      failures.push(check.failure);
    }
  }

  const score =
    checks.length === 0 ? 1 : checks.filter((check) => check.passed).length / checks.length;

  return {
    case_id: testCase.case_id,
    description: testCase.description,
    passed: failures.length === 0,
    score,
    failures,
    observed
  };
}

function buildChecks(testCase: EvalCase, observed: EvalObservedResult) {
  const expectations = testCase.expectations;
  if (!expectations) {
    return [];
  }

  const checks: Array<{ passed: boolean; failure: string }> = [];

  if (expectations.final_state) {
    checks.push({
      passed: observed.final_state === expectations.final_state,
      failure: `Expected final_state=${expectations.final_state}, got ${observed.final_state}.`
    });
  }

  if (typeof expectations.min_steps === "number") {
    checks.push({
      passed: observed.step_count >= expectations.min_steps,
      failure: `Expected step_count >= ${expectations.min_steps}, got ${observed.step_count}.`
    });
  }

  if (typeof expectations.max_steps === "number") {
    checks.push({
      passed: observed.step_count <= expectations.max_steps,
      failure: `Expected step_count <= ${expectations.max_steps}, got ${observed.step_count}.`
    });
  }

  for (const fragment of expectations.output_includes ?? []) {
    checks.push({
      passed: (observed.output_text ?? "").includes(fragment),
      failure: `Expected output to include "${fragment}".`
    });
  }

  if (expectations.tool_sequence) {
    checks.push({
      passed: sameSequence(observed.tool_sequence, expectations.tool_sequence),
      failure: `Expected tool sequence ${JSON.stringify(expectations.tool_sequence)}, got ${JSON.stringify(observed.tool_sequence)}.`
    });
  }

  if (expectations.executed_tool_sequence) {
    checks.push({
      passed: sameSequence(observed.executed_tool_sequence, expectations.executed_tool_sequence),
      failure: `Expected executed tool sequence ${JSON.stringify(expectations.executed_tool_sequence)}, got ${JSON.stringify(observed.executed_tool_sequence)}.`
    });
  }

  if (typeof expectations.requires_approval === "boolean") {
    const actual = observed.final_state === "escalated";
    checks.push({
      passed: actual === expectations.requires_approval,
      failure: `Expected requires_approval=${expectations.requires_approval}, got ${actual}.`
    });
  }

  return checks;
}

function sameSequence(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
