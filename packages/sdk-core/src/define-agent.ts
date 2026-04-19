import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentProfile,
  MemoryProvider,
  PolicyProvider,
  Predictor,
  Reasoner,
  RuntimeStateStore,
  SessionCheckpoint,
  SkillProvider,
  UserInput,
  Tool
} from "@neurocore/protocol";
import {
  AgentRuntime,
  SqliteCheckpointStore,
  SqliteRuntimeStateStore,
  createSqliteMemoryPersistence,
  type AgentRuntimeOptions
} from "@neurocore/runtime-core";
import { ToolPolicyProvider } from "@neurocore/policy-core";
import { AgentSessionHandle, type LocalSessionCreateInput } from "./session-handle.js";

export interface DefineAgentOptions {
  id: string;
  name?: string;
  role: string;
  version?: string;
  schemaVersion?: string;
  domain?: string;
}

export interface AgentRuntimeInfrastructure
  extends Partial<
    Pick<
      AgentRuntimeOptions,
      | "deviceRegistry"
      | "stateStore"
      | "worldStateGraph"
      | "perceptionPipeline"
      | "forwardSimulator"
      | "memoryPersistence"
      | "checkpointStore"
      | "agentRegistry"
      | "interAgentBus"
      | "taskDelegator"
      | "distributedGoalManager"
      | "agentLifecycleManager"
      | "sharedStateStore"
      | "coordinationStrategy"
    >
  > {}

export interface AgentBuilderValidationIssue {
  code: string;
  message: string;
}

export interface AgentBuilderValidationResult {
  valid: boolean;
  issues: AgentBuilderValidationIssue[];
}

export class BuiltAgent {
  public constructor(
    private readonly runtime: AgentRuntime,
    private readonly profile: AgentProfile
  ) {}

  public createSession(command: LocalSessionCreateInput): AgentSessionHandle {
    const session = this.runtime.createSession(this.profile, {
      command_type: "create_session",
      agent_id: this.profile.agent_id,
      ...command
    });
    return new AgentSessionHandle(this.runtime, this.profile, session.session_id, command.initial_input);
  }

  public createSessionFromCheckpoint(checkpoint: SessionCheckpoint): AgentSessionHandle {
    const session = this.runtime.restoreSession(checkpoint);
    return new AgentSessionHandle(
      this.runtime,
      this.profile,
      session.session_id,
      checkpoint.pending_input
    );
  }

  public connectSession(sessionId: string, initialInput?: UserInput): AgentSessionHandle {
    const session = this.runtime.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return new AgentSessionHandle(this.runtime, this.profile, session.session_id, initialInput);
  }

  public getProfile(): AgentProfile {
    return cloneProfile(this.profile);
  }

  public getRuntime(): AgentRuntime {
    return this.runtime;
  }
}

export class AgentBuilder {
  private readonly profile: AgentProfile;
  private reasoner?: Reasoner;
  private readonly memoryProviders: MemoryProvider[] = [];
  private readonly predictors: Predictor[] = [];
  private readonly policyProviders: PolicyProvider[] = [];
  private readonly skillProviders: SkillProvider[] = [];
  private readonly tools: Tool[] = [];
  private runtimeStateStoreFactory?: () => RuntimeStateStore;
  private runtimeInfrastructure: AgentRuntimeInfrastructure = {};
  private runtime?: AgentRuntime;

  public constructor(options: DefineAgentOptions) {
    validateAgentId(options.id);
    this.profile = {
      agent_id: options.id,
      schema_version: options.schemaVersion ?? "0.1.0",
      name: options.name ?? options.id,
      version: options.version ?? "0.1.0",
      role: options.role,
      domain: options.domain,
      mode: "embedded",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: {
        working_memory_enabled: true,
        episodic_memory_enabled: true,
        write_policy: "hybrid"
      },
      runtime_config: {
        max_cycles: 8,
        cycle_mode: "standard",
        checkpoint_interval: "cycle"
      }
    };
  }

  public useReasoner(reasoner: Reasoner): this {
    this.reasoner = reasoner;
    this.invalidateRuntime();
    return this;
  }

  public configureMemory(options: Partial<AgentProfile["memory_config"]>): this {
    this.profile.memory_config = {
      ...this.profile.memory_config,
      ...options
    };
    this.invalidateRuntime();
    return this;
  }

  public configureRuntime(config: Partial<AgentProfile["runtime_config"]>): this {
    const nextToolExecution = config.tool_execution
      ? {
          ...(this.profile.runtime_config.tool_execution ?? {}),
          ...config.tool_execution
        }
      : this.profile.runtime_config.tool_execution;

    this.profile.runtime_config = {
      ...this.profile.runtime_config,
      ...config,
      ...(nextToolExecution ? { tool_execution: nextToolExecution } : {})
    };
    this.invalidateRuntime();
    return this;
  }

  public configureMultiAgent(options: Partial<NonNullable<AgentProfile["multi_agent_config"]>>): this {
    this.profile.multi_agent_config = {
      enabled: this.profile.multi_agent_config?.enabled ?? false,
      ...this.profile.multi_agent_config,
      ...options
    };
    this.invalidateRuntime();
    return this;
  }

  public withTokenBudget(maxTokens: number): this {
    this.profile.context_budget = {
      ...this.profile.context_budget,
      max_context_tokens: maxTokens
    };
    this.invalidateRuntime();
    return this;
  }

  public configurePolicy(options: {
    blockedTools?: string[];
    requiredApprovalTools?: string[];
    requiredApprovalRiskLevels?: import("@neurocore/protocol").SideEffectLevel[];
    tenantPolicies?: Record<string, {
      blockedTools?: string[];
      requiredApprovalTools?: string[];
      requiredApprovalRiskLevels?: import("@neurocore/protocol").SideEffectLevel[];
    }>;
  }): this {
    const provider = new ToolPolicyProvider(options);
    this.policyProviders.splice(
      0,
      this.policyProviders.length,
      ...this.policyProviders.filter((candidate) => candidate.name !== provider.name)
    );
    this.policyProviders.push(provider);
    this.profile.policies.policy_ids = dedupeStrings([
      ...this.profile.policies.policy_ids.filter((policyId) => policyId !== provider.name),
      provider.name
    ]);
    this.invalidateRuntime();
    return this;
  }

  public configureApprovalPolicy(policy: NonNullable<AgentProfile["approval_policy"]>): this {
    this.profile.approval_policy = {
      ...policy,
      allowed_approvers: policy.allowed_approvers ? [...policy.allowed_approvers] : undefined,
      allowed_approvers_by_tenant: policy.allowed_approvers_by_tenant
        ? Object.fromEntries(
            Object.entries(policy.allowed_approvers_by_tenant).map(([tenantId, approvers]) => [
              tenantId,
              [...approvers]
            ])
          )
        : undefined,
      allowed_approvers_by_risk: policy.allowed_approvers_by_risk
        ? Object.fromEntries(
            Object.entries(policy.allowed_approvers_by_risk).map(([riskLevel, approvers]) => [
              riskLevel,
              [...approvers]
            ])
          )
        : undefined,
      allowed_approvers_by_tenant_and_risk: policy.allowed_approvers_by_tenant_and_risk
        ? Object.fromEntries(
            Object.entries(policy.allowed_approvers_by_tenant_and_risk).map(([tenantId, byRisk]) => [
              tenantId,
              Object.fromEntries(
                Object.entries(byRisk).map(([riskLevel, approvers]) => [riskLevel, [...approvers]])
              )
            ])
          )
        : undefined
    };
    this.invalidateRuntime();
    return this;
  }

  public registerTool(tool: Tool): this {
    assertUniqueRegistration(this.tools.map((candidate) => candidate.name), tool.name, "tool");
    this.tools.push(tool);
    this.profile.tool_refs.push(tool.name);
    const metadata = (this.profile.metadata ??= {});
    const currentCatalog = Array.isArray(metadata.tool_catalog) ? metadata.tool_catalog : [];
    metadata.tool_catalog = [
      ...currentCatalog,
      {
        name: tool.name,
        description: tool.description,
        sideEffectLevel: tool.sideEffectLevel,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        execution: tool.execution
      }
    ];
    this.invalidateRuntime();
    return this;
  }

  public registerMemoryProvider(provider: MemoryProvider): this {
    assertUniqueRegistration(this.memoryProviders.map((candidate) => candidate.name), provider.name, "memory provider");
    this.memoryProviders.push(provider);
    this.invalidateRuntime();
    return this;
  }

  public registerPredictor(predictor: Predictor): this {
    assertUniqueRegistration(this.predictors.map((candidate) => candidate.name), predictor.name, "predictor");
    this.predictors.push(predictor);
    const metadata = (this.profile.metadata ??= {});
    const currentCatalog = Array.isArray(metadata.predictor_catalog) ? metadata.predictor_catalog : [];
    metadata.predictor_catalog = [
      ...currentCatalog,
      {
        name: predictor.name
      }
    ];
    this.invalidateRuntime();
    return this;
  }

  public registerPolicyProvider(provider: PolicyProvider): this {
    assertUniqueRegistration(this.policyProviders.map((candidate) => candidate.name), provider.name, "policy provider");
    this.policyProviders.push(provider);
    this.profile.policies.policy_ids = dedupeStrings([...this.profile.policies.policy_ids, provider.name]);
    const metadata = (this.profile.metadata ??= {});
    const currentCatalog = Array.isArray(metadata.policy_catalog) ? metadata.policy_catalog : [];
    metadata.policy_catalog = [
      ...currentCatalog,
      {
        name: provider.name
      }
    ];
    this.invalidateRuntime();
    return this;
  }

  public registerSkillProvider(provider: SkillProvider): this {
    assertUniqueRegistration(this.skillProviders.map((candidate) => candidate.name), provider.name, "skill provider");
    this.skillProviders.push(provider);
    this.profile.skill_refs.push(provider.name);
    const metadata = (this.profile.metadata ??= {});
    const currentCatalog = Array.isArray(metadata.skill_catalog) ? metadata.skill_catalog : [];
    metadata.skill_catalog = [
      ...currentCatalog,
      {
        name: provider.name
      }
    ];
    this.invalidateRuntime();
    return this;
  }

  public useRuntimeStateStore(factory: () => RuntimeStateStore): this {
    this.runtimeStateStoreFactory = factory;
    this.invalidateRuntime();
    return this;
  }

  public useRuntimeInfrastructure(infrastructure: AgentRuntimeInfrastructure): this {
    this.runtimeInfrastructure = {
      ...this.runtimeInfrastructure,
      ...infrastructure
    };
    this.invalidateRuntime();
    return this;
  }

  public validate(): AgentBuilderValidationResult {
    const issues: AgentBuilderValidationIssue[] = [];

    if (!this.reasoner) {
      issues.push({
        code: "missing_reasoner",
        message: "AgentBuilder requires a reasoner before build/createSession."
      });
    }

    for (const duplicate of findDuplicateNames(this.tools.map((tool) => tool.name))) {
      issues.push({
        code: "duplicate_tool",
        message: `Duplicate tool registration: ${duplicate}`
      });
    }
    for (const duplicate of findDuplicateNames(this.memoryProviders.map((provider) => provider.name))) {
      issues.push({
        code: "duplicate_memory_provider",
        message: `Duplicate memory provider registration: ${duplicate}`
      });
    }
    for (const duplicate of findDuplicateNames(this.predictors.map((predictor) => predictor.name))) {
      issues.push({
        code: "duplicate_predictor",
        message: `Duplicate predictor registration: ${duplicate}`
      });
    }
    for (const duplicate of findDuplicateNames(this.policyProviders.map((provider) => provider.name))) {
      issues.push({
        code: "duplicate_policy_provider",
        message: `Duplicate policy provider registration: ${duplicate}`
      });
    }
    for (const duplicate of findDuplicateNames(this.skillProviders.map((provider) => provider.name))) {
      issues.push({
        code: "duplicate_skill_provider",
        message: `Duplicate skill provider registration: ${duplicate}`
      });
    }

    const expectedPolicyIds = [...new Set(this.policyProviders.map((provider) => provider.name))].sort();
    const actualPolicyIds = [...new Set(this.profile.policies.policy_ids)].sort();
    if (JSON.stringify(expectedPolicyIds) !== JSON.stringify(actualPolicyIds)) {
      issues.push({
        code: "policy_id_mismatch",
        message: `profile.policies.policy_ids must match registered policy providers. expected=${JSON.stringify(expectedPolicyIds)} actual=${JSON.stringify(actualPolicyIds)}`
      });
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  public build(): BuiltAgent {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(validation.issues.map((issue) => issue.message).join("\n"));
    }
    return new BuiltAgent(this.createRuntime(), cloneProfile(this.profile));
  }

  public createSession(command: LocalSessionCreateInput): AgentSessionHandle {
    return this.build().createSession(command);
  }

  public createSessionFromCheckpoint(checkpoint: SessionCheckpoint): AgentSessionHandle {
    return this.build().createSessionFromCheckpoint(checkpoint);
  }

  public connectSession(sessionId: string, initialInput?: UserInput): AgentSessionHandle {
    return this.build().connectSession(sessionId, initialInput);
  }

  public getProfile(): AgentProfile {
    return cloneProfile(this.profile);
  }

  private createRuntime(): AgentRuntime {
    if (!this.reasoner) {
      throw new Error("AgentBuilder requires a reasoner before creating a session.");
    }

    if (!this.runtime) {
      const explicitStateStore = this.runtimeInfrastructure.stateStore;
      const stateStore = explicitStateStore ?? this.runtimeStateStoreFactory?.();
      const defaultRuntimeInfrastructure =
        stateStore || hasExplicitPersistence(this.runtimeInfrastructure)
          ? {}
          : createDefaultSqliteRuntimeInfrastructure(this.profile.agent_id);
      const derivedSqliteInfrastructure = deriveSqlitePersistenceFromStateStore(
        stateStore,
        this.runtimeInfrastructure
      );
      const runtime = new AgentRuntime({
        reasoner: this.reasoner,
        memoryProviders: this.memoryProviders,
        predictors: this.predictors,
        policyProviders: this.policyProviders,
        skillProviders: this.skillProviders,
        stateStore,
        ...defaultRuntimeInfrastructure,
        ...derivedSqliteInfrastructure,
        ...this.runtimeInfrastructure
      });
      for (const tool of this.tools) {
        runtime.tools.register(tool);
      }
      this.runtime = runtime;
    }

    return this.runtime;
  }

  private invalidateRuntime(): void {
    this.runtime = undefined;
  }
}

export function defineAgent(options: DefineAgentOptions): AgentBuilder {
  return new AgentBuilder(options);
}

function validateAgentId(agentId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agentId)) {
    throw new Error(`Invalid agent id "${agentId}". Use letters, digits, dot, underscore, or dash.`);
  }
}

function assertUniqueRegistration(existingNames: string[], name: string, kind: string) {
  if (existingNames.includes(name)) {
    throw new Error(`Duplicate ${kind} registration: ${name}`);
  }
}

function findDuplicateNames(names: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      duplicates.add(name);
      continue;
    }
    seen.add(name);
  }
  return [...duplicates];
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function cloneProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    tool_refs: [...profile.tool_refs],
    skill_refs: [...profile.skill_refs],
    policies: {
      ...profile.policies,
      policy_ids: [...profile.policies.policy_ids]
    },
    memory_config: { ...profile.memory_config },
    runtime_config: { ...profile.runtime_config },
    approval_policy: profile.approval_policy
      ? {
          ...profile.approval_policy,
          allowed_approvers: profile.approval_policy.allowed_approvers
            ? [...profile.approval_policy.allowed_approvers]
            : undefined,
          allowed_approvers_by_tenant: profile.approval_policy.allowed_approvers_by_tenant
            ? Object.fromEntries(
                Object.entries(profile.approval_policy.allowed_approvers_by_tenant).map(([tenantId, approvers]) => [
                  tenantId,
                  [...approvers]
                ])
              )
            : undefined,
          allowed_approvers_by_risk: profile.approval_policy.allowed_approvers_by_risk
            ? Object.fromEntries(
                Object.entries(profile.approval_policy.allowed_approvers_by_risk).map(([riskLevel, approvers]) => [
                  riskLevel,
                  [...approvers]
                ])
              )
            : undefined,
          allowed_approvers_by_tenant_and_risk: profile.approval_policy.allowed_approvers_by_tenant_and_risk
            ? Object.fromEntries(
                Object.entries(profile.approval_policy.allowed_approvers_by_tenant_and_risk).map(
                  ([tenantId, byRisk]) => [
                    tenantId,
                    Object.fromEntries(
                      Object.entries(byRisk).map(([riskLevel, approvers]) => [riskLevel, [...approvers]])
                    )
                  ]
                )
              )
            : undefined
        }
      : undefined,
    multi_agent_config: profile.multi_agent_config ? { ...profile.multi_agent_config } : undefined,
    context_budget: profile.context_budget ? { ...profile.context_budget } : undefined,
    metadata: profile.metadata ? { ...profile.metadata } : undefined
  };
}

function hasExplicitPersistence(infrastructure: AgentRuntimeInfrastructure): boolean {
  return Boolean(
    infrastructure.memoryPersistence ||
      infrastructure.checkpointStore
  );
}

function createDefaultSqliteRuntimeInfrastructure(agentId: string): AgentRuntimeInfrastructure {
  const filename = resolveDefaultRuntimeSqlitePath(agentId);
  return {
    stateStore: new SqliteRuntimeStateStore({ filename }),
    memoryPersistence: createSqliteMemoryPersistence({ filename }),
    checkpointStore: new SqliteCheckpointStore({ filename })
  };
}

function resolveDefaultRuntimeSqlitePath(agentId: string): string {
  const runtimeDirectory = join(process.cwd(), ".neurocore", "runtime");
  mkdirSync(runtimeDirectory, { recursive: true });
  return join(runtimeDirectory, `${sanitizeFileSegment(agentId)}.sqlite`);
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function deriveSqlitePersistenceFromStateStore(
  stateStore: RuntimeStateStore | undefined,
  infrastructure: AgentRuntimeInfrastructure
): AgentRuntimeInfrastructure {
  if (!(stateStore instanceof SqliteRuntimeStateStore)) {
    return {};
  }

  const filename = stateStore.getFilename();
  const derived: AgentRuntimeInfrastructure = {};

  if (!infrastructure.memoryPersistence) {
    derived.memoryPersistence = createSqliteMemoryPersistence({ filename });
  }
  if (!infrastructure.checkpointStore) {
    derived.checkpointStore = new SqliteCheckpointStore({ filename });
  }

  return derived;
}
