import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  loadLongMemEvalDatasetBundle,
  NeuroCoreLongMemEvalRetriever,
  runMemorySystemBenchmark,
  writeMemorySystemBenchmarkReport
} from "@neurocore/eval-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replaceAll(":", "-");
const datasetTarget = resolve(
  process.cwd(),
  args.dataset ?? resolve(__dirname, "..", "tests", "fixtures", "longmemeval-sample.json")
);
const outputDir = resolve(
  process.cwd(),
  args.outputDir ?? join(".neurocore", "benchmarks", "memory", timestamp)
);
const output = resolve(
  process.cwd(),
  args.output ?? join(outputDir, "memory-system-benchmark.json")
);
const sqliteDir = resolve(process.cwd(), args.sqliteDir ?? join(outputDir, "sqlite"));
const topK = Number.parseInt(args.topK ?? "5", 10);
const requireFullBundle = args.requireFullBundle === true;
const datasets = loadLongMemEvalDatasetBundle(datasetTarget, { requireFullBundle });

const report = await runMemorySystemBenchmark({
  longMemEval: {
    datasets,
    topK,
    granularities: ["session", "turn"],
    retrieverFactory: (dataset, granularity) =>
      new NeuroCoreLongMemEvalRetriever({
        granularity,
        topK,
        sqliteFilename: join(sqliteDir, `${dataset.variant}-${granularity}.sqlite`),
        scopePrefix: `${dataset.variant}_${granularity}_${Date.now()}`
      })
  },
  objectiveCases: [
    {
      case_id: "objective_recall_governance",
      expected_episode_ids: ["epi_1", "epi_2"],
      recalled_episode_ids: ["epi_1", "epi_2"],
      expected_card_ids: ["card_1"],
      recalled_card_ids: ["card_1"],
      expected_skill_spec_ids: ["spec_1"],
      recalled_skill_spec_ids: ["spec_1"],
      disallowed_object_ids: ["memory_tombstoned"],
      returned_object_ids: ["epi_1", "epi_2", "card_1", "spec_1"]
    }
  ],
  causalCases: [
    {
      case_id: "causal_remove_episode_degrades",
      intervention: "remove_episode",
      baseline_score: 0.9,
      perturbed_score: 0.6,
      expected_direction: "degrade"
    },
    {
      case_id: "causal_promote_skill_improves",
      intervention: "promote_skill",
      baseline_score: 0.55,
      perturbed_score: 0.74,
      expected_direction: "improve"
    }
  ]
});

writeMemorySystemBenchmarkReport(output, report);

console.log(JSON.stringify({
  datasetTarget,
  output,
  sqliteDir,
  topK,
  requireFullBundle,
  summary: report.summary
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
    if (current === "--top-k" && next) {
      parsed.topK = next;
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
    }
  }

  return parsed;
}
