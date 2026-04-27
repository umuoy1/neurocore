import { randomUUID } from "node:crypto";
import type { JsonValue, Tool } from "@neurocore/protocol";

export type CanvasArtifactType = "html";

export interface CanvasArtifactVersion {
  version_id: string;
  version_no: number;
  html: string;
  sanitized_html: string;
  diff: string;
  created_at: string;
  created_by?: string;
  metadata: Record<string, unknown>;
}

export interface CanvasArtifact {
  artifact_id: string;
  artifact_type: CanvasArtifactType;
  title: string;
  owner_id: string;
  permission_scope: string;
  current_version_id: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  versions: CanvasArtifactVersion[];
}

export interface CanvasPreview {
  preview_id: string;
  artifact_id: string;
  version_id: string;
  version_no: number;
  title: string;
  html: string;
  content_security_policy: string;
  iframe_sandbox: string;
}

export interface CanvasArtifactCreateInput {
  artifact_id?: string;
  title: string;
  html: string;
  owner_id: string;
  permission_scope?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

export interface CanvasArtifactUpdateInput {
  artifact_id: string;
  html: string;
  title?: string;
  updated_by?: string;
  metadata?: Record<string, unknown>;
}

export interface CanvasArtifactRollbackInput {
  artifact_id: string;
  target_version_id?: string;
  target_version_no?: number;
  rolled_back_by?: string;
}

export interface CanvasArtifactStore {
  create(input: CanvasArtifactCreateInput): CanvasArtifact;
  update(input: CanvasArtifactUpdateInput): CanvasArtifact;
  rollback(input: CanvasArtifactRollbackInput): CanvasArtifact;
  inspect(artifactId: string): CanvasArtifact | undefined;
  list(query?: { owner_id?: string; permission_scope?: string; limit?: number }): CanvasArtifact[];
  preview(artifactId: string, versionId?: string): CanvasPreview;
}

const CANVAS_CSP = "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:";
const IFRAME_SANDBOX = "allow-forms allow-popups";

export class InMemoryCanvasArtifactStore implements CanvasArtifactStore {
  private readonly artifacts = new Map<string, CanvasArtifact>();

  public create(input: CanvasArtifactCreateInput): CanvasArtifact {
    const timestamp = new Date().toISOString();
    const artifactId = input.artifact_id ?? `canvas_${randomUUID()}`;
    if (this.artifacts.has(artifactId)) {
      throw new Error(`Canvas artifact already exists: ${artifactId}`);
    }
    const version = this.createVersion({
      html: input.html,
      previousHtml: "",
      versionNo: 1,
      actorId: input.created_by,
      metadata: input.metadata
    });
    const artifact: CanvasArtifact = {
      artifact_id: artifactId,
      artifact_type: "html",
      title: input.title,
      owner_id: input.owner_id,
      permission_scope: input.permission_scope ?? "private",
      current_version_id: version.version_id,
      created_at: timestamp,
      updated_at: timestamp,
      metadata: cloneRecord(input.metadata),
      versions: [version]
    };
    this.artifacts.set(artifactId, artifact);
    return cloneArtifact(artifact);
  }

  public update(input: CanvasArtifactUpdateInput): CanvasArtifact {
    const artifact = this.requireArtifact(input.artifact_id);
    const current = this.currentVersion(artifact);
    const version = this.createVersion({
      html: input.html,
      previousHtml: current.sanitized_html,
      versionNo: artifact.versions.length + 1,
      actorId: input.updated_by,
      metadata: input.metadata
    });
    artifact.versions.push(version);
    artifact.current_version_id = version.version_id;
    artifact.updated_at = new Date().toISOString();
    if (input.title) {
      artifact.title = input.title;
    }
    artifact.metadata = {
      ...artifact.metadata,
      ...cloneRecord(input.metadata)
    };
    return cloneArtifact(artifact);
  }

  public rollback(input: CanvasArtifactRollbackInput): CanvasArtifact {
    const artifact = this.requireArtifact(input.artifact_id);
    const target = input.target_version_id
      ? artifact.versions.find((version) => version.version_id === input.target_version_id)
      : artifact.versions.find((version) => version.version_no === input.target_version_no);
    if (!target) {
      throw new Error("Canvas artifact rollback target was not found.");
    }
    const current = this.currentVersion(artifact);
    const version = this.createVersion({
      html: target.sanitized_html,
      previousHtml: current.sanitized_html,
      versionNo: artifact.versions.length + 1,
      actorId: input.rolled_back_by,
      metadata: {
        rollback_of_version_id: target.version_id,
        rollback_of_version_no: target.version_no
      }
    });
    artifact.versions.push(version);
    artifact.current_version_id = version.version_id;
    artifact.updated_at = new Date().toISOString();
    return cloneArtifact(artifact);
  }

  public inspect(artifactId: string): CanvasArtifact | undefined {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? cloneArtifact(artifact) : undefined;
  }

  public list(query: { owner_id?: string; permission_scope?: string; limit?: number } = {}): CanvasArtifact[] {
    return [...this.artifacts.values()]
      .filter((artifact) => !query.owner_id || artifact.owner_id === query.owner_id)
      .filter((artifact) => !query.permission_scope || artifact.permission_scope === query.permission_scope)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, query.limit ?? 50)
      .map(cloneArtifact);
  }

  public preview(artifactId: string, versionId?: string): CanvasPreview {
    const artifact = this.requireArtifact(artifactId);
    const version = versionId
      ? artifact.versions.find((item) => item.version_id === versionId)
      : this.currentVersion(artifact);
    if (!version) {
      throw new Error(`Canvas artifact version was not found: ${versionId}`);
    }
    return {
      preview_id: `canvas_preview_${artifact.artifact_id}_${version.version_no}`,
      artifact_id: artifact.artifact_id,
      version_id: version.version_id,
      version_no: version.version_no,
      title: artifact.title,
      html: renderCanvasPreviewHtml(artifact.title, version.sanitized_html),
      content_security_policy: CANVAS_CSP,
      iframe_sandbox: IFRAME_SANDBOX
    };
  }

  private createVersion(input: {
    html: string;
    previousHtml: string;
    versionNo: number;
    actorId?: string;
    metadata?: Record<string, unknown>;
  }): CanvasArtifactVersion {
    const sanitized = sanitizeCanvasHtml(input.html);
    return {
      version_id: `canvas_ver_${randomUUID()}`,
      version_no: input.versionNo,
      html: input.html,
      sanitized_html: sanitized,
      diff: buildSimpleDiff(input.previousHtml, sanitized),
      created_at: new Date().toISOString(),
      created_by: input.actorId,
      metadata: cloneRecord(input.metadata)
    };
  }

  private requireArtifact(artifactId: string): CanvasArtifact {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Canvas artifact was not found: ${artifactId}`);
    }
    return artifact;
  }

  private currentVersion(artifact: CanvasArtifact): CanvasArtifactVersion {
    const version = artifact.versions.find((item) => item.version_id === artifact.current_version_id);
    if (!version) {
      throw new Error(`Current canvas version was not found: ${artifact.current_version_id}`);
    }
    return version;
  }
}

export function createCanvasArtifactTools(store: CanvasArtifactStore): Tool[] {
  return [
    createCanvasCreateTool(store),
    createCanvasUpdateTool(store),
    createCanvasPreviewTool(store),
    createCanvasRollbackTool(store),
    createCanvasListTool(store),
    createCanvasInspectTool(store)
  ];
}

function createCanvasCreateTool(store: CanvasArtifactStore): Tool {
  return {
    name: "canvas_artifact_create",
    description: "Create a versioned HTML canvas artifact with sanitized preview metadata.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: { type: "string" },
        title: { type: "string" },
        html: { type: "string" },
        owner_id: { type: "string" },
        permission_scope: { type: "string" },
        created_by: { type: "string" },
        metadata: { type: "object" }
      },
      required: ["title", "html", "owner_id"]
    },
    async invoke(input) {
      const artifact = store.create({
        artifact_id: readOptionalString(input.artifact_id),
        title: readRequiredString(input.title, "title"),
        html: readRequiredString(input.html, "html"),
        owner_id: readRequiredString(input.owner_id, "owner_id"),
        permission_scope: readOptionalString(input.permission_scope),
        created_by: readOptionalString(input.created_by),
        metadata: readRecord(input.metadata)
      });
      return {
        summary: `Created canvas artifact ${artifact.artifact_id} version 1.`,
        payload: toPayload({
          artifact: summarizeArtifact(artifact),
          preview: store.preview(artifact.artifact_id)
        })
      };
    }
  };
}

function createCanvasUpdateTool(store: CanvasArtifactStore): Tool {
  return {
    name: "canvas_artifact_update",
    description: "Create a new version for an existing HTML canvas artifact.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: { type: "string" },
        title: { type: "string" },
        html: { type: "string" },
        updated_by: { type: "string" },
        metadata: { type: "object" }
      },
      required: ["artifact_id", "html"]
    },
    async invoke(input) {
      const artifact = store.update({
        artifact_id: readRequiredString(input.artifact_id, "artifact_id"),
        title: readOptionalString(input.title),
        html: readRequiredString(input.html, "html"),
        updated_by: readOptionalString(input.updated_by),
        metadata: readRecord(input.metadata)
      });
      const current = currentArtifactVersion(artifact);
      return {
        summary: `Updated canvas artifact ${artifact.artifact_id} to version ${current.version_no}.`,
        payload: toPayload({
          artifact: summarizeArtifact(artifact),
          version: current,
          preview: store.preview(artifact.artifact_id)
        })
      };
    }
  };
}

function createCanvasPreviewTool(store: CanvasArtifactStore): Tool {
  return {
    name: "canvas_artifact_preview",
    description: "Render a safe preview for a canvas artifact version.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: { type: "string" },
        version_id: { type: "string" }
      },
      required: ["artifact_id"]
    },
    async invoke(input) {
      const preview = store.preview(
        readRequiredString(input.artifact_id, "artifact_id"),
        readOptionalString(input.version_id)
      );
      return {
        summary: `Rendered canvas preview ${preview.preview_id}.`,
        payload: toPayload({ preview })
      };
    }
  };
}

function createCanvasRollbackTool(store: CanvasArtifactStore): Tool {
  return {
    name: "canvas_artifact_rollback",
    description: "Roll back a canvas artifact by creating a new version from a previous version.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: { type: "string" },
        target_version_id: { type: "string" },
        target_version_no: { type: "number" },
        rolled_back_by: { type: "string" }
      },
      required: ["artifact_id"]
    },
    async invoke(input) {
      const artifact = store.rollback({
        artifact_id: readRequiredString(input.artifact_id, "artifact_id"),
        target_version_id: readOptionalString(input.target_version_id),
        target_version_no: readOptionalNumber(input.target_version_no),
        rolled_back_by: readOptionalString(input.rolled_back_by)
      });
      const current = currentArtifactVersion(artifact);
      return {
        summary: `Rolled back canvas artifact ${artifact.artifact_id} to version ${current.version_no}.`,
        payload: toPayload({
          artifact: summarizeArtifact(artifact),
          version: current,
          preview: store.preview(artifact.artifact_id)
        })
      };
    }
  };
}

function createCanvasListTool(store: CanvasArtifactStore): Tool {
  return {
    name: "canvas_artifact_list",
    description: "List canvas artifacts for an owner or permission scope.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        owner_id: { type: "string" },
        permission_scope: { type: "string" },
        limit: { type: "number" }
      }
    },
    async invoke(input) {
      const artifacts = store.list({
        owner_id: readOptionalString(input.owner_id),
        permission_scope: readOptionalString(input.permission_scope),
        limit: readOptionalNumber(input.limit)
      });
      return {
        summary: `Listed ${artifacts.length} canvas artifact${artifacts.length === 1 ? "" : "s"}.`,
        payload: toPayload({ artifacts: artifacts.map(summarizeArtifact) })
      };
    }
  };
}

function createCanvasInspectTool(store: CanvasArtifactStore): Tool {
  return {
    name: "canvas_artifact_inspect",
    description: "Inspect a canvas artifact and its version history.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        artifact_id: { type: "string" }
      },
      required: ["artifact_id"]
    },
    async invoke(input) {
      const artifact = store.inspect(readRequiredString(input.artifact_id, "artifact_id"));
      if (!artifact) {
        throw new Error("Canvas artifact was not found.");
      }
      return {
        summary: `Inspected canvas artifact ${artifact.artifact_id} with ${artifact.versions.length} versions.`,
        payload: toPayload({ artifact })
      };
    }
  };
}

export function sanitizeCanvasHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[\s\S]*?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+(href|src)\s*=\s*"javascript:[^"]*"/gi, " $1=\"#blocked\"")
    .replace(/\s+(href|src)\s*=\s*'javascript:[^']*'/gi, " $1=\"#blocked\"")
    .replace(/\s+(href|src)\s*=\s*javascript:[^\s>]+/gi, " $1=\"#blocked\"");
}

function renderCanvasPreviewHtml(title: string, sanitizedHtml: string): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CANVAS_CSP)}">`,
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    sanitizedHtml,
    "</body>",
    "</html>"
  ].join("");
}

function buildSimpleDiff(before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const previous = beforeLines[index];
    const next = afterLines[index];
    if (previous === next) {
      if (typeof next === "string" && next.length > 0) {
        lines.push(` ${next}`);
      }
      continue;
    }
    if (typeof previous === "string" && previous.length > 0) {
      lines.push(`-${previous}`);
    }
    if (typeof next === "string" && next.length > 0) {
      lines.push(`+${next}`);
    }
  }
  return lines.join("\n").slice(0, 16_000);
}

function summarizeArtifact(artifact: CanvasArtifact): Record<string, unknown> {
  const current = currentArtifactVersion(artifact);
  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    owner_id: artifact.owner_id,
    permission_scope: artifact.permission_scope,
    current_version_id: artifact.current_version_id,
    current_version_no: current.version_no,
    version_count: artifact.versions.length,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    metadata: artifact.metadata
  };
}

function currentArtifactVersion(artifact: CanvasArtifact): CanvasArtifactVersion {
  const version = artifact.versions.find((item) => item.version_id === artifact.current_version_id);
  if (!version) {
    throw new Error("Current canvas artifact version is missing.");
  }
  return version;
}

function cloneArtifact(artifact: CanvasArtifact): CanvasArtifact {
  return {
    ...artifact,
    metadata: cloneRecord(artifact.metadata),
    versions: artifact.versions.map((version) => ({
      ...version,
      metadata: cloneRecord(version.metadata)
    }))
  };
}

function cloneRecord(record: Record<string, unknown> | undefined): Record<string, unknown> {
  return record ? { ...record } : {};
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toPayload(value: Record<string, unknown>): Record<string, JsonValue | undefined> {
  return value as Record<string, JsonValue | undefined>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
