import { createHash } from "node:crypto";
import type { CycleTraceRecord, SessionReplay } from "@neurocore/protocol";

export type PersonalAgentRedactionKind = "secret" | "email" | "phone" | "private_id";

export interface PersonalAgentRedactionFinding {
  path: string;
  kind: PersonalAgentRedactionKind;
  replacement: string;
}

export interface PersonalAgentRedactionReport {
  applied: boolean;
  finding_count: number;
  findings: PersonalAgentRedactionFinding[];
}

export interface PersonalAgentTrajectoryReplayStep {
  step_index: number;
  trace_id: string;
  cycle_id: string;
  input: string;
  selected_action?: {
    action_id: string;
    action_type: string;
    title: string;
    tool_name?: string;
  };
  observation_summary?: string;
  output?: string;
}

export interface PersonalAgentTraceProvenance {
  trace_id: string;
  cycle_id: string;
  input_refs: string[];
  selected_action_ref?: string;
  observation_refs: string[];
}

export interface PersonalAgentMemoryProvenance {
  source: "trace_recall_bundle" | "attached_memory_record";
  trace_id?: string;
  cycle_id?: string;
  bundle_id?: string;
  plan_id?: string;
  memory_refs: Array<{
    memory_id: string;
    memory_type?: string;
    relevance?: number;
    summary?: string;
  }>;
}

export interface PersonalAgentToolProvenance {
  trace_id: string;
  cycle_id: string;
  action_id?: string;
  tool_name?: string;
  title?: string;
  observation_id?: string;
  status?: string;
  result_ref?: string;
  structured_payload?: Record<string, unknown>;
}

export interface PersonalAgentTrajectoryExportOptions {
  exportId?: string;
  createdAt?: string;
  sessionReplay: SessionReplay;
  channel?: Record<string, unknown>;
  identity?: Record<string, unknown>;
  agentProfile?: Record<string, unknown>;
  memoryRecords?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  redaction?: {
    enabled?: boolean;
    additionalSecretKeys?: string[];
    additionalPrivateIdKeys?: string[];
  };
}

export interface PersonalAgentTrajectoryExport {
  schema_version: "personal-agent-trajectory.v1";
  export_id: string;
  created_at: string;
  session_id: string;
  cycle_count: number;
  final_output?: string;
  channel?: Record<string, unknown>;
  identity?: Record<string, unknown>;
  agent_profile?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  trace_records: CycleTraceRecord[];
  provenance: {
    traces: PersonalAgentTraceProvenance[];
    memory: PersonalAgentMemoryProvenance[];
    tools: PersonalAgentToolProvenance[];
  };
  replay: {
    deterministic: true;
    trace_signature: string;
    replay_signature: string;
    steps: PersonalAgentTrajectoryReplayStep[];
  };
  attachments: {
    memory_records: Array<Record<string, unknown>>;
  };
  redaction: PersonalAgentRedactionReport;
}

export interface PersonalAgentTrajectoryBenchmarkCase {
  case_id: string;
  source_export_id: string;
  session_id: string;
  input_texts: string[];
  expected_final_output?: string;
  trace_signature: string;
  replay_signature: string;
  replay_steps: PersonalAgentTrajectoryReplayStep[];
  memory_refs: string[];
  tool_refs: string[];
  redaction: PersonalAgentRedactionReport;
}

export interface PersonalAgentTrajectoryBenchmarkArtifact {
  schema_version: "personal-agent-benchmark.v1";
  artifact_id: string;
  created_at: string;
  deterministic_replay: true;
  source_export_ids: string[];
  cases: PersonalAgentTrajectoryBenchmarkCase[];
}

export interface PersonalAgentTrajectoryReplayCaseReport {
  case_id: string;
  passed: boolean;
  final_output?: string;
  replay_signature: string;
  expected_replay_signature: string;
  reason?: string;
}

export interface PersonalAgentTrajectoryReplayReport {
  artifact_id: string;
  case_count: number;
  passed_count: number;
  failed_count: number;
  cases: PersonalAgentTrajectoryReplayCaseReport[];
}

export interface PersonalAgentTrajectoryCompressionReport {
  applied: boolean;
  max_chars_per_field: number;
  truncated_field_count: number;
  original_trace_count: number;
  compressed_record_count: number;
}

export interface PersonalAgentTrajectoryTrainingRecord {
  record_id: string;
  source_export_id: string;
  session_id: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  expected_final_output?: string;
  trace_signature: string;
  replay_signature: string;
  tool_refs: string[];
  memory_refs: string[];
  redaction: PersonalAgentRedactionReport;
}

export interface PersonalAgentTrajectoryTrainingArtifact {
  schema_version: "personal-agent-training.v1";
  artifact_id: string;
  created_at: string;
  source_export_ids: string[];
  compression: PersonalAgentTrajectoryCompressionReport;
  redaction: PersonalAgentRedactionReport;
  records: PersonalAgentTrajectoryTrainingRecord[];
}

export interface PersonalAgentTrajectoryPipelineValidationReport {
  valid: boolean;
  errors: string[];
  case_count: number;
  training_record_count: number;
  replay_passed_count: number;
}

export interface PersonalAgentTrajectoryPipelineArtifact {
  schema_version: "personal-agent-trajectory-pipeline.v1";
  artifact_id: string;
  batch_id: string;
  created_at: string;
  exports: PersonalAgentTrajectoryExport[];
  benchmark: PersonalAgentTrajectoryBenchmarkArtifact;
  training: PersonalAgentTrajectoryTrainingArtifact;
  replay_report: PersonalAgentTrajectoryReplayReport;
  validation: PersonalAgentTrajectoryPipelineValidationReport;
}

export function exportPersonalAgentTrajectory(
  options: PersonalAgentTrajectoryExportOptions
): PersonalAgentTrajectoryExport {
  const steps = buildReplaySteps(options.sessionReplay.traces);
  const raw: PersonalAgentTrajectoryExport = {
    schema_version: "personal-agent-trajectory.v1",
    export_id: options.exportId ?? createHashId("pat", options.sessionReplay.session_id, options.createdAt ?? ""),
    created_at: options.createdAt ?? new Date().toISOString(),
    session_id: options.sessionReplay.session_id,
    cycle_count: options.sessionReplay.cycle_count,
    final_output: options.sessionReplay.final_output,
    channel: options.channel,
    identity: options.identity,
    agent_profile: options.agentProfile,
    metadata: options.metadata ?? {},
    trace_records: options.sessionReplay.traces,
    provenance: collectProvenance(options.sessionReplay.traces, options.memoryRecords ?? []),
    replay: {
      deterministic: true,
      trace_signature: "",
      replay_signature: "",
      steps
    },
    attachments: {
      memory_records: options.memoryRecords ?? []
    },
    redaction: {
      applied: false,
      finding_count: 0,
      findings: []
    }
  };

  const redacted = redactPersonalAgentValue(raw, options.redaction);
  const exported = redacted.value as PersonalAgentTrajectoryExport;
  exported.replay.trace_signature = hashStable(exported.trace_records);
  exported.replay.replay_signature = computeReplaySignature(exported.replay.steps, exported.final_output);
  exported.redaction = redacted.report;
  return exported;
}

export function redactPersonalAgentValue<T>(
  value: T,
  options: PersonalAgentTrajectoryExportOptions["redaction"] = {}
): { value: T; report: PersonalAgentRedactionReport } {
  if (options.enabled === false) {
    return {
      value,
      report: {
        applied: false,
        finding_count: 0,
        findings: []
      }
    };
  }

  const findings: PersonalAgentRedactionFinding[] = [];
  const idMap = new Map<string, string>();
  const secretKeys = new Set([...defaultSecretKeys, ...(options.additionalSecretKeys ?? []).map(normalizeKey)]);
  const privateIdKeys = new Set([...defaultPrivateIdKeys, ...(options.additionalPrivateIdKeys ?? []).map(normalizeKey)]);

  const redacted = redactNode(value, {
    path: "$",
    key: undefined,
    findings,
    idMap,
    secretKeys,
    privateIdKeys
  }) as T;

  return {
    value: redacted,
    report: {
      applied: findings.length > 0,
      finding_count: findings.length,
      findings
    }
  };
}

export function buildPersonalAgentTrajectoryBenchmarkArtifact(
  exports: PersonalAgentTrajectoryExport[],
  options: { artifactId?: string; createdAt?: string; caseIds?: string[] } = {}
): PersonalAgentTrajectoryBenchmarkArtifact {
  const allowedCaseIds = options.caseIds ? new Set(options.caseIds) : undefined;
  const cases = exports
    .map((item, index) => toBenchmarkCase(item, index))
    .filter((item) => !allowedCaseIds || allowedCaseIds.has(item.case_id));

  return {
    schema_version: "personal-agent-benchmark.v1",
    artifact_id: options.artifactId ?? createHashId("pab", ...exports.map((item) => item.export_id)),
    created_at: options.createdAt ?? new Date().toISOString(),
    deterministic_replay: true,
    source_export_ids: exports.map((item) => item.export_id),
    cases
  };
}

export function replayPersonalAgentTrajectoryBenchmarkArtifact(
  artifact: PersonalAgentTrajectoryBenchmarkArtifact
): PersonalAgentTrajectoryReplayReport {
  const cases = artifact.cases.map((item) => {
    const replaySignature = computeReplaySignature(item.replay_steps, item.expected_final_output);
    const finalOutput = item.replay_steps.at(-1)?.output ?? item.expected_final_output;
    const passed = replaySignature === item.replay_signature;
    return {
      case_id: item.case_id,
      passed,
      final_output: finalOutput,
      replay_signature: replaySignature,
      expected_replay_signature: item.replay_signature,
      reason: passed ? undefined : "replay signature mismatch"
    };
  });

  return {
    artifact_id: artifact.artifact_id,
    case_count: cases.length,
    passed_count: cases.filter((item) => item.passed).length,
    failed_count: cases.filter((item) => !item.passed).length,
    cases
  };
}

export function buildPersonalAgentTrajectoryTrainingArtifact(
  exports: PersonalAgentTrajectoryExport[],
  options: {
    artifactId?: string;
    createdAt?: string;
    maxCharsPerField?: number;
  } = {}
): PersonalAgentTrajectoryTrainingArtifact {
  const maxCharsPerField = options.maxCharsPerField ?? 4000;
  const compression: PersonalAgentTrajectoryCompressionReport = {
    applied: false,
    max_chars_per_field: maxCharsPerField,
    truncated_field_count: 0,
    original_trace_count: exports.reduce((count, item) => count + item.trace_records.length, 0),
    compressed_record_count: exports.length
  };
  const records = exports.map((trajectory) => toTrainingRecord(trajectory, compression));
  return {
    schema_version: "personal-agent-training.v1",
    artifact_id: options.artifactId ?? createHashId("patrain", ...exports.map((item) => item.export_id)),
    created_at: options.createdAt ?? new Date().toISOString(),
    source_export_ids: exports.map((item) => item.export_id),
    compression,
    redaction: aggregateRedaction(exports.map((item) => item.redaction)),
    records
  };
}

export function buildPersonalAgentTrajectoryPipelineArtifact(
  exports: PersonalAgentTrajectoryExport[],
  options: {
    artifactId?: string;
    batchId?: string;
    createdAt?: string;
    benchmarkArtifactId?: string;
    trainingArtifactId?: string;
    maxCharsPerField?: number;
  } = {}
): PersonalAgentTrajectoryPipelineArtifact {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const benchmark = buildPersonalAgentTrajectoryBenchmarkArtifact(exports, {
    artifactId: options.benchmarkArtifactId,
    createdAt
  });
  const training = buildPersonalAgentTrajectoryTrainingArtifact(exports, {
    artifactId: options.trainingArtifactId,
    createdAt,
    maxCharsPerField: options.maxCharsPerField
  });
  const replayReport = replayPersonalAgentTrajectoryBenchmarkArtifact(benchmark);
  const artifact: PersonalAgentTrajectoryPipelineArtifact = {
    schema_version: "personal-agent-trajectory-pipeline.v1",
    artifact_id: options.artifactId ?? createHashId("patpipe", benchmark.artifact_id, training.artifact_id),
    batch_id: options.batchId ?? createHashId("patbatch", ...exports.map((item) => item.export_id)),
    created_at: createdAt,
    exports,
    benchmark,
    training,
    replay_report: replayReport,
    validation: {
      valid: false,
      errors: [],
      case_count: benchmark.cases.length,
      training_record_count: training.records.length,
      replay_passed_count: replayReport.passed_count
    }
  };
  artifact.validation = validatePersonalAgentTrajectoryPipelineArtifact(artifact);
  return artifact;
}

export function validatePersonalAgentTrajectoryPipelineArtifact(
  artifact: PersonalAgentTrajectoryPipelineArtifact
): PersonalAgentTrajectoryPipelineValidationReport {
  const errors: string[] = [];
  if (artifact.schema_version !== "personal-agent-trajectory-pipeline.v1") {
    errors.push("invalid pipeline schema_version");
  }
  if (artifact.benchmark.schema_version !== "personal-agent-benchmark.v1") {
    errors.push("invalid benchmark schema_version");
  }
  if (artifact.training.schema_version !== "personal-agent-training.v1") {
    errors.push("invalid training schema_version");
  }
  if (artifact.benchmark.cases.length !== artifact.training.records.length) {
    errors.push("benchmark case count must match training record count");
  }
  if (artifact.replay_report.failed_count !== 0) {
    errors.push("replay report must have zero failed cases");
  }
  if (artifact.training.records.some((record) => record.messages.length < 2)) {
    errors.push("training records must include user and assistant messages");
  }
  if (artifact.training.source_export_ids.some((id) => !artifact.benchmark.source_export_ids.includes(id))) {
    errors.push("training source export ids must be present in benchmark source export ids");
  }
  return {
    valid: errors.length === 0,
    errors,
    case_count: artifact.benchmark.cases.length,
    training_record_count: artifact.training.records.length,
    replay_passed_count: artifact.replay_report.passed_count
  };
}

function collectProvenance(
  records: CycleTraceRecord[],
  memoryRecords: Array<Record<string, unknown>>
): PersonalAgentTrajectoryExport["provenance"] {
  return {
    traces: records.map((record) => ({
      trace_id: record.trace.trace_id,
      cycle_id: record.trace.cycle_id,
      input_refs: record.trace.input_refs,
      selected_action_ref: record.trace.selected_action_ref,
      observation_refs: record.trace.observation_refs
    })),
    memory: [
      ...records.flatMap(memoryProvenanceFromTrace),
      ...memoryRecords.map((record) => ({
        source: "attached_memory_record" as const,
        memory_refs: [
          {
            memory_id: readString(record.memory_id) ?? readString(record.id) ?? "attached-memory",
            memory_type: readString(record.type) ?? "personal",
            summary: readString(record.content) ?? readString(record.summary)
          }
        ]
      }))
    ],
    tools: records.flatMap(toolProvenanceFromTrace)
  };
}

function memoryProvenanceFromTrace(record: CycleTraceRecord): PersonalAgentMemoryProvenance[] {
  const bundle = record.memory_recall_bundle;
  if (!bundle) {
    return [];
  }
  return [
    {
      source: "trace_recall_bundle",
      trace_id: record.trace.trace_id,
      cycle_id: record.trace.cycle_id,
      bundle_id: bundle.bundle_id,
      plan_id: bundle.plan_id,
      memory_refs: bundle.digests.map((digest) => ({
        memory_id: digest.memory_id,
        memory_type: digest.memory_type,
        relevance: digest.relevance,
        summary: digest.summary
      }))
    }
  ];
}

function toolProvenanceFromTrace(record: CycleTraceRecord): PersonalAgentToolProvenance[] {
  const action = record.selected_action;
  const observation = record.observation;
  const execution = record.action_execution;
  if (
    action?.action_type !== "call_tool" &&
    !action?.tool_name &&
    observation?.source_type !== "tool" &&
    execution?.executor !== "tool_gateway"
  ) {
    return [];
  }

  return [
    {
      trace_id: record.trace.trace_id,
      cycle_id: record.trace.cycle_id,
      action_id: action?.action_id,
      tool_name: action?.tool_name,
      title: action?.title,
      observation_id: observation?.observation_id,
      status: observation?.status ?? execution?.status,
      result_ref: execution?.result_ref,
      structured_payload: observation?.structured_payload
    }
  ];
}

function buildReplaySteps(records: CycleTraceRecord[]): PersonalAgentTrajectoryReplayStep[] {
  return records.map((record, index) => {
    const input = record.inputs.map((item) => item.content).join("\n");
    const output = record.observation?.source_type === "runtime"
      ? record.observation.summary
      : record.selected_action?.action_type === "respond" || record.selected_action?.action_type === "ask_user"
        ? record.selected_action.description ?? record.selected_action.title
        : record.observation?.summary;

    return {
      step_index: index,
      trace_id: record.trace.trace_id,
      cycle_id: record.trace.cycle_id,
      input,
      selected_action: record.selected_action
        ? {
            action_id: record.selected_action.action_id,
            action_type: record.selected_action.action_type,
            title: record.selected_action.title,
            tool_name: record.selected_action.tool_name
          }
        : undefined,
      observation_summary: record.observation?.summary,
      output
    };
  });
}

function toBenchmarkCase(
  trajectory: PersonalAgentTrajectoryExport,
  index: number
): PersonalAgentTrajectoryBenchmarkCase {
  return {
    case_id: `trajectory-${String(index + 1).padStart(5, "0")}`,
    source_export_id: trajectory.export_id,
    session_id: trajectory.session_id,
    input_texts: trajectory.replay.steps.map((step) => step.input).filter((input) => input.length > 0),
    expected_final_output: trajectory.final_output,
    trace_signature: trajectory.replay.trace_signature,
    replay_signature: trajectory.replay.replay_signature,
    replay_steps: trajectory.replay.steps,
    memory_refs: uniqueStrings(trajectory.provenance.memory.flatMap((item) => item.memory_refs.map((ref) => ref.memory_id))),
    tool_refs: uniqueStrings(trajectory.provenance.tools.map((item) => item.tool_name).filter((value): value is string => Boolean(value))),
    redaction: trajectory.redaction
  };
}

function toTrainingRecord(
  trajectory: PersonalAgentTrajectoryExport,
  compression: PersonalAgentTrajectoryCompressionReport
): PersonalAgentTrajectoryTrainingRecord {
  const input = compressText(trajectory.replay.steps.map((step) => step.input).filter(Boolean).join("\n"), compression);
  const output = compressText(trajectory.final_output ?? trajectory.replay.steps.at(-1)?.output ?? "", compression);
  const benchmarkCase = toBenchmarkCase(trajectory, 0);
  return {
    record_id: createHashId("patrec", trajectory.export_id, trajectory.replay.replay_signature),
    source_export_id: trajectory.export_id,
    session_id: trajectory.session_id,
    messages: [
      { role: "user", content: input },
      { role: "assistant", content: output }
    ],
    expected_final_output: output,
    trace_signature: trajectory.replay.trace_signature,
    replay_signature: trajectory.replay.replay_signature,
    tool_refs: benchmarkCase.tool_refs,
    memory_refs: benchmarkCase.memory_refs,
    redaction: trajectory.redaction
  };
}

function compressText(value: string, compression: PersonalAgentTrajectoryCompressionReport): string {
  if (value.length <= compression.max_chars_per_field) {
    return value;
  }
  compression.applied = true;
  compression.truncated_field_count += 1;
  return `${value.slice(0, Math.max(0, compression.max_chars_per_field - 24))}\n[TRUNCATED:${value.length}]`;
}

function aggregateRedaction(reports: PersonalAgentRedactionReport[]): PersonalAgentRedactionReport {
  const findings = reports.flatMap((report) => report.findings);
  return {
    applied: reports.some((report) => report.applied),
    finding_count: findings.length,
    findings
  };
}

function redactNode(input: unknown, ctx: RedactionContext): unknown {
  const normalizedKey = ctx.key ? normalizeKey(ctx.key) : "";
  if (ctx.key && ctx.secretKeys.has(normalizedKey)) {
    ctx.findings.push({ path: ctx.path, kind: "secret", replacement: "[REDACTED_SECRET]" });
    return "[REDACTED_SECRET]";
  }
  if (ctx.key && ctx.privateIdKeys.has(normalizedKey) && (typeof input === "string" || typeof input === "number")) {
    const replacement = pseudonymize(String(input), ctx.idMap);
    ctx.findings.push({ path: ctx.path, kind: "private_id", replacement });
    return replacement;
  }
  if (typeof input === "string") {
    return redactString(input, ctx);
  }
  if (Array.isArray(input)) {
    return input.map((item, index) => redactNode(item, { ...ctx, key: String(index), path: `${ctx.path}[${index}]` }));
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        redactNode(value, {
          ...ctx,
          key,
          path: `${ctx.path}.${key}`
        })
      ])
    );
  }
  return input;
}

function redactString(input: string, ctx: RedactionContext): string {
  let output = input;
  for (const [raw, replacement] of ctx.idMap.entries()) {
    if (raw.length === 0 || !output.includes(raw)) {
      continue;
    }
    output = output.split(raw).join(replacement);
    ctx.findings.push({ path: ctx.path, kind: "private_id", replacement });
  }
  output = replaceWithFinding(output, emailPattern, "[REDACTED_EMAIL]", "email", ctx);
  output = replaceWithFinding(output, phonePattern, "[REDACTED_PHONE]", "phone", ctx);
  output = replaceWithFinding(output, secretPattern, "[REDACTED_SECRET]", "secret", ctx);
  output = replaceWithFinding(output, bearerPattern, "[REDACTED_SECRET]", "secret", ctx);
  return output;
}

function replaceWithFinding(
  input: string,
  pattern: RegExp,
  replacement: string,
  kind: PersonalAgentRedactionKind,
  ctx: RedactionContext
): string {
  return input.replace(pattern, () => {
    ctx.findings.push({ path: ctx.path, kind, replacement });
    return replacement;
  });
}

function pseudonymize(value: string, idMap: Map<string, string>): string {
  const existing = idMap.get(value);
  if (existing) {
    return existing;
  }
  const next = `[REDACTED_ID:${String(idMap.size + 1).padStart(4, "0")}]`;
  idMap.set(value, next);
  return next;
}

function computeReplaySignature(steps: PersonalAgentTrajectoryReplayStep[], finalOutput: string | undefined): string {
  return hashStable({
    steps,
    final_output: finalOutput
  });
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function createHashId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface RedactionContext {
  path: string;
  key: string | undefined;
  findings: PersonalAgentRedactionFinding[];
  idMap: Map<string, string>;
  secretKeys: Set<string>;
  privateIdKeys: Set<string>;
}

const defaultSecretKeys = new Set([
  "apikey",
  "authorization",
  "bearertoken",
  "bottoken",
  "clientsecret",
  "password",
  "secret",
  "token",
  "webhooksecret",
  "approvaltoken"
]);

const defaultPrivateIdKeys = new Set([
  "userid",
  "senderid",
  "canonicaluserid",
  "chatid",
  "messageid",
  "platformmessageid",
  "sourcemessageid",
  "replyto",
  "sessionid"
]);

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const secretPattern = /\b(?:sk|pk|xoxb|ghp|github_pat|ya29)[-_A-Za-z0-9]{8,}\b/g;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
