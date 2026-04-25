import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadLongMemEvalDatasetBundle,
  NeuroCoreLongMemEvalRetriever
} from "@neurocore/eval-core";
import { loadOpenAICompatibleConfig } from "@neurocore/sdk-node";

const args = parseArgs(process.argv.slice(2));
const datasetTarget = resolve(
  process.cwd(),
  args.dataset
    ?? process.env.LONGMEMEVAL_DATASET_DIR
    ?? resolve("tests", "fixtures", "longmemeval-sample.json")
);
const modelConfigPath = resolve(process.cwd(), args.modelConfig ?? ".neurocore/llm.local.json");
const outputDir = resolve(
  process.cwd(),
  args.outputDir ?? join(".neurocore", "benchmarks", "longmemeval-hypotheses")
);
const sqliteDir = resolve(process.cwd(), args.sqliteDir ?? join(outputDir, "sqlite"));
const topK = Number.parseInt(args.topK ?? "8", 10);
const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
const startIndex = args.startIndex ? Number.parseInt(args.startIndex, 10) : 0;
const granularities = normalizeGranularities(args.granularity);
const config = await loadOpenAICompatibleConfig(modelConfigPath);
const extraBody = mergeExtraBody(config.extraBody, process.env.OPENAI_EXTRA_BODY_JSON);
const datasets = loadLongMemEvalDatasetBundle(datasetTarget, {
  requireFullBundle: args.requireFullBundle === true
});

mkdirSync(outputDir, { recursive: true });

const summary = [];

for (const granularity of granularities) {
  for (const dataset of datasets) {
    const retriever = new NeuroCoreLongMemEvalRetriever({
      granularity,
      topK,
      sqliteFilename: join(sqliteDir, `longmemeval-${granularity}.sqlite`),
      scopePrefix: `${dataset.variant}_${granularity}_${Date.now()}`
    });

    const predictions = [];
    const selectedInstances = dataset.instances.slice(
      startIndex,
      typeof limit === "number" ? startIndex + limit : undefined
    );
    const outputPath = join(outputDir, `${dataset.variant}-${granularity}-hypotheses.jsonl`);
    writeFileSync(outputPath, "");
    try {
      let index = 0;
      for (const instance of selectedInstances) {
        const retrieval = await retriever.retrieve(instance);
        const hypothesis = await generateHypothesis(config, instance, retrieval.hits);
        const prediction = {
          question_id: instance.question_id,
          hypothesis
        };
        predictions.push(prediction);
        appendFileSync(outputPath, `${JSON.stringify(prediction)}\n`);
        index += 1;
        if (index % 10 === 0 || index === selectedInstances.length) {
          console.log(JSON.stringify({
            dataset_variant: dataset.variant,
            granularity,
            completed: index,
            total: selectedInstances.length
          }));
        }
      }
    } finally {
      retriever.close();
    }

    summary.push({
      dataset_variant: dataset.variant,
      granularity,
      case_count: predictions.length,
      output_file: outputPath
    });
  }
}

writeFileSync(join(outputDir, "longmemeval-hypotheses-summary.json"), JSON.stringify(summary, null, 2));

console.log(JSON.stringify({
  datasetTarget,
  modelConfigPath,
  model: config.model,
  topK,
  limit,
  startIndex,
  granularities,
  outputDir,
  summary
}, null, 2));

async function generateHypothesis(config, instance, hits) {
  const url = config.apiUrl.endsWith("/")
    ? `${config.apiUrl}chat/completions`
    : `${config.apiUrl}/chat/completions`;
  const requestPayload = {
    ...extraBody,
    model: config.model,
    temperature: 0,
    max_tokens: 256,
    messages: [
      {
        role: "system",
        content:
          "You answer long-term memory benchmark questions using only the provided conversation evidence. If the evidence is insufficient, say that the information is unavailable. Keep the answer concise."
      },
      {
        role: "user",
        content: buildUserPrompt(instance, hits)
      }
    ]
  };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.bearerToken}`,
        ...(config.headers ?? {})
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(config.timeoutMs ?? 60_000)
    });

    if (response.ok) {
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        return content.trim();
      }
      if (Array.isArray(content)) {
        return content
          .map((part) => (part && typeof part.text === "string" ? part.text : ""))
          .join("")
          .trim();
      }
      throw new Error(`LongMemEval generation returned unsupported content shape for ${instance.question_id}.`);
    }

    const body = await response.text().catch(() => "");
    if (response.status === 429 && attempt < 5) {
      await sleep(Math.min(30_000, attempt * 5_000));
      continue;
    }
    throw new Error(`LongMemEval generation failed with ${response.status}: ${body.slice(0, 300)}`);
  }

  throw new Error(`LongMemEval generation exhausted retries for ${instance.question_id}.`);
}

function buildUserPrompt(instance, hits) {
  const evidence = hits.length === 0
    ? "No retrieved memory snippets."
    : hits.map((hit, index) => {
        const location = typeof hit.turn_index === "number"
          ? `session=${hit.session_id}, turn=${hit.turn_index}`
          : `session=${hit.session_id}`;
        return `Memory ${index + 1} (${location}):\n${hit.content}`;
      }).join("\n\n");

  return [
    `Question Date: ${instance.question_date}`,
    `Question Type: ${instance.question_type}`,
    `Question: ${instance.question}`,
    "",
    "Retrieved Memory:",
    evidence,
    "",
    "Answer the question using only the retrieved memory. If the answer cannot be determined, say that the information is unavailable."
  ].join("\n");
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
    if (current === "--output-dir" && next) {
      parsed.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--limit" && next) {
      parsed.limit = next;
      index += 1;
      continue;
    }
    if (current === "--start-index" && next) {
      parsed.startIndex = next;
      index += 1;
      continue;
    }
    if (current === "--sqlite-dir" && next) {
      parsed.sqliteDir = next;
      index += 1;
      continue;
    }
    if (current === "--model-config" && next) {
      parsed.modelConfig = next;
      index += 1;
      continue;
    }
    if (current === "--require-full-bundle") {
      parsed.requireFullBundle = true;
    }
  }

  return parsed;
}

function normalizeGranularities(value) {
  if (value === "both") {
    return ["session", "turn"];
  }
  if (value === "turn") {
    return ["turn"];
  }
  return ["session"];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeExtraBody(configExtraBody, envExtraBody) {
  const parsedEnv = parseJsonObject(envExtraBody);
  return {
    ...(configExtraBody ?? {}),
    ...(parsedEnv ?? {})
  };
}

function parseJsonObject(raw) {
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPENAI_EXTRA_BODY_JSON must be a JSON object.");
  }
  return parsed;
}
