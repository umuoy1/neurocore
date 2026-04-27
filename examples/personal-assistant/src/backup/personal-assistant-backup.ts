import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { JsonValue, Tool } from "@neurocore/protocol";

export type PersonalAssistantBackupFileKind = "home" | "sqlite" | "config" | "artifact" | "skill" | "vault" | "profile" | "other";
export type PersonalAssistantRestoreFileStatus = "created" | "overwritten" | "unchanged" | "conflict" | "would_create" | "would_overwrite" | "would_skip_unchanged";

export interface PersonalAssistantBackupSource {
  home_dir?: string;
  db_path?: string;
  config_paths?: string[];
  artifact_paths?: string[];
  skill_paths?: string[];
  vault_paths?: string[];
  profile_paths?: string[];
  metadata?: Record<string, JsonValue>;
  max_file_bytes?: number;
}

export interface PersonalAssistantBackupOptions {
  backup_path: string;
  passphrase: string;
  source: PersonalAssistantBackupSource;
  created_at?: string;
}

export interface PersonalAssistantReadBackupManifestOptions {
  backup_path: string;
  passphrase: string;
}

export interface PersonalAssistantRestoreOptions {
  backup_path: string;
  passphrase: string;
  target_home_dir: string;
  dry_run?: boolean;
  overwrite?: boolean;
}

export interface PersonalAssistantBackupManifestFile {
  path: string;
  kind: PersonalAssistantBackupFileKind;
  sha256: string;
  bytes: number;
  updated_at: string;
}

export interface PersonalAssistantBackupManifest {
  schema_version: "personal-assistant-backup.manifest.v1";
  backup_id: string;
  created_at: string;
  source_summary: {
    has_home_dir: boolean;
    has_db_path: boolean;
    explicit_config_count: number;
    explicit_artifact_count: number;
    explicit_skill_count: number;
    explicit_vault_count: number;
    explicit_profile_count: number;
    metadata?: Record<string, JsonValue>;
  };
  file_count: number;
  total_bytes: number;
  files: PersonalAssistantBackupManifestFile[];
}

export interface PersonalAssistantBackupCreateReport {
  backup_id: string;
  backup_path: string;
  encrypted: true;
  envelope_sha256: string;
  plaintext_payload_sha256: string;
  manifest: PersonalAssistantBackupManifest;
}

export interface PersonalAssistantRestoreFileResult {
  path: string;
  kind: PersonalAssistantBackupFileKind;
  status: PersonalAssistantRestoreFileStatus;
  sha256: string;
  bytes: number;
  target_path: string;
}

export interface PersonalAssistantRestoreConflict {
  path: string;
  local_sha256: string;
  backup_sha256: string;
  resolution: "manual_required" | "overwrite_available";
  message: string;
}

export interface PersonalAssistantRestoreReport {
  restore_id: string;
  backup_id: string;
  target_home_dir: string;
  dry_run: boolean;
  overwrite: boolean;
  created_at: string;
  file_count: number;
  restored_count: number;
  conflict_count: number;
  files: PersonalAssistantRestoreFileResult[];
  conflicts: PersonalAssistantRestoreConflict[];
  manifest: PersonalAssistantBackupManifest;
}

export interface PersonalAssistantSyncConflict {
  path: string;
  local_sha256: string;
  remote_sha256: string;
  local_updated_at: string;
  remote_updated_at: string;
  resolution: "manual_review_required";
  message: string;
}

export interface PersonalAssistantSyncReport {
  schema_version: "personal-assistant-sync-report.v1";
  generated_at: string;
  local_backup_id: string;
  remote_backup_id: string;
  summary: string;
  identical_count: number;
  local_only_count: number;
  remote_only_count: number;
  conflict_count: number;
  conflicts: PersonalAssistantSyncConflict[];
  local_only: PersonalAssistantBackupManifestFile[];
  remote_only: PersonalAssistantBackupManifestFile[];
}

interface PersonalAssistantBackupPayload {
  schema_version: "personal-assistant-backup.payload.v1";
  manifest: PersonalAssistantBackupManifest;
  files: PersonalAssistantBackupPayloadFile[];
}

interface PersonalAssistantBackupPayloadFile extends PersonalAssistantBackupManifestFile {
  content_base64: string;
}

interface EncryptedBackupEnvelope {
  schema_version: "personal-assistant-backup.encrypted.v1";
  encryption: {
    algorithm: "aes-256-gcm";
    kdf: "scrypt";
    salt: string;
    iv: string;
    auth_tag: string;
  };
  payload_sha256: string;
  ciphertext: string;
}

interface PersonalAssistantBackupServiceOptions {
  now?: () => string;
  generateId?: (prefix: string) => string;
}

export class PersonalAssistantBackupService {
  private readonly now: () => string;
  private readonly generateId: (prefix: string) => string;

  public constructor(options: PersonalAssistantBackupServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  public createBackup(input: PersonalAssistantBackupOptions): PersonalAssistantBackupCreateReport {
    const passphrase = readRequiredString(input.passphrase, "passphrase");
    const backupPath = resolve(readRequiredString(input.backup_path, "backup_path"));
    const createdAt = input.created_at ?? this.now();
    const files = collectBackupFiles(input.source, backupPath);
    const manifest = buildManifest(this.generateId("backup"), createdAt, input.source, files);
    const payload: PersonalAssistantBackupPayload = {
      schema_version: "personal-assistant-backup.payload.v1",
      manifest,
      files
    };
    const payloadJson = JSON.stringify(payload);
    const payloadSha256 = hashBuffer(Buffer.from(payloadJson, "utf8"));
    const envelope = encryptPayload(payloadJson, passphrase, payloadSha256);
    const envelopeJson = `${JSON.stringify(envelope, null, 2)}\n`;
    mkdirSync(dirname(backupPath), { recursive: true });
    writeFileSync(backupPath, envelopeJson, "utf8");

    return {
      backup_id: manifest.backup_id,
      backup_path: backupPath,
      encrypted: true,
      envelope_sha256: hashBuffer(Buffer.from(envelopeJson, "utf8")),
      plaintext_payload_sha256: payloadSha256,
      manifest
    };
  }

  public readManifest(input: PersonalAssistantReadBackupManifestOptions): PersonalAssistantBackupManifest {
    return this.readPayload(input).manifest;
  }

  public restoreBackup(input: PersonalAssistantRestoreOptions): PersonalAssistantRestoreReport {
    const payload = this.readPayload({
      backup_path: input.backup_path,
      passphrase: input.passphrase
    });
    const targetHomeDir = resolve(readRequiredString(input.target_home_dir, "target_home_dir"));
    const dryRun = input.dry_run === true;
    const overwrite = input.overwrite === true;
    const files: PersonalAssistantRestoreFileResult[] = [];
    const conflicts: PersonalAssistantRestoreConflict[] = [];
    if (!dryRun) {
      mkdirSync(targetHomeDir, { recursive: true });
    }

    for (const file of payload.files) {
      const targetPath = resolveSafeTarget(targetHomeDir, file.path);
      const existing = existsSync(targetPath) ? readFileSync(targetPath) : undefined;
      const existingSha256 = existing ? hashBuffer(existing) : undefined;
      const same = existingSha256 === file.sha256;
      let status: PersonalAssistantRestoreFileStatus;

      if (same) {
        status = dryRun ? "would_skip_unchanged" : "unchanged";
      } else if (existing && !overwrite) {
        status = "conflict";
        conflicts.push({
          path: file.path,
          local_sha256: existingSha256 ?? "",
          backup_sha256: file.sha256,
          resolution: "manual_required",
          message: `Conflict at ${file.path}: target file differs from backup. Re-run with overwrite=true or merge manually.`
        });
      } else if (existing && overwrite) {
        status = dryRun ? "would_overwrite" : "overwritten";
      } else {
        status = "created";
        if (dryRun) {
          status = "would_create";
        }
      }

      if (!dryRun && status !== "conflict" && status !== "unchanged") {
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, Buffer.from(file.content_base64, "base64"));
      }

      files.push({
        path: file.path,
        kind: file.kind,
        status,
        sha256: file.sha256,
        bytes: file.bytes,
        target_path: targetPath
      });
    }

    return {
      restore_id: this.generateId("restore"),
      backup_id: payload.manifest.backup_id,
      target_home_dir: targetHomeDir,
      dry_run: dryRun,
      overwrite,
      created_at: this.now(),
      file_count: files.length,
      restored_count: files.filter((file) => file.status === "created" || file.status === "overwritten").length,
      conflict_count: conflicts.length,
      files,
      conflicts,
      manifest: payload.manifest
    };
  }

  public createSyncReport(input: {
    local_manifest: PersonalAssistantBackupManifest;
    remote_manifest: PersonalAssistantBackupManifest;
  }): PersonalAssistantSyncReport {
    const localByPath = new Map(input.local_manifest.files.map((file) => [file.path, file]));
    const remoteByPath = new Map(input.remote_manifest.files.map((file) => [file.path, file]));
    const conflicts: PersonalAssistantSyncConflict[] = [];
    const localOnly: PersonalAssistantBackupManifestFile[] = [];
    const remoteOnly: PersonalAssistantBackupManifestFile[] = [];
    let identicalCount = 0;

    for (const [path, local] of localByPath.entries()) {
      const remote = remoteByPath.get(path);
      if (!remote) {
        localOnly.push(local);
      } else if (remote.sha256 === local.sha256) {
        identicalCount += 1;
      } else {
        conflicts.push({
          path,
          local_sha256: local.sha256,
          remote_sha256: remote.sha256,
          local_updated_at: local.updated_at,
          remote_updated_at: remote.updated_at,
          resolution: "manual_review_required",
          message: `Conflict at ${path}: local backup ${input.local_manifest.backup_id} and remote backup ${input.remote_manifest.backup_id} contain different bytes.`
        });
      }
    }

    for (const [path, remote] of remoteByPath.entries()) {
      if (!localByPath.has(path)) {
        remoteOnly.push(remote);
      }
    }

    const conflictCount = conflicts.length;
    return {
      schema_version: "personal-assistant-sync-report.v1",
      generated_at: this.now(),
      local_backup_id: input.local_manifest.backup_id,
      remote_backup_id: input.remote_manifest.backup_id,
      summary: conflictCount > 0
        ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"} require manual review before sync.`
        : "No content conflicts detected.",
      identical_count: identicalCount,
      local_only_count: localOnly.length,
      remote_only_count: remoteOnly.length,
      conflict_count: conflictCount,
      conflicts,
      local_only: localOnly,
      remote_only: remoteOnly
    };
  }

  private readPayload(input: PersonalAssistantReadBackupManifestOptions): PersonalAssistantBackupPayload {
    const backupPath = resolve(readRequiredString(input.backup_path, "backup_path"));
    const passphrase = readRequiredString(input.passphrase, "passphrase");
    const envelope = readEncryptedEnvelope(backupPath);
    const payloadJson = decryptPayload(envelope, passphrase);
    if (hashBuffer(Buffer.from(payloadJson, "utf8")) !== envelope.payload_sha256) {
      throw new Error("Backup payload checksum mismatch.");
    }
    const payload = JSON.parse(payloadJson) as PersonalAssistantBackupPayload;
    validatePayload(payload);
    return payload;
  }
}

export function createPersonalAssistantBackupTools(service: PersonalAssistantBackupService): Tool[] {
  return [
    {
      name: "personal_backup_create",
      description: "Create an encrypted personal assistant backup from HOME, SQLite, config, skills and artifact paths.",
      sideEffectLevel: "high",
      inputSchema: {
        type: "object",
        properties: {
          backup_path: { type: "string" },
          passphrase: { type: "string" },
          home_dir: { type: "string" },
          db_path: { type: "string" },
          config_paths: { type: "array", items: { type: "string" } },
          artifact_paths: { type: "array", items: { type: "string" } },
          skill_paths: { type: "array", items: { type: "string" } },
          vault_paths: { type: "array", items: { type: "string" } },
          profile_paths: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
          max_file_bytes: { type: "number" }
        },
        required: ["backup_path", "passphrase"]
      },
      async invoke(input) {
        const report = service.createBackup({
          backup_path: readRequiredString(input.backup_path, "backup_path"),
          passphrase: readRequiredString(input.passphrase, "passphrase"),
          source: {
            home_dir: readOptionalString(input.home_dir),
            db_path: readOptionalString(input.db_path),
            config_paths: readStringArray(input.config_paths),
            artifact_paths: readStringArray(input.artifact_paths),
            skill_paths: readStringArray(input.skill_paths),
            vault_paths: readStringArray(input.vault_paths),
            profile_paths: readStringArray(input.profile_paths),
            metadata: readJsonRecord(input.metadata),
            max_file_bytes: readOptionalNumber(input.max_file_bytes)
          }
        });
        return {
          summary: `Created encrypted backup ${report.backup_id} with ${report.manifest.file_count} file${report.manifest.file_count === 1 ? "" : "s"}.`,
          payload: { report: report as unknown as JsonValue }
        };
      }
    },
    {
      name: "personal_backup_restore",
      description: "Restore an encrypted personal assistant backup into a target HOME, with dry-run and conflict reporting.",
      sideEffectLevel: "high",
      inputSchema: {
        type: "object",
        properties: {
          backup_path: { type: "string" },
          passphrase: { type: "string" },
          target_home_dir: { type: "string" },
          dry_run: { type: "boolean" },
          overwrite: { type: "boolean" }
        },
        required: ["backup_path", "passphrase", "target_home_dir"]
      },
      async invoke(input) {
        const report = service.restoreBackup({
          backup_path: readRequiredString(input.backup_path, "backup_path"),
          passphrase: readRequiredString(input.passphrase, "passphrase"),
          target_home_dir: readRequiredString(input.target_home_dir, "target_home_dir"),
          dry_run: input.dry_run === true,
          overwrite: input.overwrite === true
        });
        return {
          summary: `${report.dry_run ? "Dry-run restore" : "Restore"} checked ${report.file_count} file${report.file_count === 1 ? "" : "s"} with ${report.conflict_count} conflict${report.conflict_count === 1 ? "" : "s"}.`,
          payload: { report: report as unknown as JsonValue }
        };
      }
    },
    {
      name: "personal_backup_manifest",
      description: "Read the manifest from an encrypted personal assistant backup without exposing backup file contents.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          backup_path: { type: "string" },
          passphrase: { type: "string" }
        },
        required: ["backup_path", "passphrase"]
      },
      async invoke(input) {
        const manifest = service.readManifest({
          backup_path: readRequiredString(input.backup_path, "backup_path"),
          passphrase: readRequiredString(input.passphrase, "passphrase")
        });
        return {
          summary: `Backup ${manifest.backup_id} contains ${manifest.file_count} file${manifest.file_count === 1 ? "" : "s"}.`,
          payload: { manifest: manifest as unknown as JsonValue }
        };
      }
    },
    {
      name: "personal_backup_sync_report",
      description: "Compare two encrypted personal assistant backups and produce a readable sync conflict report.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          local_backup_path: { type: "string" },
          remote_backup_path: { type: "string" },
          passphrase: { type: "string" },
          local_passphrase: { type: "string" },
          remote_passphrase: { type: "string" }
        },
        required: ["local_backup_path", "remote_backup_path"]
      },
      async invoke(input) {
        const defaultPassphrase = readOptionalString(input.passphrase);
        const localPassphrase = readOptionalString(input.local_passphrase) ?? defaultPassphrase;
        const remotePassphrase = readOptionalString(input.remote_passphrase) ?? defaultPassphrase;
        if (!localPassphrase || !remotePassphrase) {
          throw new Error("passphrase, or both local_passphrase and remote_passphrase, is required.");
        }
        const localManifest = service.readManifest({
          backup_path: readRequiredString(input.local_backup_path, "local_backup_path"),
          passphrase: localPassphrase
        });
        const remoteManifest = service.readManifest({
          backup_path: readRequiredString(input.remote_backup_path, "remote_backup_path"),
          passphrase: remotePassphrase
        });
        const report = service.createSyncReport({
          local_manifest: localManifest,
          remote_manifest: remoteManifest
        });
        return {
          summary: report.summary,
          payload: { report: report as unknown as JsonValue }
        };
      }
    }
  ];
}

function collectBackupFiles(source: PersonalAssistantBackupSource, backupPath: string): PersonalAssistantBackupPayloadFile[] {
  const maxFileBytes = source.max_file_bytes ?? 64 * 1024 * 1024;
  const homeDir = source.home_dir ? resolve(source.home_dir) : undefined;
  const filesByPath = new Map<string, PersonalAssistantBackupPayloadFile>();

  if (homeDir) {
    for (const filePath of listFiles(homeDir, backupPath, maxFileBytes)) {
      const relativePath = toSafeRelativePath(relative(homeDir, filePath));
      filesByPath.set(relativePath, readPayloadFile(filePath, relativePath, "home"));
    }
  }

  if (source.db_path) {
    for (const filePath of sqliteSidecarPaths(source.db_path)) {
      addExplicitFile(filesByPath, filePath, "sqlite", homeDir, maxFileBytes);
    }
  }
  for (const filePath of source.config_paths ?? []) {
    addExplicitFile(filesByPath, filePath, "config", homeDir, maxFileBytes);
  }
  for (const filePath of source.artifact_paths ?? []) {
    addExplicitFile(filesByPath, filePath, "artifact", homeDir, maxFileBytes);
  }
  for (const filePath of source.skill_paths ?? []) {
    addExplicitFile(filesByPath, filePath, "skill", homeDir, maxFileBytes);
  }
  for (const filePath of source.vault_paths ?? []) {
    addExplicitFile(filesByPath, filePath, "vault", homeDir, maxFileBytes);
  }
  for (const filePath of source.profile_paths ?? []) {
    addExplicitFile(filesByPath, filePath, "profile", homeDir, maxFileBytes);
  }

  if (filesByPath.size === 0) {
    throw new Error("Backup source contains no files.");
  }

  return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function addExplicitFile(
  filesByPath: Map<string, PersonalAssistantBackupPayloadFile>,
  filePath: string,
  kind: PersonalAssistantBackupFileKind,
  homeDir: string | undefined,
  maxFileBytes: number
): void {
  const absolutePath = resolve(filePath);
  assertReadableFile(absolutePath, maxFileBytes);
  const destinationPath = homeDir && isInside(homeDir, absolutePath)
    ? toSafeRelativePath(relative(homeDir, absolutePath))
    : toSafeRelativePath(`external/${kind}/${basename(absolutePath)}`);
  filesByPath.set(destinationPath, readPayloadFile(absolutePath, destinationPath, kind));
}

function listFiles(root: string, backupPath: string, maxFileBytes: number): string[] {
  const result: string[] = [];
  if (!existsSync(root)) {
    throw new Error(`Backup home_dir does not exist: ${root}`);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (shouldSkipEntry(entry.name)) {
      continue;
    }
    const entryPath = resolve(root, entry.name);
    if (entryPath === backupPath) {
      continue;
    }
    if (entry.isDirectory()) {
      result.push(...listFiles(entryPath, backupPath, maxFileBytes));
    } else if (entry.isFile()) {
      assertReadableFile(entryPath, maxFileBytes);
      result.push(entryPath);
    }
  }
  return result;
}

function sqliteSidecarPaths(dbPath: string): string[] {
  const absolutePath = resolve(dbPath);
  return [absolutePath, `${absolutePath}-wal`, `${absolutePath}-shm`].filter((filePath) => existsSync(filePath));
}

function readPayloadFile(
  absolutePath: string,
  path: string,
  kind: PersonalAssistantBackupFileKind
): PersonalAssistantBackupPayloadFile {
  const content = readFileSync(absolutePath);
  const stats = statSync(absolutePath);
  return {
    path,
    kind,
    sha256: hashBuffer(content),
    bytes: content.byteLength,
    updated_at: stats.mtime.toISOString(),
    content_base64: content.toString("base64")
  };
}

function buildManifest(
  backupId: string,
  createdAt: string,
  source: PersonalAssistantBackupSource,
  files: PersonalAssistantBackupPayloadFile[]
): PersonalAssistantBackupManifest {
  return {
    schema_version: "personal-assistant-backup.manifest.v1",
    backup_id: backupId,
    created_at: createdAt,
    source_summary: {
      has_home_dir: Boolean(source.home_dir),
      has_db_path: Boolean(source.db_path),
      explicit_config_count: source.config_paths?.length ?? 0,
      explicit_artifact_count: source.artifact_paths?.length ?? 0,
      explicit_skill_count: source.skill_paths?.length ?? 0,
      explicit_vault_count: source.vault_paths?.length ?? 0,
      explicit_profile_count: source.profile_paths?.length ?? 0,
      metadata: source.metadata
    },
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files: files.map(({ content_base64: _contentBase64, ...file }) => file)
  };
}

function encryptPayload(payloadJson: string, passphrase: string, payloadSha256: string): EncryptedBackupEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(payloadJson, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return {
    schema_version: "personal-assistant-backup.encrypted.v1",
    encryption: {
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      auth_tag: authTag.toString("base64")
    },
    payload_sha256: payloadSha256,
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptPayload(envelope: EncryptedBackupEnvelope, passphrase: string): string {
  const salt = Buffer.from(envelope.encryption.salt, "base64");
  const iv = Buffer.from(envelope.encryption.iv, "base64");
  const authTag = Buffer.from(envelope.encryption.auth_tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8");
}

function readEncryptedEnvelope(backupPath: string): EncryptedBackupEnvelope {
  const value = JSON.parse(readFileSync(backupPath, "utf8")) as EncryptedBackupEnvelope;
  if (value.schema_version !== "personal-assistant-backup.encrypted.v1") {
    throw new Error("Unsupported backup envelope schema.");
  }
  if (value.encryption?.algorithm !== "aes-256-gcm" || value.encryption.kdf !== "scrypt") {
    throw new Error("Unsupported backup encryption settings.");
  }
  return value;
}

function validatePayload(payload: PersonalAssistantBackupPayload): void {
  if (payload.schema_version !== "personal-assistant-backup.payload.v1") {
    throw new Error("Unsupported backup payload schema.");
  }
  if (payload.manifest.schema_version !== "personal-assistant-backup.manifest.v1") {
    throw new Error("Unsupported backup manifest schema.");
  }
  if (payload.manifest.file_count !== payload.files.length) {
    throw new Error("Backup manifest file count mismatch.");
  }
  for (const file of payload.files) {
    if (hashBuffer(Buffer.from(file.content_base64, "base64")) !== file.sha256) {
      throw new Error(`Backup file checksum mismatch: ${file.path}`);
    }
  }
}

function resolveSafeTarget(root: string, path: string): string {
  const safeRelativePath = toSafeRelativePath(path);
  const absolutePath = resolve(root, safeRelativePath);
  if (!isInside(root, absolutePath) && absolutePath !== root) {
    throw new Error(`Backup path escapes target home: ${path}`);
  }
  return absolutePath;
}

function toSafeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(`Unsafe backup path: ${path}`);
  }
  return parts.join("/");
}

function assertReadableFile(path: string, maxFileBytes: number): void {
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new Error(`Backup source is not a file: ${path}`);
  }
  if (stats.size > maxFileBytes) {
    throw new Error(`Backup source exceeds max_file_bytes: ${path}`);
  }
}

function isInside(root: string, path: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return normalizedPath !== normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function shouldSkipEntry(name: string): boolean {
  return name === ".DS_Store" || name === ".git" || name === "node_modules";
}

function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readJsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, JsonValue>;
}
