import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runPersonalAssistantBaseline } from "../examples/personal-assistant/dist/baseline/runner.js";

test("PA-BL-001 deterministic personal assistant baseline passes and writes artifacts", { concurrency: false, timeout: 30000 }, async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-baseline-test-"));
  const artifactDir = join(tempDir, "artifact");

  try {
    const result = await runPersonalAssistantBaseline({
      mode: "deterministic",
      artifactDir
    });

    assert.equal(result.verdict.status, "pass", formatFailures(result.verdict));
    assert.equal(result.verdict.failed_count, 0);
    assert.ok(result.verdict.assertion_count >= 50);
    assert.ok(result.metrics.turn_count >= 12);
    assert.ok(result.metrics.email_send_call_count >= 1);
    assert.ok(result.metrics.calendar_call_count >= 1);

    for (const filename of [
      "run.json",
      "transcript.md",
      "events.jsonl",
      "trace.json",
      "memory.json",
      "tools.json",
      "approvals.json",
      "tasks.json",
      "metrics.json",
      "verdict.json"
    ]) {
      const response = await import("node:fs/promises").then((fs) => fs.stat(join(artifactDir, filename)));
      assert.ok(response.isFile(), `${filename} should exist`);
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      t.skip("Local port binding is not permitted in this environment.");
      return;
    }
    throw error;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function formatFailures(verdict) {
  return verdict.assertions
    .filter((record) => !record.passed)
    .map((record) => `${record.id}: ${record.message}`)
    .join("\n");
}
