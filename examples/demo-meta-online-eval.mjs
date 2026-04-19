import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  evaluateOnlineMetaEvalRun,
  formatCoverageAccuracyCurve,
  formatMetaBenchmarkSummary,
  formatRiskConditionedCurves
} from "@neurocore/eval-core";

async function main() {
  const [casesPath, reportPath, outDirArg] = process.argv.slice(2);
  if (!casesPath || !reportPath) {
    throw new Error("Usage: node examples/demo-meta-online-eval.mjs <meta-cases.json> <eval-run-report.json> [out-dir]");
  }

  const cases = JSON.parse(await readFile(resolve(casesPath), "utf8"));
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  const outDir = resolve(outDirArg ?? ".neurocore/benchmarks/meta-online");
  await mkdir(outDir, { recursive: true });

  const artifacts = evaluateOnlineMetaEvalRun(cases, report);
  await writeFile(resolve(outDir, "meta-online-bundle.json"), JSON.stringify(artifacts.bundle, null, 2));
  await writeFile(resolve(outDir, "meta-online-report.json"), JSON.stringify(artifacts.report, null, 2));
  await writeFile(resolve(outDir, "meta-online-summary.json"), JSON.stringify(artifacts.summary, null, 2));
  await writeFile(
    resolve(outDir, "meta-online-curves.json"),
    JSON.stringify(
      {
        coverage_accuracy_curve: artifacts.coverage_accuracy_curve,
        risk_conditioned_curves: artifacts.risk_conditioned_curves
      },
      null,
      2
    )
  );
  await writeFile(resolve(outDir, "meta-online-summary.txt"), formatMetaBenchmarkSummary(artifacts.summary));
  await writeFile(
    resolve(outDir, "meta-online-curves.txt"),
    `${formatCoverageAccuracyCurve(artifacts.coverage_accuracy_curve)}\n\n${formatRiskConditionedCurves(artifacts.risk_conditioned_curves)}`
  );

  process.stdout.write(`${formatMetaBenchmarkSummary(artifacts.summary)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
