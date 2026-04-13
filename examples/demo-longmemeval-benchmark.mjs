import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateLongMemEvalReports,
  loadLongMemEvalDatasetBundle,
  NeuroCoreLongMemEvalRetriever,
  runLongMemEvalBenchmarkMatrix,
  runLongMemEvalBenchmarkSuite,
  writeLongMemEvalBenchmarkReport
} from "@neurocore/eval-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

const datasetTarget = resolve(
  process.cwd(),
  args.dataset
    ?? resolve(__dirname, "..", "tests", "fixtures", "longmemeval-sample.json")
);
const granularity = normalizeGranularity(args.granularity);
const topK = Number.parseInt(args.topK ?? "5", 10);
const outputFilename = args.output ? resolve(process.cwd(), args.output) : undefined;
const outputDir = args.outputDir ? resolve(process.cwd(), args.outputDir) : undefined;
const sqliteFilename = args.sqlite ? resolve(process.cwd(), args.sqlite) : undefined;
const sqliteDir = args.sqliteDir ? resolve(process.cwd(), args.sqliteDir) : undefined;
const requireFullBundle = args.requireFullBundle === true;

const datasets = loadLongMemEvalDatasetBundle(datasetTarget, { requireFullBundle });

if (granularity === "both") {
  const matrix = await runLongMemEvalBenchmarkMatrix(
    datasets,
    (dataset, currentGranularity) =>
      new NeuroCoreLongMemEvalRetriever({
        granularity: currentGranularity,
        topK,
        sqliteFilename: resolveSqliteFilename({
          sqliteFilename,
          sqliteDir,
          granularity: currentGranularity,
          useGranularitySuffix: true
        }),
        scopePrefix: `${dataset.variant}_${currentGranularity}_${Date.now()}`
      }),
    {
      granularities: ["session", "turn"],
      topK
    }
  );

  if (outputDir) {
    writeLongMemEvalBenchmarkReport(join(outputDir, "longmemeval-matrix.json"), matrix);
    for (const run of matrix.runs) {
      writeLongMemEvalBenchmarkReport(join(outputDir, `longmemeval-${run.granularity}-suite.json`), run.suite);
      writeLongMemEvalBenchmarkReport(join(outputDir, `longmemeval-${run.granularity}-aggregate.json`), run.aggregate);
    }
  }

  if (outputFilename) {
    writeLongMemEvalBenchmarkReport(outputFilename, matrix);
  }

  console.log(JSON.stringify({
    datasetTarget,
    datasetCount: datasets.length,
    granularity,
    topK,
    requireFullBundle,
    sqliteFilename,
    sqliteDir,
    outputFilename,
    outputDir,
    runs: matrix.runs.map((run) => ({
      granularity: run.granularity,
      datasetCount: run.aggregate.dataset_count,
      caseCount: run.aggregate.case_count,
      nonAbstentionCount: run.aggregate.non_abstention_count,
      abstentionCount: run.aggregate.abstention_count,
      sessionRecallAtK: run.aggregate.session_recall_at_k,
      sessionMrr: run.aggregate.session_mrr,
      turnRecallAtK: run.aggregate.turn_recall_at_k,
      turnMrr: run.aggregate.turn_mrr
    }))
  }, null, 2));
} else {
  const suite = await runLongMemEvalBenchmarkSuite(
    datasets,
    (dataset) =>
      new NeuroCoreLongMemEvalRetriever({
        granularity,
        topK,
        sqliteFilename: resolveSqliteFilename({
          sqliteFilename,
          sqliteDir,
          granularity,
          useGranularitySuffix: false
        }),
        scopePrefix: `${dataset.variant}_${granularity}_${Date.now()}`
      }),
    {
      granularity,
      topK
    }
  );
  const aggregate = aggregateLongMemEvalReports(suite.reports, { granularity, topK });

  if (outputDir) {
    writeLongMemEvalBenchmarkReport(join(outputDir, `longmemeval-${granularity}-suite.json`), suite);
    writeLongMemEvalBenchmarkReport(join(outputDir, `longmemeval-${granularity}-aggregate.json`), aggregate);
  }

  if (outputFilename) {
    writeLongMemEvalBenchmarkReport(outputFilename, suite);
  }

  console.log(JSON.stringify({
    datasetTarget,
    datasetCount: datasets.length,
    granularity,
    topK,
    requireFullBundle,
    sqliteFilename,
    sqliteDir,
    outputFilename,
    outputDir,
    aggregate: {
      datasetCount: aggregate.dataset_count,
      caseCount: aggregate.case_count,
      nonAbstentionCount: aggregate.non_abstention_count,
      abstentionCount: aggregate.abstention_count,
      sessionRecallAtK: aggregate.session_recall_at_k,
      sessionMrr: aggregate.session_mrr,
      turnRecallAtK: aggregate.turn_recall_at_k,
      turnMrr: aggregate.turn_mrr
    },
    reports: suite.reports.map((report) => ({
      variant: report.dataset_variant,
      sourceFile: report.source_file,
      caseCount: report.case_count,
      nonAbstentionCount: report.non_abstention_count,
      abstentionCount: report.abstention_count,
      sessionRecallAtK: report.session_recall_at_k,
      sessionMrr: report.session_mrr,
      turnRecallAtK: report.turn_recall_at_k,
      turnMrr: report.turn_mrr
    }))
  }, null, 2));
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--dataset" && next) {
      parsed.dataset = next;
      index += 1;
      continue;
    }
    if (current === "--granularity" && next) {
      parsed.granularity = next;
      index += 1;
      continue;
    }
    if (current === "--top-k" && next) {
      parsed.topK = next;
      index += 1;
      continue;
    }
    if (current === "--sqlite" && next) {
      parsed.sqlite = next;
      index += 1;
      continue;
    }
    if (current === "--sqlite-dir" && next) {
      parsed.sqliteDir = next;
      index += 1;
      continue;
    }
    if (current === "--output" && next) {
      parsed.output = next;
      index += 1;
      continue;
    }
    if (current === "--output-dir" && next) {
      parsed.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--require-full-bundle") {
      parsed.requireFullBundle = true;
      continue;
    }

    if (!current.startsWith("--") && !parsed.dataset) {
      parsed.dataset = current;
    } else if (!current.startsWith("--") && !parsed.granularity) {
      parsed.granularity = current;
    } else if (!current.startsWith("--") && !parsed.topK) {
      parsed.topK = current;
    } else if (!current.startsWith("--") && !parsed.sqlite) {
      parsed.sqlite = current;
    } else if (!current.startsWith("--") && !parsed.output) {
      parsed.output = current;
    }
  }

  return parsed;
}

function normalizeGranularity(value) {
  if (value === "turn") {
    return "turn";
  }
  if (value === "both") {
    return "both";
  }
  return "session";
}

function resolveSqliteFilename(input) {
  if (input.sqliteDir) {
    return join(input.sqliteDir, `longmemeval-${input.granularity}.sqlite`);
  }
  if (!input.sqliteFilename) {
    return undefined;
  }
  if (input.useGranularitySuffix) {
    return appendGranularityToFilename(input.sqliteFilename, input.granularity);
  }
  return input.sqliteFilename;
}

function appendGranularityToFilename(filename, granularity) {
  const extension = extname(filename);
  if (!extension) {
    return `${filename}-${granularity}`;
  }
  const base = filename.slice(0, -extension.length);
  return `${base}-${granularity}${extension}`;
}
