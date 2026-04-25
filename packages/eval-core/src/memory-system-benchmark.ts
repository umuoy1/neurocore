import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type LongMemEvalBenchmarkMatrixReport,
  type LongMemEvalDatasetFile,
  type LongMemEvalGranularity,
  type LongMemEvalRetriever,
  runLongMemEvalBenchmarkMatrix
} from "./longmemeval.js";
import {
  evaluateMemoryObjectiveBenchmark,
  type MemoryObjectiveBenchmarkCase,
  type MemoryObjectiveBenchmarkReport
} from "./memory-objective-benchmark.js";
import {
  evaluateMemoryCausalRegression,
  type MemoryCausalRegressionCase,
  type MemoryCausalRegressionReport
} from "./memory-causal-regression.js";

export interface MemorySystemBenchmarkOptions {
  longMemEval?: {
    datasets: LongMemEvalDatasetFile[];
    retrieverFactory: (
      dataset: LongMemEvalDatasetFile,
      granularity: LongMemEvalGranularity
    ) => LongMemEvalRetriever;
    granularities?: LongMemEvalGranularity[];
    topK?: number;
  };
  objectiveCases?: MemoryObjectiveBenchmarkCase[];
  causalCases?: MemoryCausalRegressionCase[];
  createdAt?: string;
}

export interface MemorySystemBenchmarkReport {
  benchmark: "NeuroCoreMemorySystem";
  created_at: string;
  summary: {
    retrieval_score?: number;
    objective_score?: number;
    causal_score?: number;
    memory_score: number;
  };
  longmemeval?: LongMemEvalBenchmarkMatrixReport;
  objective?: MemoryObjectiveBenchmarkReport;
  causal?: MemoryCausalRegressionReport;
}

export async function runMemorySystemBenchmark(
  options: MemorySystemBenchmarkOptions
): Promise<MemorySystemBenchmarkReport> {
  const longmemeval = options.longMemEval
    ? await runLongMemEvalBenchmarkMatrix(
        options.longMemEval.datasets,
        options.longMemEval.retrieverFactory,
        {
          granularities: options.longMemEval.granularities,
          topK: options.longMemEval.topK
        }
      )
    : undefined;
  const objective = options.objectiveCases
    ? evaluateMemoryObjectiveBenchmark(options.objectiveCases)
    : undefined;
  const causal = options.causalCases
    ? evaluateMemoryCausalRegression(options.causalCases)
    : undefined;
  const retrievalScore = longmemeval ? scoreLongMemEval(longmemeval) : undefined;
  const summaryScores = [
    retrievalScore,
    objective?.objective_score,
    causal?.causal_score
  ].filter((value): value is number => typeof value === "number");

  return {
    benchmark: "NeuroCoreMemorySystem",
    created_at: options.createdAt ?? new Date().toISOString(),
    summary: {
      retrieval_score: retrievalScore,
      objective_score: objective?.objective_score,
      causal_score: causal?.causal_score,
      memory_score: average(summaryScores)
    },
    longmemeval,
    objective,
    causal
  };
}

export function writeMemorySystemBenchmarkReport(
  filename: string,
  report: MemorySystemBenchmarkReport
): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
}

function scoreLongMemEval(report: LongMemEvalBenchmarkMatrixReport): number {
  const values = report.runs.flatMap((run) => {
    if (run.granularity === "turn") {
      return [
        run.aggregate.turn_recall_at_k,
        run.aggregate.turn_mrr
      ].filter((value): value is number => typeof value === "number");
    }

    return [
      run.aggregate.session_recall_at_k,
      run.aggregate.session_mrr
    ];
  });

  return average(values);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
