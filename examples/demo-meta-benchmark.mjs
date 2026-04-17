import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMetaBenchmarkArtifacts,
  formatMetaBenchmarkSummary
} from "@neurocore/eval-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultBundlePath = resolve(__dirname, "..", "tests", "fixtures", "meta-benchmark-suite.json");
const defaultOutputDir = resolve(process.cwd(), ".neurocore", "benchmarks", "meta");

async function main() {
  const [bundlePathArg, outputDirArg] = process.argv.slice(2);
  const bundlePath = bundlePathArg ? resolve(process.cwd(), bundlePathArg) : defaultBundlePath;
  const outputDir = outputDirArg ? resolve(process.cwd(), outputDirArg) : defaultOutputDir;
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const artifacts = buildMetaBenchmarkArtifacts(bundle);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "meta-benchmark-report.json"), JSON.stringify(artifacts.report, null, 2));
  await writeFile(resolve(outputDir, "meta-benchmark-summary.json"), JSON.stringify(artifacts.summary, null, 2));
  const summaryText = formatMetaBenchmarkSummary(artifacts.summary);
  await writeFile(resolve(outputDir, "meta-benchmark-summary.txt"), `${summaryText}\n`);
  process.stdout.write(`${summaryText}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
