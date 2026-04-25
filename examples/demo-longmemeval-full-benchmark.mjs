import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const dataset = args.dataset ?? process.env.LONGMEMEVAL_DATASET_DIR;

if (!dataset) {
  throw new Error("LongMemEval full benchmark requires --dataset or LONGMEMEVAL_DATASET_DIR.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
const outputDir = resolve(
  process.cwd(),
  args.outputDir ?? join(".neurocore", "benchmarks", "longmemeval", timestamp)
);
const topK = args.topK ?? "10";

execFileSync(
  process.execPath,
  [
    resolve(process.cwd(), "examples", "demo-longmemeval-stable-benchmark.mjs"),
    "--dataset",
    dataset,
    "--top-k",
    topK,
    "--output-dir",
    outputDir,
    "--granularity",
    "both"
  ],
  {
    stdio: "inherit"
  }
);

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
    if (current === "--output-dir" && next) {
      parsed.outputDir = next;
      index += 1;
      continue;
    }
  }

  return parsed;
}
