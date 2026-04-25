import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replaceAll(":", "-");
const datasetDir = resolve(process.cwd(), args.dataset ?? process.env.LONGMEMEVAL_DATASET_DIR ?? "data");
const outputDir = resolve(
  process.cwd(),
  args.outputDir ?? join(".neurocore", "benchmarks", "longmemeval-stable", timestamp)
);
const preparedDir = resolve(process.cwd(), args.preparedDir ?? join(outputDir, "prepared"));
const shardSize = Number.parseInt(args.shardSize ?? "50", 10);
const maxCasesPerVariant = args.maxCasesPerVariant ? Number.parseInt(args.maxCasesPerVariant, 10) : undefined;
const topK = args.topK ?? "10";
const granularity = args.granularity ?? "both";
const startShard = Number.parseInt(args.startShard ?? "0", 10);
const limitShards = args.limitShards ? Number.parseInt(args.limitShards, 10) : undefined;
const officialRetrieval = args.officialRetrieval === true;
const prepareOnly = args.prepareOnly === true;
const resume = args.resume === true;

mkdirSync(outputDir, { recursive: true });

const prepareArgs = [
  resolve(process.cwd(), "tools", "longmemeval-prepare-bundle.py"),
  "--dataset",
  datasetDir,
  "--output-dir",
  preparedDir,
  "--shard-size",
  String(shardSize)
];
if (maxCasesPerVariant !== undefined) {
  prepareArgs.push("--max-cases-per-variant", String(maxCasesPerVariant));
}
if (args.clean === true) {
  prepareArgs.push("--clean");
}

if (!existsSync(join(preparedDir, "manifest.json")) || args.skipPrepare !== true) {
  execFileSync("python3", prepareArgs, { stdio: "inherit" });
}

const manifestPath = join(preparedDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (prepareOnly) {
  console.log(JSON.stringify({ manifestPath, outputDir }, null, 2));
  process.exit(0);
}

const selectedShards = manifest.shards
  .filter((shard) => shard.complete === true)
  .slice(startShard, limitShards === undefined ? undefined : startShard + limitShards);
const shardRuns = [];

for (const shard of selectedShards) {
  const shardOutputDir = join(outputDir, `shard-${String(shard.shard_index).padStart(5, "0")}`);
  const matrixPath = join(shardOutputDir, "longmemeval-matrix.json");
  if (resume && existsSync(matrixPath)) {
    shardRuns.push({
      shard_index: shard.shard_index,
      dataset: shard.path,
      output_dir: shardOutputDir,
      matrix: matrixPath,
      skipped: true
    });
    continue;
  }

  mkdirSync(shardOutputDir, { recursive: true });
  const script = officialRetrieval
    ? "examples/demo-longmemeval-official-retrieval.mjs"
    : "examples/demo-longmemeval-benchmark.mjs";
  const childArgs = [
    resolve(process.cwd(), script),
    "--dataset",
    shard.path,
    "--granularity",
    granularity,
    "--top-k",
    topK,
    "--require-full-bundle",
    "--sqlite-dir",
    join(shardOutputDir, "sqlite"),
    "--output-dir",
    shardOutputDir
  ];
  if (!officialRetrieval) {
    childArgs.push("--output", matrixPath);
  }
  execFileSync(process.execPath, childArgs, { stdio: "inherit" });
  shardRuns.push({
    shard_index: shard.shard_index,
    dataset: shard.path,
    output_dir: shardOutputDir,
    matrix: matrixPath,
    skipped: false
  });
}

const matrices = shardRuns
  .map((run) => run.matrix)
  .filter((matrix) => existsSync(matrix))
  .map((matrix) => JSON.parse(readFileSync(matrix, "utf8")));
const combined = combineMatrices(matrices);
const runReport = {
  benchmark: "LongMemEvalStable",
  created_at: new Date().toISOString(),
  dataset_dir: datasetDir,
  manifest_path: manifestPath,
  output_dir: outputDir,
  shard_size: shardSize,
  max_cases_per_variant: maxCasesPerVariant,
  start_shard: startShard,
  limit_shards: limitShards,
  selected_shard_count: selectedShards.length,
  top_k: Number.parseInt(topK, 10),
  granularity,
  official_retrieval: officialRetrieval,
  shard_runs: shardRuns,
  combined
};
const runReportPath = join(outputDir, "stable-run.json");
writeFileSync(runReportPath, JSON.stringify(runReport, null, 2) + "\n");
console.log(JSON.stringify({
  outputDir,
  manifestPath,
  runReportPath,
  selectedShardCount: selectedShards.length,
  combined
}, null, 2));

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
    if (current === "--output-dir" && next) {
      parsed.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--prepared-dir" && next) {
      parsed.preparedDir = next;
      index += 1;
      continue;
    }
    if (current === "--shard-size" && next) {
      parsed.shardSize = next;
      index += 1;
      continue;
    }
    if (current === "--max-cases-per-variant" && next) {
      parsed.maxCasesPerVariant = next;
      index += 1;
      continue;
    }
    if (current === "--top-k" && next) {
      parsed.topK = next;
      index += 1;
      continue;
    }
    if (current === "--granularity" && next) {
      parsed.granularity = next;
      index += 1;
      continue;
    }
    if (current === "--start-shard" && next) {
      parsed.startShard = next;
      index += 1;
      continue;
    }
    if (current === "--limit-shards" && next) {
      parsed.limitShards = next;
      index += 1;
      continue;
    }
    if (current === "--official-retrieval") {
      parsed.officialRetrieval = true;
      continue;
    }
    if (current === "--prepare-only") {
      parsed.prepareOnly = true;
      continue;
    }
    if (current === "--skip-prepare") {
      parsed.skipPrepare = true;
      continue;
    }
    if (current === "--clean") {
      parsed.clean = true;
      continue;
    }
    if (current === "--resume") {
      parsed.resume = true;
    }
  }
  return parsed;
}

function combineMatrices(matrices) {
  const byGranularity = new Map();
  for (const matrix of matrices) {
    for (const run of matrix.runs ?? []) {
      const current = byGranularity.get(run.granularity) ?? {
        granularity: run.granularity,
        case_count: 0,
        dataset_count: 0,
        dataset_variants: new Set(),
        session_recall_at_k: 0,
        session_mrr: 0,
        turn_recall_at_k: 0,
        turn_mrr: 0,
        question_type_metrics: new Map()
      };
      const aggregate = run.aggregate;
      const weight = aggregate.case_count ?? 0;
      current.case_count += weight;
      current.dataset_count += aggregate.dataset_count ?? 0;
      for (const variant of aggregate.dataset_variants ?? []) {
        current.dataset_variants.add(variant);
      }
      addWeighted(current, "session_recall_at_k", aggregate.session_recall_at_k, weight);
      addWeighted(current, "session_mrr", aggregate.session_mrr, weight);
      addWeighted(current, "turn_recall_at_k", aggregate.turn_recall_at_k, weight);
      addWeighted(current, "turn_mrr", aggregate.turn_mrr, weight);
      for (const [questionType, metrics] of Object.entries(aggregate.question_type_metrics ?? {})) {
        const existing = current.question_type_metrics.get(questionType) ?? {
          question_type: questionType,
          case_count: 0,
          session_recall_at_k: 0,
          session_mrr: 0,
          turn_recall_at_k: 0,
          turn_mrr: 0
        };
        const metricWeight = metrics.case_count ?? 0;
        existing.case_count += metricWeight;
        addWeighted(existing, "session_recall_at_k", metrics.session_recall_at_k, metricWeight);
        addWeighted(existing, "session_mrr", metrics.session_mrr, metricWeight);
        addWeighted(existing, "turn_recall_at_k", metrics.turn_recall_at_k, metricWeight);
        addWeighted(existing, "turn_mrr", metrics.turn_mrr, metricWeight);
        current.question_type_metrics.set(questionType, existing);
      }
      byGranularity.set(run.granularity, current);
    }
  }

  return Array.from(byGranularity.values()).map((entry) => ({
    granularity: entry.granularity,
    case_count: entry.case_count,
    dataset_count: entry.dataset_count,
    dataset_variants: Array.from(entry.dataset_variants).sort(),
    session_recall_at_k: finalizeWeighted(entry, "session_recall_at_k"),
    session_mrr: finalizeWeighted(entry, "session_mrr"),
    turn_recall_at_k: finalizeWeighted(entry, "turn_recall_at_k"),
    turn_mrr: finalizeWeighted(entry, "turn_mrr"),
    question_type_metrics: Object.fromEntries(
      Array.from(entry.question_type_metrics.entries()).map(([key, value]) => [
        key,
        {
          question_type: value.question_type,
          case_count: value.case_count,
          session_recall_at_k: finalizeWeighted(value, "session_recall_at_k"),
          session_mrr: finalizeWeighted(value, "session_mrr"),
          turn_recall_at_k: finalizeWeighted(value, "turn_recall_at_k"),
          turn_mrr: finalizeWeighted(value, "turn_mrr")
        }
      ])
    )
  }));
}

function addWeighted(target, key, value, weight) {
  if (typeof value !== "number" || weight <= 0) {
    return;
  }
  target[key] += value * weight;
}

function finalizeWeighted(target, key) {
  if (target.case_count <= 0) {
    return 0;
  }
  return target[key] / target.case_count;
}
