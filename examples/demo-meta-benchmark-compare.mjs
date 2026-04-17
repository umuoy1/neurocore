import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  compareMetaBenchmarkSummaries,
  formatMetaBenchmarkComparison
} from "@neurocore/eval-core";

async function main() {
  const [baselinePathArg, candidatePathArg] = process.argv.slice(2);
  if (!baselinePathArg || !candidatePathArg) {
    throw new Error("usage: node examples/demo-meta-benchmark-compare.mjs <baseline-summary.json> <candidate-summary.json>");
  }
  const baseline = JSON.parse(await readFile(resolve(process.cwd(), baselinePathArg), "utf8"));
  const candidate = JSON.parse(await readFile(resolve(process.cwd(), candidatePathArg), "utf8"));
  const diff = compareMetaBenchmarkSummaries(baseline, candidate);
  process.stdout.write(`${formatMetaBenchmarkComparison(diff)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
