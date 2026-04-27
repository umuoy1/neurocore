import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Episode, JsonValue, MemoryDigest, MemoryProvider, ModuleContext, Proposal, Tool } from "@neurocore/protocol";

export type PersonalKnowledgeDocumentStatus = "active" | "deleted";

export interface PersonalKnowledgeDocument {
  document_id: string;
  user_id: string;
  title: string;
  source_uri?: string;
  mime_type?: string;
  permission_scope: string;
  status: PersonalKnowledgeDocumentStatus;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  metadata: Record<string, unknown>;
}

export interface PersonalKnowledgeChunk {
  chunk_id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  citation: string;
  status: PersonalKnowledgeDocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface PersonalKnowledgeArtifact {
  artifact_id: string;
  document_id: string;
  user_id: string;
  artifact_type: "document_text" | "pdf_ocr_text";
  mime_type?: string;
  permission_scope: string;
  content_text: string;
  status: PersonalKnowledgeDocumentStatus;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface PersonalKnowledgeIngestInput {
  user_id: string;
  title: string;
  content?: string;
  ocr_text?: string;
  source_uri?: string;
  mime_type?: string;
  permission_scope?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface PersonalKnowledgeSearchQuery {
  user_id: string;
  query: string;
  permission_scope?: string;
  limit?: number;
}

export interface PersonalKnowledgeSearchResult {
  document: PersonalKnowledgeDocument;
  chunk: PersonalKnowledgeChunk;
  artifact?: PersonalKnowledgeArtifact;
  score: number;
  citation: string;
}

export interface PersonalKnowledgeIngestResult {
  document: PersonalKnowledgeDocument;
  chunks: PersonalKnowledgeChunk[];
  artifacts: PersonalKnowledgeArtifact[];
}

export interface PersonalKnowledgeBaseStore {
  ingest(input: PersonalKnowledgeIngestInput): PersonalKnowledgeIngestResult;
  search(query: PersonalKnowledgeSearchQuery): PersonalKnowledgeSearchResult[];
  deleteDocument(userId: string, documentId: string, deletedAt?: string): PersonalKnowledgeDocument | undefined;
  reindexDocument(userId: string, documentId: string, content?: string, reindexedAt?: string): PersonalKnowledgeIngestResult;
  getDocument(userId: string, documentId: string): PersonalKnowledgeDocument | undefined;
  listDocuments(userId: string, includeDeleted?: boolean): PersonalKnowledgeDocument[];
  close?(): void;
}

export interface SqlitePersonalKnowledgeBaseStoreOptions {
  filename: string;
  maxChunkChars?: number;
}

export class SqlitePersonalKnowledgeBaseStore implements PersonalKnowledgeBaseStore {
  private readonly db: DatabaseSync;
  private readonly maxChunkChars: number;

  public constructor(options: SqlitePersonalKnowledgeBaseStoreOptions) {
    mkdirSync(dirname(options.filename), { recursive: true });
    this.db = new DatabaseSync(options.filename);
    this.maxChunkChars = Math.max(200, options.maxChunkChars ?? 1200);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_kb_documents (
        document_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_uri TEXT,
        mime_type TEXT,
        permission_scope TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personal_kb_chunks (
        chunk_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        citation TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personal_kb_artifacts (
        artifact_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        mime_type TEXT,
        permission_scope TEXT NOT NULL,
        content_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_kb_documents_user_status
        ON personal_kb_documents(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_personal_kb_chunks_user_status
        ON personal_kb_chunks(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_personal_kb_artifacts_user_status
        ON personal_kb_artifacts(user_id, status, created_at DESC);
    `);
  }

  public ingest(input: PersonalKnowledgeIngestInput): PersonalKnowledgeIngestResult {
    const now = input.created_at ?? new Date().toISOString();
    const text = normalizeContent(input.ocr_text ?? input.content ?? "");
    if (!text) {
      throw new Error("Knowledge base ingestion requires content or OCR text.");
    }
    const document: PersonalKnowledgeDocument = {
      document_id: `pkb_doc_${randomUUID()}`,
      user_id: input.user_id,
      title: input.title.trim() || "Untitled document",
      source_uri: input.source_uri,
      mime_type: input.mime_type,
      permission_scope: input.permission_scope ?? "private",
      status: "active",
      created_at: now,
      updated_at: now,
      metadata: input.metadata ?? {}
    };
    const artifacts = [this.buildArtifact(document, text, input, now)];
    const chunks = splitChunks(text, this.maxChunkChars).map((content, index) => this.buildChunk(document, content, index, now));
    this.insertDocumentBundle(document, chunks, artifacts);
    return { document, chunks, artifacts };
  }

  public search(query: PersonalKnowledgeSearchQuery): PersonalKnowledgeSearchResult[] {
    const rows = this.db.prepare(`
      SELECT c.*, d.title, d.source_uri, d.mime_type, d.permission_scope, d.created_at AS document_created_at,
             d.updated_at AS document_updated_at, d.metadata_json AS document_metadata_json
      FROM personal_kb_chunks c
      JOIN personal_kb_documents d ON d.document_id = c.document_id
      WHERE c.user_id = ?
        AND c.status = 'active'
        AND d.status = 'active'
        AND (? IS NULL OR d.permission_scope = ?)
      ORDER BY c.updated_at DESC, c.chunk_index ASC
      LIMIT ?
    `).all(
      query.user_id,
      query.permission_scope ?? null,
      query.permission_scope ?? null,
      Math.max(25, (query.limit ?? 5) * 12)
    ) as unknown as KnowledgeSearchRow[];
    const queryTokens = tokenize(query.query);
    const phrase = normalizeText(query.query);
    return rows
      .map((row, index) => toSearchResult(row, queryTokens, phrase, index, this.findArtifact(row.document_id)))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.chunk_index - right.chunk.chunk_index)
      .slice(0, Math.max(1, query.limit ?? 5));
  }

  public deleteDocument(userId: string, documentId: string, deletedAt = new Date().toISOString()): PersonalKnowledgeDocument | undefined {
    const document = this.getDocument(userId, documentId);
    if (!document || document.status === "deleted") {
      return document;
    }
    this.db.prepare(`
      UPDATE personal_kb_documents
      SET status = 'deleted', updated_at = ?, deleted_at = ?
      WHERE user_id = ? AND document_id = ?
    `).run(deletedAt, deletedAt, userId, documentId);
    this.db.prepare("UPDATE personal_kb_chunks SET status = 'deleted', updated_at = ? WHERE user_id = ? AND document_id = ?")
      .run(deletedAt, userId, documentId);
    this.db.prepare("UPDATE personal_kb_artifacts SET status = 'deleted' WHERE user_id = ? AND document_id = ?")
      .run(userId, documentId);
    return {
      ...document,
      status: "deleted",
      updated_at: deletedAt,
      deleted_at: deletedAt
    };
  }

  public reindexDocument(userId: string, documentId: string, content?: string, reindexedAt = new Date().toISOString()): PersonalKnowledgeIngestResult {
    const document = this.getDocument(userId, documentId);
    if (!document || document.status !== "active") {
      throw new Error(`Active knowledge document not found: ${documentId}`);
    }
    const artifact = this.findArtifact(documentId);
    const nextContent = normalizeContent(content ?? artifact?.content_text ?? "");
    if (!nextContent) {
      throw new Error("Knowledge document has no content to reindex.");
    }
    this.db.prepare("DELETE FROM personal_kb_chunks WHERE user_id = ? AND document_id = ?").run(userId, documentId);
    const nextDocument = {
      ...document,
      updated_at: reindexedAt
    };
    this.db.prepare("UPDATE personal_kb_documents SET updated_at = ? WHERE user_id = ? AND document_id = ?")
      .run(reindexedAt, userId, documentId);
    const chunks = splitChunks(nextContent, this.maxChunkChars).map((chunk, index) => this.buildChunk(nextDocument, chunk, index, reindexedAt));
    const insertChunk = this.db.prepare(`
      INSERT INTO personal_kb_chunks (
        chunk_id, document_id, user_id, chunk_index, content, citation, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of chunks) {
      insertChunk.run(chunk.chunk_id, chunk.document_id, chunk.user_id, chunk.chunk_index, chunk.content, chunk.citation, chunk.status, chunk.created_at, chunk.updated_at);
    }
    const artifacts = artifact ? [artifact] : [];
    return { document: nextDocument, chunks, artifacts };
  }

  public getDocument(userId: string, documentId: string): PersonalKnowledgeDocument | undefined {
    const row = this.db.prepare("SELECT * FROM personal_kb_documents WHERE user_id = ? AND document_id = ?")
      .get(userId, documentId) as unknown as KnowledgeDocumentRow | undefined;
    return row ? toDocument(row) : undefined;
  }

  public listDocuments(userId: string, includeDeleted = false): PersonalKnowledgeDocument[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM personal_kb_documents
      WHERE user_id = ?
        AND (? = 1 OR status = 'active')
      ORDER BY updated_at DESC, document_id DESC
    `).all(userId, includeDeleted ? 1 : 0) as unknown as KnowledgeDocumentRow[];
    return rows.map(toDocument);
  }

  public close(): void {
    this.db.close();
  }

  private buildArtifact(
    document: PersonalKnowledgeDocument,
    text: string,
    input: PersonalKnowledgeIngestInput,
    createdAt: string
  ): PersonalKnowledgeArtifact {
    return {
      artifact_id: `pkb_art_${randomUUID()}`,
      document_id: document.document_id,
      user_id: document.user_id,
      artifact_type: isPdfInput(input) ? "pdf_ocr_text" : "document_text",
      mime_type: document.mime_type,
      permission_scope: document.permission_scope,
      content_text: text,
      status: "active",
      created_at: createdAt,
      metadata: {
        source_uri: document.source_uri,
        title: document.title,
        ocr: Boolean(input.ocr_text),
        ...input.metadata
      }
    };
  }

  private buildChunk(
    document: PersonalKnowledgeDocument,
    content: string,
    index: number,
    createdAt: string
  ): PersonalKnowledgeChunk {
    return {
      chunk_id: `pkb_chk_${randomUUID()}`,
      document_id: document.document_id,
      user_id: document.user_id,
      chunk_index: index,
      content,
      citation: formatCitation(document, index),
      status: "active",
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  private insertDocumentBundle(
    document: PersonalKnowledgeDocument,
    chunks: PersonalKnowledgeChunk[],
    artifacts: PersonalKnowledgeArtifact[]
  ): void {
    this.db.prepare(`
      INSERT INTO personal_kb_documents (
        document_id, user_id, title, source_uri, mime_type, permission_scope, status, created_at, updated_at, deleted_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      document.document_id,
      document.user_id,
      document.title,
      document.source_uri ?? null,
      document.mime_type ?? null,
      document.permission_scope,
      document.status,
      document.created_at,
      document.updated_at,
      document.deleted_at ?? null,
      JSON.stringify(document.metadata)
    );
    const insertChunk = this.db.prepare(`
      INSERT INTO personal_kb_chunks (
        chunk_id, document_id, user_id, chunk_index, content, citation, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of chunks) {
      insertChunk.run(chunk.chunk_id, chunk.document_id, chunk.user_id, chunk.chunk_index, chunk.content, chunk.citation, chunk.status, chunk.created_at, chunk.updated_at);
    }
    const insertArtifact = this.db.prepare(`
      INSERT INTO personal_kb_artifacts (
        artifact_id, document_id, user_id, artifact_type, mime_type, permission_scope, content_text, status, created_at, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const artifact of artifacts) {
      insertArtifact.run(
        artifact.artifact_id,
        artifact.document_id,
        artifact.user_id,
        artifact.artifact_type,
        artifact.mime_type ?? null,
        artifact.permission_scope,
        artifact.content_text,
        artifact.status,
        artifact.created_at,
        JSON.stringify(artifact.metadata)
      );
    }
  }

  private findArtifact(documentId: string): PersonalKnowledgeArtifact | undefined {
    const row = this.db.prepare("SELECT * FROM personal_kb_artifacts WHERE document_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get(documentId) as unknown as KnowledgeArtifactRow | undefined;
    return row ? toArtifact(row) : undefined;
  }
}

export class PersonalKnowledgeBaseRecallProvider implements MemoryProvider {
  public readonly name = "personal-knowledge-base-recall-provider";
  public readonly layer = "semantic";

  public constructor(
    private readonly store: PersonalKnowledgeBaseStore,
    private readonly options: { limit?: number } = {}
  ) {}

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    const userId = resolveUserId(ctx);
    const query = resolveCurrentInput(ctx);
    if (!userId || !query) {
      return [];
    }
    const results = this.store.search({
      user_id: userId,
      query,
      limit: this.options.limit ?? ctx.memory_config?.retrieval_top_k ?? 5
    });
    if (results.length === 0) {
      return [];
    }
    return [{
      proposal_id: ctx.services.generateId("prp"),
      schema_version: ctx.profile.schema_version,
      session_id: ctx.session.session_id,
      cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
      module_name: this.name,
      proposal_type: "memory_recall",
      salience_score: 0.91,
      confidence: 0.9,
      risk: 0,
      payload: {
        user_id: userId,
        knowledge_base_results: results.map(toBundleResult),
        citations: results.map((result) => result.citation),
        entries: results.map((result) => ({
          memory_id: result.chunk.chunk_id,
          summary: `${result.chunk.content}\nCitation: ${result.citation}`,
          document_id: result.document.document_id,
          citation: result.citation,
          score: result.score
        }))
      },
      explanation: `Retrieved ${results.length} personal knowledge base chunks with citations.`
    }];
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    const userId = resolveUserId(ctx);
    const query = resolveCurrentInput(ctx);
    if (!userId || !query) {
      return [];
    }
    return this.store.search({
      user_id: userId,
      query,
      limit: this.options.limit ?? ctx.memory_config?.retrieval_top_k ?? 5
    }).map((result, index) => ({
      memory_id: result.chunk.chunk_id,
      memory_type: "semantic",
      summary: `${result.chunk.content}\nCitation: ${result.citation}`,
      relevance: Math.max(0.1, Math.min(1, result.score || 0.9 - index * 0.04))
    }));
  }

  public async writeEpisode(_ctx: ModuleContext, _episode: Episode): Promise<void> {
    return;
  }
}

export function createPersonalKnowledgeBaseTools(store: PersonalKnowledgeBaseStore): Tool[] {
  return [
    createIngestTool(store),
    createSearchTool(store),
    createDeleteTool(store),
    createReindexTool(store)
  ];
}

function createIngestTool(store: PersonalKnowledgeBaseStore): Tool {
  return {
    name: "knowledge_base_ingest",
    description: "Ingest a personal knowledge base document with optional PDF/OCR content.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        ocr_text: { type: "string" },
        source_uri: { type: "string" },
        mime_type: { type: "string" },
        permission_scope: { type: "string" }
      },
      required: ["user_id", "title"]
    },
    async invoke(input) {
      const result = store.ingest({
        user_id: readRequiredString(input.user_id, "user_id"),
        title: readRequiredString(input.title, "title"),
        content: readOptionalString(input.content),
        ocr_text: readOptionalString(input.ocr_text),
        source_uri: readOptionalString(input.source_uri),
        mime_type: readOptionalString(input.mime_type),
        permission_scope: readOptionalString(input.permission_scope)
      });
      return {
        summary: `Ingested knowledge document ${result.document.document_id} with ${result.chunks.length} chunk(s).`,
        payload: toJsonRecord(result)
      };
    }
  };
}

function createSearchTool(store: PersonalKnowledgeBaseStore): Tool {
  return {
    name: "knowledge_base_search",
    description: "Search the personal knowledge base and return cited document chunks.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        query: { type: "string" },
        permission_scope: { type: "string" },
        limit: { type: "number" }
      },
      required: ["user_id", "query"]
    },
    async invoke(input) {
      const results = store.search({
        user_id: readRequiredString(input.user_id, "user_id"),
        query: readRequiredString(input.query, "query"),
        permission_scope: readOptionalString(input.permission_scope),
        limit: readOptionalNumber(input.limit)
      });
      return {
        summary: `Found ${results.length} cited knowledge base result(s).`,
        payload: {
          results: results.map(toBundleResult) as JsonValue,
          citations: results.map((result) => result.citation)
        }
      };
    }
  };
}

function createDeleteTool(store: PersonalKnowledgeBaseStore): Tool {
  return {
    name: "knowledge_base_delete",
    description: "Delete a personal knowledge base document so it can no longer be retrieved.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        document_id: { type: "string" }
      },
      required: ["user_id", "document_id"]
    },
    async invoke(input) {
      const document = store.deleteDocument(
        readRequiredString(input.user_id, "user_id"),
        readRequiredString(input.document_id, "document_id")
      );
      return {
        summary: document ? `Deleted knowledge document ${document.document_id}.` : "Knowledge document was not found.",
        payload: { document: document ? toJsonRecord(document) : undefined }
      };
    }
  };
}

function createReindexTool(store: PersonalKnowledgeBaseStore): Tool {
  return {
    name: "knowledge_base_reindex",
    description: "Rebuild chunks and citations for an active personal knowledge base document.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        document_id: { type: "string" },
        content: { type: "string" }
      },
      required: ["user_id", "document_id"]
    },
    async invoke(input) {
      const result = store.reindexDocument(
        readRequiredString(input.user_id, "user_id"),
        readRequiredString(input.document_id, "document_id"),
        readOptionalString(input.content)
      );
      return {
        summary: `Reindexed knowledge document ${result.document.document_id} with ${result.chunks.length} chunk(s).`,
        payload: toJsonRecord(result)
      };
    }
  };
}

interface KnowledgeDocumentRow {
  document_id: string;
  user_id: string;
  title: string;
  source_uri: string | null;
  mime_type: string | null;
  permission_scope: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  metadata_json: string;
}

interface KnowledgeChunkRow {
  chunk_id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  citation: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeArtifactRow {
  artifact_id: string;
  document_id: string;
  user_id: string;
  artifact_type: string;
  mime_type: string | null;
  permission_scope: string;
  content_text: string;
  status: string;
  created_at: string;
  metadata_json: string;
}

interface KnowledgeSearchRow extends KnowledgeChunkRow {
  title: string;
  source_uri: string | null;
  mime_type: string | null;
  permission_scope: string;
  document_created_at: string;
  document_updated_at: string;
  document_metadata_json: string;
}

function toSearchResult(
  row: KnowledgeSearchRow,
  queryTokens: Set<string>,
  phrase: string,
  index: number,
  artifact: PersonalKnowledgeArtifact | undefined
): PersonalKnowledgeSearchResult {
  const chunk = toChunk(row);
  const document = toDocument({
    document_id: row.document_id,
    user_id: row.user_id,
    title: row.title,
    source_uri: row.source_uri,
    mime_type: row.mime_type,
    permission_scope: row.permission_scope,
    status: "active",
    created_at: row.document_created_at,
    updated_at: row.document_updated_at,
    deleted_at: null,
    metadata_json: row.document_metadata_json
  });
  const contentTokens = tokenize(chunk.content);
  const normalizedContent = normalizeText(chunk.content);
  const phraseScore = phrase && normalizedContent.includes(phrase) ? 1 : 0;
  const tokenScore = overlapScore(contentTokens, queryTokens);
  const recencyScore = 1 / (index + 1);
  const matchScore = Math.max(phraseScore, tokenScore);
  return {
    document,
    chunk,
    artifact,
    score: matchScore > 0 ? matchScore * 0.85 + recencyScore * 0.15 : 0,
    citation: chunk.citation
  };
}

function toBundleResult(result: PersonalKnowledgeSearchResult): Record<string, JsonValue> {
  return {
    document_id: result.document.document_id,
    chunk_id: result.chunk.chunk_id,
    title: result.document.title,
    content: result.chunk.content,
    citation: result.citation,
    score: result.score,
    source_uri: result.document.source_uri ?? null,
    permission_scope: result.document.permission_scope,
    artifact_id: result.artifact?.artifact_id ?? null,
    artifact_type: result.artifact?.artifact_type ?? null
  };
}

function toDocument(row: KnowledgeDocumentRow): PersonalKnowledgeDocument {
  return {
    document_id: row.document_id,
    user_id: row.user_id,
    title: row.title,
    source_uri: row.source_uri ?? undefined,
    mime_type: row.mime_type ?? undefined,
    permission_scope: row.permission_scope,
    status: row.status === "deleted" ? "deleted" : "active",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
    metadata: parseMetadata(row.metadata_json)
  };
}

function toChunk(row: KnowledgeChunkRow): PersonalKnowledgeChunk {
  return {
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    user_id: row.user_id,
    chunk_index: row.chunk_index,
    content: row.content,
    citation: row.citation,
    status: row.status === "deleted" ? "deleted" : "active",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toArtifact(row: KnowledgeArtifactRow): PersonalKnowledgeArtifact {
  return {
    artifact_id: row.artifact_id,
    document_id: row.document_id,
    user_id: row.user_id,
    artifact_type: row.artifact_type === "pdf_ocr_text" ? "pdf_ocr_text" : "document_text",
    mime_type: row.mime_type ?? undefined,
    permission_scope: row.permission_scope,
    content_text: row.content_text,
    status: row.status === "deleted" ? "deleted" : "active",
    created_at: row.created_at,
    metadata: parseMetadata(row.metadata_json)
  };
}

function splitChunks(content: string, maxChunkChars: number): string[] {
  const paragraphs = content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [content]) {
    if (current && current.length + paragraph.length + 2 > maxChunkChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    while (current.length > maxChunkChars) {
      chunks.push(current.slice(0, maxChunkChars));
      current = current.slice(maxChunkChars);
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function formatCitation(document: PersonalKnowledgeDocument, chunkIndex: number): string {
  const source = document.source_uri ? ` ${document.source_uri}` : "";
  return `[kb:${document.document_id}#${chunkIndex + 1}] ${document.title}${source}`;
}

function isPdfInput(input: PersonalKnowledgeIngestInput): boolean {
  return input.mime_type === "application/pdf" || Boolean(input.source_uri?.toLowerCase().endsWith(".pdf"));
}

function resolveCurrentInput(ctx: ModuleContext): string {
  return typeof ctx.runtime_state.current_input_content === "string"
    ? ctx.runtime_state.current_input_content
    : "";
}

function resolveUserId(ctx: ModuleContext): string | undefined {
  const metadata = isRecord(ctx.runtime_state.current_input_metadata) ? ctx.runtime_state.current_input_metadata : {};
  const identity = isRecord(metadata.identity) ? metadata.identity : {};
  return asString(metadata.canonical_user_id)
    ?? asString(identity.canonical_user_id)
    ?? ctx.session.user_id;
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean));
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim();
}

function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function overlapScore(contentTokens: Set<string>, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / queryTokens.size;
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
