import type { EvalRunReport } from "./types.js";

export interface CaseComparison {
  case_id: string;
  a_passed: boolean;
  b_passed: boolean;
  a_score: number;
  b_score: number;
}

export interface EvalComparison {
  run_a_id: string;
  run_b_id: string;
  pass_rate_delta: number;
  average_score_delta: number;
  regressions: CaseComparison[];
  improvements: CaseComparison[];
  unchanged: CaseComparison[];
}

export function compareEvalRuns(a: EvalRunReport, b: EvalRunReport): EvalComparison {
  const aMap = new Map(a.results.map((r) => [r.case_id, r]));
  const bMap = new Map(b.results.map((r) => [r.case_id, r]));

  const overlappingIds = [...aMap.keys()].filter((id) => bMap.has(id));

  const regressions: CaseComparison[] = [];
  const improvements: CaseComparison[] = [];
  const unchanged: CaseComparison[] = [];

  for (const caseId of overlappingIds) {
    const aResult = aMap.get(caseId)!;
    const bResult = bMap.get(caseId)!;

    const comparison: CaseComparison = {
      case_id: caseId,
      a_passed: aResult.passed,
      b_passed: bResult.passed,
      a_score: aResult.score,
      b_score: bResult.score
    };

    if (aResult.passed && !bResult.passed) {
      regressions.push(comparison);
    } else if (!aResult.passed && bResult.passed) {
      improvements.push(comparison);
    } else {
      unchanged.push(comparison);
    }
  }

  return {
    run_a_id: a.run_id,
    run_b_id: b.run_id,
    pass_rate_delta: b.pass_rate - a.pass_rate,
    average_score_delta: b.average_score - a.average_score,
    regressions,
    improvements,
    unchanged
  };
}
