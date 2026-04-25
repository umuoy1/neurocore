import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  aggregateLongMemEvalReports,
  loadLongMemEvalDatasetBundle,
  NeuroCoreLongMemEvalRetriever,
  loadLongMemEvalDataset,
  parseLongMemEvalDataset,
  runLongMemEvalBenchmark,
  runLongMemEvalBenchmarkMatrix,
  runLongMemEvalBenchmarkSuite,
  toLongMemEvalOfficialRetrievalLog,
  toLongMemEvalOfficialRetrievalLogJsonl,
  toLongMemEvalPredictionsJsonl,
  writeLongMemEvalOfficialRetrievalLog,
  writeLongMemEvalBenchmarkReport
} from "@neurocore/eval-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_FIXTURE = resolve(__dirname, "fixtures", "longmemeval-sample.json");

test("LongMemEval loader parses bundled sample fixture", () => {
  const dataset = loadLongMemEvalDataset(SAMPLE_FIXTURE);

  assert.equal(dataset.length, 3);
  assert.equal(dataset[0].question_id, "lm_q1_single");
  assert.equal(dataset[1].answer_session_ids.length, 2);
  assert.equal(dataset[2].question_id.endsWith("_abs"), true);

  const reparsed = parseLongMemEvalDataset(JSON.stringify(dataset));
  assert.equal(reparsed.length, dataset.length);
});

test("LongMemEval bundle loader resolves official filenames from a directory", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-bundle-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_oracle.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_s_cleaned.json"));

    const bundle = loadLongMemEvalDatasetBundle(stateDir);
    assert.deepEqual(
      bundle.map((entry) => entry.variant),
      ["longmemeval_oracle", "longmemeval_s_cleaned"]
    );
    assert.equal(bundle[0].instances.length, 3);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval bundle loader accepts official cleaned m filename", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-bundle-cleaned-m-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_m_cleaned.json"));

    const bundle = loadLongMemEvalDatasetBundle(stateDir);
    assert.deepEqual(bundle.map((entry) => entry.variant), ["longmemeval_m"]);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval bundle loader recursively resolves nested official filenames", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-bundle-nested-"));
  try {
    const nestedDir = join(stateDir, "datasets", "official");
    mkdirSync(nestedDir, { recursive: true });
    cpSync(SAMPLE_FIXTURE, join(nestedDir, "longmemeval_oracle.json"));
    cpSync(SAMPLE_FIXTURE, join(nestedDir, "longmemeval_s_cleaned.json"));

    const bundle = loadLongMemEvalDatasetBundle(stateDir);
    assert.deepEqual(
      bundle.map((entry) => entry.variant),
      ["longmemeval_oracle", "longmemeval_s_cleaned"]
    );
    assert.equal(bundle[1].instances[0].question_id, "lm_q1_single");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval full bundle loader rejects incomplete official directory", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-bundle-incomplete-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_oracle.json"));

    assert.throws(
      () => loadLongMemEvalDatasetBundle(stateDir, { requireFullBundle: true }),
      /Missing: longmemeval_s_cleaned, longmemeval_m/
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval full bundle loader accepts official cleaned bundle layout", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-bundle-cleaned-full-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_oracle.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_s_cleaned.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_m_cleaned.json"));

    const bundle = loadLongMemEvalDatasetBundle(stateDir, { requireFullBundle: true });
    assert.deepEqual(
      bundle.map((entry) => entry.variant),
      ["longmemeval_oracle", "longmemeval_s_cleaned", "longmemeval_m"]
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval prepare tool shards official bundle into loadable full-bundle slices", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-prepare-source-"));
  const outputDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-prepare-output-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_oracle.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_s_cleaned.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_m_cleaned.json"));

    execFileSync(
      "python3",
      [
        resolve(__dirname, "..", "tools", "longmemeval-prepare-bundle.py"),
        "--dataset",
        stateDir,
        "--output-dir",
        outputDir,
        "--shard-size",
        "1",
        "--clean"
      ],
      { stdio: "pipe" }
    );

    const manifest = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"));
    assert.equal(manifest.shards.length, 3);
    assert.equal(manifest.variants.length, 3);
    assert.deepEqual(manifest.shards[0].case_count_by_variant, {
      longmemeval_m: 1,
      longmemeval_oracle: 1,
      longmemeval_s_cleaned: 1
    });

    const shardBundle = loadLongMemEvalDatasetBundle(join(outputDir, "shard-00000"), {
      requireFullBundle: true
    });
    assert.deepEqual(
      shardBundle.map((entry) => entry.variant),
      ["longmemeval_oracle", "longmemeval_s_cleaned", "longmemeval_m"]
    );
    assert.equal(shardBundle[0].instances.length, 1);
    assert.equal(shardBundle[1].instances.length, 1);
    assert.equal(shardBundle[2].instances.length, 1);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("LongMemEval session benchmark runs against NeuroCore episodic retriever", async () => {
  const dataset = loadLongMemEvalDataset(SAMPLE_FIXTURE);
  const retriever = new NeuroCoreLongMemEvalRetriever({
    granularity: "session",
    topK: 2
  });

  try {
    const report = await runLongMemEvalBenchmark(dataset, retriever, {
      granularity: "session",
      topK: 2
    });

    assert.equal(report.case_count, 3);
    assert.equal(report.non_abstention_count, 2);
    assert.equal(report.abstention_count, 1);
    assert.equal(report.session_recall_at_k, 1);
    assert.equal(report.session_mrr, 1);
    assert.equal(report.turn_recall_at_k, undefined);

    const q1 = report.questions.find((question) => question.question_id === "lm_q1_single");
    const q2 = report.questions.find((question) => question.question_id === "lm_q2_multi");
    assert.ok(q1?.session_hit);
    assert.ok(q2?.session_hit);
    assert.equal(q1?.retrieval.retrieved_session_ids[0], "sess_move");
    assert.ok(
      q2?.retrieval.retrieved_session_ids.includes("sess_course_plan")
      || q2?.retrieval.retrieved_session_ids.includes("sess_course_intro")
    );
  } finally {
    retriever.close();
  }
});

test("LongMemEval turn benchmark supports SQLite-backed NeuroCore retrieval", async () => {
  const dataset = loadLongMemEvalDataset(SAMPLE_FIXTURE);
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-"));
  const retriever = new NeuroCoreLongMemEvalRetriever({
    granularity: "turn",
    topK: 3,
    sqliteFilename: join(stateDir, "longmemeval.sqlite")
  });

  try {
    const report = await runLongMemEvalBenchmark(dataset, retriever, {
      granularity: "turn",
      topK: 3
    });

    assert.equal(report.case_count, 3);
    assert.equal(report.session_recall_at_k, 1);
    assert.equal(report.turn_recall_at_k, 1);
    assert.equal(report.turn_mrr, 0.75);

    const q1 = report.questions.find((question) => question.question_id === "lm_q1_single");
    assert.equal(q1?.turn_hit, true);
    assert.equal(q1?.retrieval.retrieved_turn_refs[0].session_id, "sess_move");
  } finally {
    retriever.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval predictions export to official jsonl format", () => {
  const jsonl = toLongMemEvalPredictionsJsonl([
    { question_id: "lm_q1_single", hypothesis: "Kyoto" },
    { question_id: "lm_q2_multi", hypothesis: "Japanese" }
  ]);

  const lines = jsonl.split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines, [
    { question_id: "lm_q1_single", hypothesis: "Kyoto" },
    { question_id: "lm_q2_multi", hypothesis: "Japanese" }
  ]);
});

test("LongMemEval official retrieval log export matches expected metrics shape", async () => {
  const dataset = loadLongMemEvalDataset(SAMPLE_FIXTURE);
  const retriever = new NeuroCoreLongMemEvalRetriever({
    granularity: "turn",
    topK: 3
  });

  try {
    const report = await runLongMemEvalBenchmark(dataset, retriever, {
      granularity: "turn",
      topK: 3
    });
    const entries = toLongMemEvalOfficialRetrievalLog(dataset, report);

    assert.equal(entries.length, 3);
    assert.equal(entries[0].retrieval_results.metrics.session["recall_any@1"], 1);
    assert.equal(entries[0].retrieval_results.metrics.turn["recall_any@1"], 1);

    const jsonl = toLongMemEvalOfficialRetrievalLogJsonl(entries);
    assert.equal(jsonl.split("\n").length, 3);

    const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-official-log-"));
    try {
      const outputPath = join(stateDir, "retrievallog.jsonl");
      writeLongMemEvalOfficialRetrievalLog(outputPath, entries);
      assert.equal(existsSync(outputPath), true);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  } finally {
    retriever.close();
  }
});

test("LongMemEval benchmark suite writes multi-dataset reports", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-suite-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_oracle.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_s_cleaned.json"));

    const datasets = loadLongMemEvalDatasetBundle(stateDir);
    const suite = await runLongMemEvalBenchmarkSuite(
      datasets,
      (dataset) =>
        new NeuroCoreLongMemEvalRetriever({
          granularity: "session",
          topK: 2,
          scopePrefix: dataset.variant
        }),
      {
        granularity: "session",
        topK: 2
      }
    );

    assert.equal(suite.reports.length, 2);
    assert.equal(suite.reports[0].question_type_metrics["multi-session"].case_count, 1);

    const outputPath = join(stateDir, "longmemeval-report.json");
    writeLongMemEvalBenchmarkReport(outputPath, suite);
    assert.equal(existsSync(outputPath), true);

    const persisted = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(persisted.reports.length, 2);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("LongMemEval benchmark matrix aggregates both session and turn runs", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-longmemeval-matrix-"));
  try {
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_oracle.json"));
    cpSync(SAMPLE_FIXTURE, join(stateDir, "longmemeval_s_cleaned.json"));

    const datasets = loadLongMemEvalDatasetBundle(stateDir);
    const matrix = await runLongMemEvalBenchmarkMatrix(
      datasets,
      (dataset, granularity) =>
        new NeuroCoreLongMemEvalRetriever({
          granularity,
          topK: 3,
          scopePrefix: `${dataset.variant}_${granularity}`
        }),
      {
        granularities: ["session", "turn"],
        topK: 3
      }
    );

    assert.equal(matrix.runs.length, 2);
    assert.equal(matrix.runs[0].aggregate.dataset_count, 2);
    assert.equal(matrix.runs[0].aggregate.case_count, 6);
    assert.equal(matrix.runs[1].aggregate.turn_recall_at_k, 1);

    const aggregated = aggregateLongMemEvalReports(matrix.runs[0].suite.reports, {
      granularity: "session",
      topK: 3
    });
    assert.equal(aggregated.question_type_metrics["multi-session"].case_count, 2);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
