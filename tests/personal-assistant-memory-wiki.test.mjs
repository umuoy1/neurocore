import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rebuildMemoryWikiPage } from "../examples/personal-assistant/dist/memory/memory-wiki.js";
import { SqliteMemoryClaimStore } from "../examples/personal-assistant/dist/memory/sqlite-memory-claim-store.js";

test("personal memory facts are represented as claims with evidence freshness and contradiction metadata", { concurrency: false }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-memory-claims-"));
  const store = new SqliteMemoryClaimStore({ filename: join(tempDir, "claims.sqlite") });

  try {
    const first = store.create({
      user_id: "user-claims",
      subject: "drink preference",
      claim: "User prefers decaf coffee after lunch.",
      status: "approved",
      evidence_refs: [
        {
          ref_id: "sse_1",
          ref_type: "session_search",
          session_id: "ses-coffee",
          source_message_id: "msg-coffee",
          summary: "User asked for decaf coffee.",
          created_at: "2026-04-20T00:00:00.000Z"
        }
      ],
      observed_at: "2026-04-20T00:00:00.000Z",
      ttl_days: 30,
      created_at: "2026-04-27T00:00:00.000Z"
    });
    const second = store.create({
      user_id: "user-claims",
      subject: "drink preference",
      claim: "User avoids all coffee.",
      evidence_refs: [
        {
          ref_id: "pmem_1",
          ref_type: "personal_memory",
          summary: "Explicit correction from user.",
          created_at: "2026-04-27T00:00:00.000Z"
        }
      ],
      observed_at: "2026-04-27T00:00:00.000Z",
      created_at: "2026-04-27T00:00:00.000Z"
    });

    assert.equal(first.evidence_refs[0].session_id, "ses-coffee");
    assert.ok(first.freshness.score < 1);
    assert.ok(first.freshness.score > 0.7);
    assert.deepEqual(second.contradiction.contradicts_claim_ids, [first.claim_id]);
    assert.match(second.contradiction.summary, /drink preference/);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("memory wiki pages rebuild from approved claims and source sessions", { concurrency: false }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-memory-wiki-"));
  const dbPath = join(tempDir, "claims.sqlite");
  const writer = new SqliteMemoryClaimStore({ filename: dbPath });

  try {
    writer.create({
      user_id: "user-wiki",
      subject: "project codename",
      claim: "The Atlantis draft release codename is blue heron.",
      status: "approved",
      evidence_refs: [
        {
          ref_id: "sse_atlantis",
          ref_type: "session_search",
          session_id: "ses-atlantis",
          source_message_id: "msg-atlantis",
          summary: "Assistant recalled the Atlantis codename.",
          created_at: "2026-04-24T00:00:00.000Z"
        }
      ],
      created_at: "2026-04-27T00:00:00.000Z"
    });
    writer.create({
      user_id: "user-wiki",
      subject: "project codename",
      claim: "Candidate-only claim should not appear by default.",
      status: "candidate",
      created_at: "2026-04-27T00:00:00.000Z"
    });
    writer.close();

    const reader = new SqliteMemoryClaimStore({ filename: dbPath });
    const page = rebuildMemoryWikiPage({
      store: reader,
      user_id: "user-wiki",
      now: "2026-04-27T00:00:00.000Z"
    });

    assert.equal(page.sections.length, 1);
    assert.equal(page.sections[0].subject, "project codename");
    assert.equal(page.sections[0].claims[0].evidence_refs[0].session_id, "ses-atlantis");
    assert.match(page.markdown, /Memory Wiki: user-wiki/);
    assert.match(page.markdown, /blue heron/);
    assert.match(page.markdown, /ses-atlantis:msg-atlantis/);
    assert.doesNotMatch(page.markdown, /Candidate-only/);
    reader.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("user review can approve correct and retire claims", { concurrency: false }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-memory-review-"));
  const store = new SqliteMemoryClaimStore({ filename: join(tempDir, "claims.sqlite") });

  try {
    const candidate = store.create({
      user_id: "user-review",
      subject: "timezone",
      claim: "User is in UTC.",
      created_at: "2026-04-27T00:00:00.000Z"
    });
    const approved = store.approve(candidate.claim_id, {
      reviewer_id: "user-review",
      reviewed_at: "2026-04-27T01:00:00.000Z"
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.reviewer_id, "user-review");

    const corrected = store.correct(candidate.claim_id, {
      reviewer_id: "user-review",
      reviewed_at: "2026-04-27T02:00:00.000Z",
      claim: "User is in Asia/Shanghai.",
      evidence_refs: [
        {
          ref_id: "manual_tz",
          ref_type: "manual",
          summary: "User corrected timezone."
        }
      ]
    });
    assert.equal(corrected.retired.status, "corrected");
    assert.equal(corrected.claim.status, "approved");
    assert.equal(corrected.claim.correction_of, candidate.claim_id);
    assert.equal(corrected.claim.evidence_refs[0].ref_id, "manual_tz");

    const retired = store.retire(corrected.claim.claim_id, {
      reviewer_id: "user-review",
      reviewed_at: "2026-04-27T03:00:00.000Z"
    });
    assert.equal(retired.status, "retired");
    assert.equal(store.list({
      user_id: "user-review",
      statuses: ["approved"]
    }).length, 0);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
