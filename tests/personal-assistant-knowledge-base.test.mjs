import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPersonalKnowledgeBaseTools,
  PersonalKnowledgeBaseRecallProvider,
  SqlitePersonalKnowledgeBaseStore
} from "../examples/personal-assistant/dist/main.js";

test("personal knowledge base ingests indexes cites reindexes and deletes documents", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-kb-"));
  const store = new SqlitePersonalKnowledgeBaseStore({ filename: join(tempDir, "assistant.sqlite"), maxChunkChars: 240 });

  try {
    const ingested = store.ingest({
      user_id: "user-kb",
      title: "Launch Notes",
      source_uri: "file:///notes/launch.md",
      content: "The Atlas launch checklist requires a dry run on Tuesday.\n\nBudget owner is Maya.",
      permission_scope: "work",
      created_at: "2026-04-28T02:10:00.000Z"
    });
    assert.equal(ingested.document.status, "active");
    assert.equal(ingested.artifacts[0].artifact_type, "document_text");
    assert.equal(ingested.artifacts[0].permission_scope, "work");

    const results = store.search({ user_id: "user-kb", query: "Atlas dry run", permission_scope: "work" });
    assert.equal(results.length > 0, true);
    assert.match(results[0].citation, /^\[kb:pkb_doc_/);
    assert.match(results[0].citation, /Launch Notes/);

    assert.equal(store.search({ user_id: "user-kb", query: "postmortem" }).length, 0);
    const reindexed = store.reindexDocument("user-kb", ingested.document.document_id, "The Atlas postmortem owner is Nina.", "2026-04-28T02:11:00.000Z");
    assert.equal(reindexed.chunks.length, 1);
    assert.equal(store.search({ user_id: "user-kb", query: "postmortem Nina" }).length, 1);

    const deleted = store.deleteDocument("user-kb", ingested.document.document_id, "2026-04-28T02:12:00.000Z");
    assert.equal(deleted.status, "deleted");
    assert.equal(store.search({ user_id: "user-kb", query: "postmortem Nina" }).length, 0);
    assert.equal(store.listDocuments("user-kb").length, 0);
    assert.equal(store.listDocuments("user-kb", true)[0].status, "deleted");
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("knowledge base tools and recall provider return PDF OCR artifacts and citations", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "personal-assistant-kb-tools-"));
  const store = new SqlitePersonalKnowledgeBaseStore({ filename: join(tempDir, "assistant.sqlite") });
  const tools = new Map(createPersonalKnowledgeBaseTools(store).map((tool) => [tool.name, tool]));

  try {
    const ingest = await tools.get("knowledge_base_ingest").invoke({
      user_id: "user-kb",
      title: "Scanned Strategy PDF",
      source_uri: "file:///docs/strategy.pdf",
      mime_type: "application/pdf",
      ocr_text: "OCR text says the retention review deadline is Friday and owner is Priya.",
      permission_scope: "private"
    }, { tenant_id: "tenant-kb", session_id: "sess-kb", cycle_id: "cycle-kb" });
    assert.equal(ingest.payload.artifacts[0].artifact_type, "pdf_ocr_text");
    assert.equal(ingest.payload.artifacts[0].permission_scope, "private");

    const search = await tools.get("knowledge_base_search").invoke({
      user_id: "user-kb",
      query: "retention review Priya",
      permission_scope: "private",
      limit: 3
    }, { tenant_id: "tenant-kb", session_id: "sess-kb", cycle_id: "cycle-kb" });
    assert.equal(search.payload.results.length, 1);
    assert.match(search.payload.citations[0], /Scanned Strategy PDF/);

    const provider = new PersonalKnowledgeBaseRecallProvider(store);
    const proposals = await provider.retrieve({
      tenant_id: "tenant-kb",
      profile: { schema_version: "test" },
      session: { session_id: "sess-kb", current_cycle_id: "cycle-kb", user_id: "user-kb" },
      services: { generateId: (prefix) => `${prefix}_kb` },
      runtime_state: {
        current_input_content: "Who owns the retention review?",
        current_input_metadata: { canonical_user_id: "user-kb" }
      },
      memory_config: { retrieval_top_k: 4 }
    });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].payload.citations.length, 1);
    assert.match(proposals[0].payload.entries[0].summary, /Citation: \[kb:/);

    await tools.get("knowledge_base_delete").invoke({
      user_id: "user-kb",
      document_id: ingest.payload.document.document_id
    }, { tenant_id: "tenant-kb", session_id: "sess-kb", cycle_id: "cycle-kb" });
    assert.equal(store.search({ user_id: "user-kb", query: "retention review Priya" }).length, 0);
    assert.equal((await provider.retrieve({
      tenant_id: "tenant-kb",
      profile: { schema_version: "test" },
      session: { session_id: "sess-kb", current_cycle_id: "cycle-kb", user_id: "user-kb" },
      services: { generateId: (prefix) => `${prefix}_kb` },
      runtime_state: {
        current_input_content: "Who owns the retention review?",
        current_input_metadata: { canonical_user_id: "user-kb" }
      },
      memory_config: { retrieval_top_k: 4 }
    })).length, 0);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
