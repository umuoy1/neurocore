import { createHash, randomUUID } from "node:crypto";
import type { AgentSkillRecord, AgentSkillRegistry } from "./agent-skill-registry.js";

export type AutoSkillCandidateStatus = "candidate" | "validated" | "failed" | "active" | "disabled" | "rolled_back" | "replaced";

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

export interface AutoSkillValidator {
  name: string;
  validate(candidate: AutoSkillCandidate): Promise<AutoSkillValidationResult[]>;
}

export interface AutoSkillManagerOptions {
  registry?: AgentSkillRegistry;
  threshold?: number;
  now?: () => string;
}

export class AutoSkillManager {
  private readonly candidates = new Map<string, AutoSkillCandidate>();
  private readonly versionsBySkill = new Map<string, AutoSkillCandidate[]>();
  private readonly threshold: number;
  private readonly now: () => string;

  public constructor(private readonly options: AutoSkillManagerOptions = {}) {
    this.threshold = options.threshold ?? 3;
    this.now = options.now ?? (() => new Date().toISOString());
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
    validators: AutoSkillValidator[]
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
    return structuredClone(next);
  }

  public disableVersion(skillId: string, version: string): AutoSkillCandidate | undefined {
    const candidate = this.findVersion(skillId, version);
    if (!candidate) {
      return undefined;
    }
    const skill = candidate.skill ? { ...candidate.skill, enabled: false } : toAgentSkill(candidate, false);
    this.options.registry?.registerSkill(skill);
    return structuredClone(this.updateCandidate(candidate.candidate_id, {
      status: "disabled",
      skill
    }));
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
    return structuredClone(this.updateCandidate(target.candidate_id, {
      status: "active",
      skill
    }));
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
