import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLongMemEvalDatasetBundle,
  NeuroCoreLongMemEvalRetriever,
  runLongMemEvalBenchmarkMatrix,
  runLongMemEvalBenchmarkSuite,
  toLongMemEvalOfficialRetrievalLog,
  writeLongMemEvalBenchmarkReport,
  writeLongMemEvalOfficialRetrievalLog
} from "@neurocore/eval-core";

const args = parseArgs(process.argv.slice(2));
const datasetTarget = args.dataset ?? process.env.LONGMEMEVAL_DATASET_DIR;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = args.repo
  ?? process.env.LONGMEMEVAL_REPO_DIR
  ?? resolve(__dirname, "..", "tools", "longmemeval-official");

if (!datasetTarget) {
  throw new Error("Official LongMemEval retrieval run requires --dataset or LONGMEMEVAL_DATASET_DIR.");
}

const resolvedDatasetTarget = resolve(process.cwd(), datasetTarget);
const resolvedRepoDir = resolve(process.cwd(), repoDir);
const outputDir = resolve(
  process.cwd(),
  args.outputDir ?? join(".neurocore", "benchmarks", "longmemeval-official")
);
const sqliteDir = resolve(process.cwd(), args.sqliteDir ?? join(outputDir, "sqlite"));
const topK = Number.parseInt(args.topK ?? "10", 10);
const granularity = normalizeGranularity(args.granularity);
const datasets = loadLongMemEvalDatasetBundle(resolvedDatasetTarget, { requireFullBundle: true });
const datasetByVariant = new Map(datasets.map((dataset) => [dataset.variant, dataset]));

mkdirSync(outputDir, { recursive: true });

if (granularity === "both") {
  const matrix = await runLongMemEvalBenchmarkMatrix(
    datasets,
    (dataset, currentGranularity) =>
      new NeuroCoreLongMemEvalRetriever({
        granularity: currentGranularity,
        topK,
        sqliteFilename: join(sqliteDir, `longmemeval-${currentGranularity}.sqlite`),
        scopePrefix: `${dataset.variant}_${currentGranularity}_${Date.now()}`
      }),
    {
      granularities: ["session", "turn"],
      topK
    }
  );

  writeLongMemEvalBenchmarkReport(join(outputDir, "longmemeval-matrix.json"), matrix);

  const officialMetrics = [];
  for (const run of matrix.runs) {
    writeLongMemEvalBenchmarkReport(join(outputDir, `longmemeval-${run.granularity}-suite.json`), run.suite);
    for (const report of run.suite.reports) {
      const dataset = report.dataset_variant ? datasetByVariant.get(report.dataset_variant) : undefined;
      if (!dataset) {
        throw new Error(`Missing dataset definition for ${report.dataset_variant ?? "unknown"}.`);
      }

      const logPath = join(
        outputDir,
        `${report.dataset_variant}-${run.granularity}-retrievallog-neurocore.jsonl`
      );
      writeLongMemEvalOfficialRetrievalLog(
        logPath,
        toLongMemEvalOfficialRetrievalLog(dataset.instances, report)
      );

      const metricsOutput = execFileSync(
        "python3",
        [join(resolvedRepoDir, "src", "evaluation", "print_retrieval_metrics.py"), logPath],
        { encoding: "utf8" }
      );
      writeFileSync(
        join(outputDir, `${report.dataset_variant}-${run.granularity}-official-metrics.txt`),
        metricsOutput
      );
      officialMetrics.push({
        dataset_variant: report.dataset_variant,
        granularity: run.granularity,
        metrics: metricsOutput.trim()
      });
    }
  }

  writeFileSync(join(outputDir, "longmemeval-official-metrics.json"), JSON.stringify(officialMetrics, null, 2));

  console.log(JSON.stringify({
    datasetTarget: resolvedDatasetTarget,
    repoDir: resolvedRepoDir,
    outputDir,
    datasetCount: datasets.length,
    granularity,
    topK,
    officialMetrics
  }, null, 2));
} else {
  const suite = await runLongMemEvalBenchmarkSuite(
    datasets,
    (dataset) =>
      new NeuroCoreLongMemEvalRetriever({
        granularity,
        topK,
        sqliteFilename: join(sqliteDir, `longmemeval-${granularity}.sqlite`),
        scopePrefix: `${dataset.variant}_${granularity}_${Date.now()}`
      }),
    {
      granularity,
      topK
    }
  );

  writeLongMemEvalBenchmarkReport(join(outputDir, `longmemeval-${granularity}-suite.json`), suite);

  const officialMetrics = suite.reports.map((report) => {
    const dataset = report.dataset_variant ? datasetByVariant.get(report.dataset_variant) : undefined;
    if (!dataset) {
      throw new Error(`Missing dataset definition for ${report.dataset_variant ?? "unknown"}.`);
    }

    const logPath = join(
      outputDir,
      `${report.dataset_variant}-${granularity}-retrievallog-neurocore.jsonl`
    );
    writeLongMemEvalOfficialRetrievalLog(
      logPath,
      toLongMemEvalOfficialRetrievalLog(dataset.instances, report)
    );

    const metricsOutput = execFileSync(
      "python3",
      [join(resolvedRepoDir, "src", "evaluation", "print_retrieval_metrics.py"), logPath],
      { encoding: "utf8" }
    );
    writeFileSync(
      join(outputDir, `${report.dataset_variant}-${granularity}-official-metrics.txt`),
      metricsOutput
    );
    return {
      dataset_variant: report.dataset_variant,
      granularity,
      metrics: metricsOutput.trim()
    };
  });

  writeFileSync(join(outputDir, "longmemeval-official-metrics.json"), JSON.stringify(officialMetrics, null, 2));

  console.log(JSON.stringify({
    datasetTarget: resolvedDatasetTarget,
    repoDir: resolvedRepoDir,
    outputDir,
    datasetCount: datasets.length,
    granularity,
    topK,
    officialMetrics
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
    if (current === "--repo" && next) {
      parsed.repo = next;
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
    if (current === "--output-dir" && next) {
      parsed.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--sqlite-dir" && next) {
      parsed.sqliteDir = next;
      index += 1;
      continue;
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
