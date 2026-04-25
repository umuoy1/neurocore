import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  loadLongMemEvalDatasetBundle,
  NeuroCoreLongMemEvalRetriever,
  runMemorySystemBenchmark,
  writeMemorySystemBenchmarkReport
} from "@neurocore/eval-core";
import {
  migrateSqliteRuntimeStateToSqlFirst,
  SqliteRuntimeStateStore,
  validateSqlFirstRuntimeState
} from "@neurocore/runtime-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_FIXTURE = resolve(__dirname, "fixtures", "longmemeval-sample.json");

test("memory system benchmark runs retrieval, objective, and causal lanes into one artifact", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-memory-system-benchmark-"));
  try {
    const datasets = loadLongMemEvalDatasetBundle(SAMPLE_FIXTURE);
    const report = await runMemorySystemBenchmark({
      createdAt: "2026-04-25T00:00:00.000Z",
      longMemEval: {
        datasets,
        topK: 3,
        granularities: ["session", "turn"],
        retrieverFactory: (dataset, granularity) =>
          new NeuroCoreLongMemEvalRetriever({
            granularity,
            topK: 3,
            sqliteFilename: join(stateDir, `${dataset.variant}-${granularity}.sqlite`),
            scopePrefix: `${dataset.variant}_${granularity}`
          })
      },
      objectiveCases: [
        {
          case_id: "objective_complete",
          expected_episode_ids: ["epi_1"],
          recalled_episode_ids: ["epi_1"],
          expected_card_ids: ["card_1"],
          recalled_card_ids: ["card_1"],
          expected_skill_spec_ids: ["spec_1"],
          recalled_skill_spec_ids: ["spec_1"],
          disallowed_object_ids: ["bad_1"],
          returned_object_ids: ["epi_1", "card_1", "spec_1"]
        }
      ],
      causalCases: [
        {
          case_id: "causal_degrade",
          intervention: "remove_episode",
          baseline_score: 0.9,
          perturbed_score: 0.6,
          expected_direction: "degrade"
        }
      ]
    });

    assert.equal(report.benchmark, "NeuroCoreMemorySystem");
    assert.equal(report.longmemeval?.runs.length, 2);
    assert.equal(report.objective?.case_count, 1);
    assert.equal(report.causal?.case_count, 1);
    assert.ok(report.summary.memory_score > 0);
    assert.ok(report.summary.memory_score <= 1);

    const output = join(stateDir, "memory-system-benchmark.json");
    writeMemorySystemBenchmarkReport(output, report);
    assert.equal(existsSync(output), true);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).benchmark, "NeuroCoreMemorySystem");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("SQL-first validator detects legacy payloads and passes after explicit migration", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "neurocore-sql-first-validator-"));
  try {
    const filename = join(stateDir, "runtime.sqlite");
    const stateStore = new SqliteRuntimeStateStore({ filename });
    stateStore.saveSession({
      session: {
        session_id: "ses_sql_first_validate",
        schema_version: "1.0.0",
        tenant_id: "tenant_memory",
        agent_id: "memory-validator-agent",
        state: "waiting",
        session_mode: "sync",
        goal_tree_ref: "goal_tree_memory",
        budget_state: {},
        policy_state: {}
      },
      goals: [],
      working_memory: [
        { memory_id: "mem_sql_first_validate", summary: "legacy working", relevance: 1 }
      ],
      episodes: [
        {
          episode_id: "epi_sql_first_validate",
          schema_version: "1.0.0",
          session_id: "ses_sql_first_validate",
          trigger_summary: "legacy trigger",
          goal_refs: [],
          context_digest: "legacy context",
          selected_strategy: "legacy strategy",
          action_refs: ["act_1"],
          observation_refs: ["obs_1"],
          outcome: "success",
          outcome_summary: "legacy outcome",
          created_at: "2026-04-25T00:00:00.000Z"
        }
      ],
      trace_records: [],
      approvals: [],
      pending_approvals: [],
      checkpoints: [
        {
          checkpoint_id: "chk_sql_first_validate",
          schema_version: "1.0.0",
          session: {
            session_id: "ses_sql_first_validate",
            schema_version: "1.0.0",
            tenant_id: "tenant_memory",
            agent_id: "memory-validator-agent",
            state: "waiting",
            session_mode: "sync",
            goal_tree_ref: "goal_tree_memory",
            budget_state: {},
            policy_state: {}
          },
          goals: [],
          working_memory: [],
          created_at: "2026-04-25T00:00:00.000Z"
        }
      ]
    });
    stateStore.close();

    const before = validateSqlFirstRuntimeState({ filename });
    assert.equal(before.compatible, false);
    assert.deepEqual(before.legacy_memory_payload_session_ids, ["ses_sql_first_validate"]);
    assert.deepEqual(before.legacy_checkpoint_payload_session_ids, ["ses_sql_first_validate"]);
    assert.ok(before.missing_tables.includes("episodic_episodes"));

    const migration = migrateSqliteRuntimeStateToSqlFirst({ filename });
    assert.equal(migration.memorySessionsBackfilled, 1);
    assert.equal(migration.checkpointSessionsBackfilled, 1);

    const after = validateSqlFirstRuntimeState({ filename });
    assert.equal(after.compatible, true);
    assert.equal(after.runtime_session_count, 1);
    assert.equal(after.table_counts.working_memory_entries, 1);
    assert.equal(after.table_counts.episodic_episodes, 1);
    assert.equal(after.table_counts.session_checkpoints, 1);
    assert.equal(after.migration_status.memory_backfill_completed, true);
    assert.equal(after.migration_status.checkpoint_backfill_completed, true);
    assert.equal(after.migration_status.memory_payload_cleanup_completed, true);
    assert.equal(after.migration_status.checkpoint_payload_cleanup_completed, true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
