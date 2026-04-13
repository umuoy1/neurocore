import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOpenAICompatibleConfig } from "@neurocore/sdk-node";

const args = parseArgs(process.argv.slice(2));
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = args.repo
  ?? process.env.LONGMEMEVAL_REPO_DIR
  ?? resolve(__dirname, "..", "tools", "longmemeval-official");
const hypothesisFile = args.hypotheses;
const referenceFile = args.reference;
const modelConfigPath = resolve(process.cwd(), args.modelConfig ?? ".neurocore/llm.local.json");
const outputDir = resolve(
  process.cwd(),
  args.outputDir ?? join(".neurocore", "benchmarks", "longmemeval-official-qa")
);

if (!hypothesisFile) {
  throw new Error("Official LongMemEval QA eval requires --hypotheses.");
}

if (!referenceFile) {
  throw new Error("Official LongMemEval QA eval requires --reference.");
}

mkdirSync(outputDir, { recursive: true });

const resolvedRepoDir = resolve(process.cwd(), repoDir);
const resolvedHypothesisFile = resolve(process.cwd(), hypothesisFile);
const resolvedReferenceFile = resolve(process.cwd(), referenceFile);
const modelConfig = await loadModelConfig(modelConfigPath);
const metricModel = args.model ?? modelConfig?.model ?? "gpt-4o";
const resultFile = `${resolvedHypothesisFile}.eval-results-${metricModel}`;
const childEnv = {
  ...process.env
};

if (!childEnv.OPENAI_API_KEY && modelConfig?.bearerToken) {
  childEnv.OPENAI_API_KEY = modelConfig.bearerToken;
}
if (!childEnv.OPENAI_BASE_URL && modelConfig?.apiUrl) {
  childEnv.OPENAI_BASE_URL = modelConfig.apiUrl;
}

const evaluateOutput = execFileSync(
  "python3",
  [
    join(resolvedRepoDir, "src", "evaluation", "evaluate_qa.py"),
    metricModel,
    resolvedHypothesisFile,
    resolvedReferenceFile
  ],
  { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], env: childEnv }
);
writeFileSync(join(outputDir, "evaluate_qa.txt"), evaluateOutput);

const qaMetricsOutput = execFileSync(
  "python3",
  [
    join(resolvedRepoDir, "src", "evaluation", "print_qa_metrics.py"),
    resultFile,
    resolvedReferenceFile
  ],
  { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], env: childEnv }
);
writeFileSync(join(outputDir, "print_qa_metrics.txt"), qaMetricsOutput);

console.log(JSON.stringify({
  repoDir: resolvedRepoDir,
  hypothesisFile: resolvedHypothesisFile,
  referenceFile: resolvedReferenceFile,
  modelConfigPath,
  resultFile,
  metricModel,
  outputDir,
  evaluateOutput: evaluateOutput.trim(),
  qaMetricsOutput: qaMetricsOutput.trim()
}, null, 2));

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--repo" && next) {
      parsed.repo = next;
      index += 1;
      continue;
    }
    if (current === "--hypotheses" && next) {
      parsed.hypotheses = next;
      index += 1;
      continue;
    }
    if (current === "--reference" && next) {
      parsed.reference = next;
      index += 1;
      continue;
    }
    if (current === "--model" && next) {
      parsed.model = next;
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

async function loadModelConfig(filename) {
  try {
    return await loadOpenAICompatibleConfig(filename);
  } catch {
    return null;
  }
}
