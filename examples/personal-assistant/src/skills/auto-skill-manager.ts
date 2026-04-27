import { createHash, randomUUID } from "node:crypto";
import type { JsonValue, Tool } from "@neurocore/protocol";
import type { AgentSkillRecord, AgentSkillRegistry } from "./agent-skill-registry.js";

export type AutoSkillCandidateStatus = "candidate" | "validated" | "failed" | "active" | "disabled" | "rolled_back" | "replaced";
export type AutoSkillAuditEventType = "candidate_proposed" | "candidate_validated" | "candidate_failed" | "candidate_activated" | "version_disabled" | "version_rolled_back";

export interface WorkflowExample {
  workflow_key: string;
  title: string;
  description?: string;
  success: boolean;
  steps: string[];
  input_examples?: string[];
  output_examples?: string[];
  permissions?: string[];
  risk_level?: AgentSkillRecord["risk_level"];
  created_at?: string;
}

export interface AutoSkillRegressionCase {
  case_id: string;
  input: string;
  expected_contains?: string[];
}

export interface AutoSkillCandidate {
  candidate_id: string;
  skill_id: string;
  version: string;
  status: AutoSkillCandidateStatus;
  title: string;
  description: string;
  instructions: string;
  source_workflow_keys: string[];
  source_count: number;
  regression_cases: AutoSkillRegressionCase[];
  validation_report?: AutoSkillValidationReport;
  skill?: AgentSkillRecord;
  created_at: string;
  updated_at: string;
}

export interface AutoSkillValidationResult {
  case_id: string;
  passed: boolean;
  reason?: string;
}

export interface AutoSkillValidationReport {
  passed: boolean;
  results: AutoSkillValidationResult[];
  validated_at: string;
}

export interface AutoSkillAuditEvent {
  audit_id: string;
  event_type: AutoSkillAuditEventType;
  candidate_id?: string;
  skill_id?: string;
  version?: string;
  actor_id?: string;
  metadata: Record<string, JsonValue>;
  created_at: string;
}

export interface AutoSkillValidator {
  name: string;
  validate(candidate: AutoSkillCandidate): Promise<AutoSkillValidationResult[]>;
}

export interface AutoSkillManagerOptions {
  registry?: AgentSkillRegistry;
  threshold?: number;
  now?: () => string;
  generateId?: (prefix: string) => string;
  validators?: AutoSkillValidator[];
}

export class AutoSkillManager {
  private readonly candidates = new Map<string, AutoSkillCandidate>();
  private readonly versionsBySkill = new Map<string, AutoSkillCandidate[]>();
  private readonly threshold: number;
  private readonly now: () => string;
  private readonly generateId: (prefix: string) => string;
  private readonly auditEvents: AutoSkillAuditEvent[] = [];

  public constructor(private readonly options: AutoSkillManagerOptions = {}) {
    this.threshold = options.threshold ?? 3;
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? ((prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  }

  public proposeFromWorkflows(workflows: WorkflowExample[]): AutoSkillCandidate[] {
    const grouped = new Map<string, WorkflowExample[]>();
    for (const workflow of workflows.filter((item) => item.success)) {
      grouped.set(workflow.workflow_key, [...(grouped.get(workflow.workflow_key) ?? []), workflow]);
    }

    const proposed: AutoSkillCandidate[] = [];
    for (const [workflowKey, examples] of grouped.entries()) {
      if (examples.length < this.threshold) {
        continue;
      }
      const candidate = this.createCandidate(workflowKey, examples);
      this.candidates.set(candidate.candidate_id, candidate);
      this.versionsBySkill.set(candidate.skill_id, [
        ...(this.versionsBySkill.get(candidate.skill_id) ?? []),
        candidate
      ]);
      this.recordAudit("candidate_proposed", candidate, { source_count: candidate.source_count });
      proposed.push(candidate);
    }
    return proposed;
  }

  public getCandidate(candidateId: string): AutoSkillCandidate | undefined {
    const candidate = this.candidates.get(candidateId);
    return candidate ? structuredClone(candidate) : undefined;
  }

  public listCandidates(): AutoSkillCandidate[] {
    return [...this.candidates.values()].map((candidate) => structuredClone(candidate));
  }

  public async validateCandidate(
    candidateId: string,
    validators: AutoSkillValidator[] = this.options.validators ?? [createExpectedOutputValidator()]
  ): Promise<AutoSkillCandidate> {
    const candidate = this.requireCandidate(candidateId);
    const results = (await Promise.all(validators.map((validator) => validator.validate(candidate)))).flat();
    const report: AutoSkillValidationReport = {
      passed: results.every((result) => result.passed),
      results,
      validated_at: this.now()
    };
    const next = this.updateCandidate(candidateId, {
      status: report.passed ? "validated" : "failed",
      validation_report: report
    });
    this.recordAudit(report.passed ? "candidate_validated" : "candidate_failed", next, {
      result_count: results.length,
      failed_count: results.filter((result) => !result.passed).length
    });
    return structuredClone(next);
  }

  public activateCandidate(candidateId: string): AutoSkillCandidate {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status !== "validated" || candidate.validation_report?.passed !== true) {
      throw new Error(`Candidate ${candidateId} must pass validation before activation.`);
    }
    for (const version of this.versionsBySkill.get(candidate.skill_id) ?? []) {
      if (version.status === "active") {
        this.updateCandidate(version.candidate_id, { status: "replaced" });
      }
    }
    const skill = toAgentSkill(candidate, true);
    this.options.registry?.registerSkill(skill);
    const next = this.updateCandidate(candidateId, {
      status: "active",
      skill
    });
    this.recordAudit("candidate_activated", next, {
      content_hash: skill.content_hash
    });
    return structuredClone(next);
  }

  public disableVersion(skillId: string, version: string): AutoSkillCandidate | undefined {
    const candidate = this.findVersion(skillId, version);
    if (!candidate) {
      return undefined;
    }
    const skill = candidate.skill ? { ...candidate.skill, enabled: false } : toAgentSkill(candidate, false);
    this.options.registry?.registerSkill(skill);
    const next = this.updateCandidate(candidate.candidate_id, {
      status: "disabled",
      skill
    });
    this.recordAudit("version_disabled", next, { version });
    return structuredClone(next);
  }

  public rollback(skillId: string): AutoSkillCandidate | undefined {
    const versions = [...(this.versionsBySkill.get(skillId) ?? [])].reverse();
    const current = versions.find((candidate) => candidate.status === "active");
    if (current) {
      this.updateCandidate(current.candidate_id, { status: "rolled_back" });
    }
    const target = versions.find((candidate) =>
      candidate.status === "replaced" ||
      candidate.status === "validated"
    );
    if (!target) {
      return undefined;
    }
    const skill = toAgentSkill(target, true);
    this.options.registry?.registerSkill(skill);
    const next = this.updateCandidate(target.candidate_id, {
      status: "active",
      skill
    });
    this.recordAudit("version_rolled_back", next, current ? {
      from_candidate_id: current.candidate_id
    } : {});
    return structuredClone(next);
  }

  public listAuditEvents(input: { limit?: number; skill_id?: string; candidate_id?: string } = {}): AutoSkillAuditEvent[] {
    return this.auditEvents
      .filter((event) => !input.skill_id || event.skill_id === input.skill_id)
      .filter((event) => !input.candidate_id || event.candidate_id === input.candidate_id)
      .slice(-(input.limit ?? 100))
      .map((event) => ({
        ...event,
        metadata: { ...event.metadata }
      }))
      .reverse();
  }

  private createCandidate(workflowKey: string, examples: WorkflowExample[]): AutoSkillCandidate {
    const first = examples[0];
    const skillId = normalizeSkillId(`auto-${workflowKey}`);
    const version = `${(this.versionsBySkill.get(skillId)?.length ?? 0) + 1}.0.0`;
    const instructions = buildInstructions(examples);
    const now = this.now();
    return {
      candidate_id: `ask_${randomUUID()}`,
      skill_id: skillId,
      version,
      status: "candidate",
      title: first.title,
      description: first.description ?? `Auto-generated skill for ${workflowKey}`,
      instructions,
      source_workflow_keys: [...new Set(examples.map((example) => example.workflow_key))],
      source_count: examples.length,
      regression_cases: buildRegressionCases(examples),
      created_at: now,
      updated_at: now
    };
  }

  private requireCandidate(candidateId: string): AutoSkillCandidate {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      throw new Error(`Unknown auto skill candidate: ${candidateId}`);
    }
    return structuredClone(candidate);
  }

  private updateCandidate(
    candidateId: string,
    patch: Partial<AutoSkillCandidate>
  ): AutoSkillCandidate {
    const current = this.candidates.get(candidateId);
    if (!current) {
      throw new Error(`Unknown auto skill candidate: ${candidateId}`);
    }
    const next = {
      ...current,
      ...patch,
      updated_at: this.now()
    };
    this.candidates.set(candidateId, next);
    const versions = this.versionsBySkill.get(next.skill_id) ?? [];
    this.versionsBySkill.set(next.skill_id, versions.map((candidate) =>
      candidate.candidate_id === candidateId ? next : candidate
    ));
    return next;
  }

  private findVersion(skillId: string, version: string): AutoSkillCandidate | undefined {
    return this.versionsBySkill.get(skillId)?.find((candidate) => candidate.version === version);
  }

  private recordAudit(
    eventType: AutoSkillAuditEventType,
    candidate: AutoSkillCandidate,
    metadata: Record<string, JsonValue> = {}
  ): AutoSkillAuditEvent {
    const event: AutoSkillAuditEvent = {
      audit_id: this.generateId("auto_skill_audit"),
      event_type: eventType,
      candidate_id: candidate.candidate_id,
      skill_id: candidate.skill_id,
      version: candidate.version,
      metadata,
      created_at: this.now()
    };
    this.auditEvents.push(event);
    return event;
  }
}

export function createAutoSkillTools(manager: AutoSkillManager): Tool[] {
  return [
    {
      name: "auto_skill_propose",
      description: "Generate candidate skills from successful repeated workflow examples.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          workflows: { type: "array" }
        },
        required: ["workflows"]
      },
      async invoke(input) {
        const candidates = manager.proposeFromWorkflows(readWorkflowArray(input.workflows));
        return {
          summary: `Generated ${candidates.length} auto skill candidate${candidates.length === 1 ? "" : "s"}.`,
          payload: { candidates: candidates as unknown as JsonValue }
        };
      }
    },
    {
      name: "auto_skill_validate",
      description: "Run regression validation for an auto skill candidate.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          candidate_id: { type: "string" }
        },
        required: ["candidate_id"]
      },
      async invoke(input) {
        const candidate = await manager.validateCandidate(readRequiredString(input.candidate_id, "candidate_id"));
        return {
          summary: `Candidate ${candidate.candidate_id} validation ${candidate.validation_report?.passed ? "passed" : "failed"}.`,
          payload: { candidate: candidate as unknown as JsonValue }
        };
      }
    },
    {
      name: "auto_skill_activate",
      description: "Activate a validated auto skill candidate in the skill registry.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          candidate_id: { type: "string" }
        },
        required: ["candidate_id"]
      },
      async invoke(input) {
        const candidate = manager.activateCandidate(readRequiredString(input.candidate_id, "candidate_id"));
        return {
          summary: `Activated auto skill ${candidate.skill_id}@${candidate.version}.`,
          payload: { candidate: candidate as unknown as JsonValue }
        };
      }
    },
    {
      name: "auto_skill_disable",
      description: "Disable an active auto skill version.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
          version: { type: "string" }
        },
        required: ["skill_id", "version"]
      },
      async invoke(input) {
        const candidate = manager.disableVersion(
          readRequiredString(input.skill_id, "skill_id"),
          readRequiredString(input.version, "version")
        );
        return {
          summary: candidate ? `Disabled auto skill ${candidate.skill_id}@${candidate.version}.` : "Auto skill version was not found.",
          payload: { candidate: candidate as unknown as JsonValue }
        };
      }
    },
    {
      name: "auto_skill_rollback",
      description: "Roll back an auto skill to the previous validated or replaced version.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          skill_id: { type: "string" }
        },
        required: ["skill_id"]
      },
      async invoke(input) {
        const candidate = manager.rollback(readRequiredString(input.skill_id, "skill_id"));
        return {
          summary: candidate ? `Rolled back auto skill ${candidate.skill_id} to ${candidate.version}.` : "No rollback target was found.",
          payload: { candidate: candidate as unknown as JsonValue }
        };
      }
    },
    {
      name: "auto_skill_list",
      description: "List auto skill candidates and validation status.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        const candidates = manager.listCandidates();
        return {
          summary: `Listed ${candidates.length} auto skill candidate${candidates.length === 1 ? "" : "s"}.`,
          payload: { candidates: candidates as unknown as JsonValue }
        };
      }
    },
    {
      name: "auto_skill_audit",
      description: "List auto skill proposal, validation, activation and rollback audit events.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
          candidate_id: { type: "string" },
          limit: { type: "number" }
        }
      },
      async invoke(input) {
        const events = manager.listAuditEvents({
          skill_id: readOptionalString(input.skill_id),
          candidate_id: readOptionalString(input.candidate_id),
          limit: readOptionalNumber(input.limit)
        });
        return {
          summary: `Listed ${events.length} auto skill audit event${events.length === 1 ? "" : "s"}.`,
          payload: { events: events as unknown as JsonValue }
        };
      }
    }
  ];
}

export function createExpectedOutputValidator(): AutoSkillValidator {
  return {
    name: "expected-output-validator",
    async validate(candidate) {
      return candidate.regression_cases.map((testCase) => {
        const haystack = candidate.instructions.toLowerCase();
        const missing = (testCase.expected_contains ?? []).filter((expected) =>
          !haystack.includes(expected.toLowerCase())
        );
        return {
          case_id: testCase.case_id,
          passed: missing.length === 0,
          reason: missing.length > 0 ? `Missing expected fragments: ${missing.join(", ")}` : undefined
        };
      });
    }
  };
}

function toAgentSkill(candidate: AutoSkillCandidate, enabled: boolean): AgentSkillRecord {
  const instructions = candidate.instructions;
  return {
    id: candidate.skill_id,
    name: candidate.title,
    description: candidate.description,
    directory: `generated://${candidate.skill_id}/${candidate.version}`,
    skill_path: `generated://${candidate.skill_id}/${candidate.version}/SKILL.md`,
    permissions: inferPermissions(candidate),
    channels: [],
    risk_level: inferRiskLevel(candidate),
    enabled,
    content_hash: createHash("sha256").update(`${candidate.skill_id}:${candidate.version}:${instructions}`).digest("hex"),
    instructions
  };
}

function buildInstructions(examples: WorkflowExample[]): string {
  const steps = [...new Set(examples.flatMap((example) => example.steps))];
  const inputs = [...new Set(examples.flatMap((example) => example.input_examples ?? []))];
  const outputs = [...new Set(examples.flatMap((example) => example.output_examples ?? []))];
  return [
    `# ${examples[0].title}`,
    "",
    examples[0].description ?? "",
    "",
    "## Steps",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Regression Inputs",
    ...inputs.map((input) => `- ${input}`),
    "",
    "## Expected Outputs",
    ...outputs.map((output) => `- ${output}`)
  ].join("\n").trim();
}

function buildRegressionCases(examples: WorkflowExample[]): AutoSkillRegressionCase[] {
  return examples.flatMap((example, index) =>
    (example.input_examples ?? [example.title]).map((input, inputIndex) => ({
      case_id: `reg_${index + 1}_${inputIndex + 1}`,
      input,
      expected_contains: example.output_examples
    }))
  );
}

function inferPermissions(candidate: AutoSkillCandidate): string[] {
  const permissions = new Set<string>();
  for (const key of candidate.source_workflow_keys) {
    if (/email|inbox/.test(key)) {
      permissions.add("email");
    }
    if (/calendar|schedule/.test(key)) {
      permissions.add("calendar");
    }
  }
  return [...permissions];
}

function inferRiskLevel(candidate: AutoSkillCandidate): AgentSkillRecord["risk_level"] {
  return /send|write|delete|post/.test(candidate.instructions.toLowerCase()) ? "high" : "low";
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function readWorkflowArray(value: unknown): WorkflowExample[] {
  if (!Array.isArray(value)) {
    throw new Error("workflows is required.");
  }
  return value.map(readWorkflow);
}

function readWorkflow(value: unknown): WorkflowExample {
  const record = readRecord(value);
  return {
    workflow_key: readRequiredString(record.workflow_key, "workflow_key"),
    title: readRequiredString(record.title, "title"),
    description: readOptionalString(record.description),
    success: record.success === true,
    steps: readStringArray(record.steps) ?? [],
    input_examples: readStringArray(record.input_examples),
    output_examples: readStringArray(record.output_examples),
    permissions: readStringArray(record.permissions),
    risk_level: readRiskLevel(record.risk_level),
    created_at: readOptionalString(record.created_at)
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("workflow must be an object.");
  }
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
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

function readRiskLevel(value: unknown): AgentSkillRecord["risk_level"] | undefined {
  return value === "none" || value === "low" || value === "medium" || value === "high" ? value : undefined;
}
