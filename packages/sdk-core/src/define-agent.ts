import type {
  AgentProfile,
  CreateSessionCommand,
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
import { AgentRuntime, type AgentRuntimeOptions } from "@neurocore/runtime-core";
import { ToolPolicyProvider } from "@neurocore/policy-core";
import { AgentSessionHandle } from "./session-handle.js";

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
      | "worldStateGraph"
      | "perceptionPipeline"
      | "forwardSimulator"
      | "agentRegistry"
      | "interAgentBus"
      | "taskDelegator"
      | "distributedGoalManager"
      | "agentLifecycleManager"
      | "sharedStateStore"
      | "coordinationStrategy"
    >
  > {}

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

  public configurePolicy(options: { blockedTools?: string[]; requiredApprovalTools?: string[] }): this {
    this.policyProviders.push(new ToolPolicyProvider(options));
    this.invalidateRuntime();
    return this;
  }

  public registerTool(tool: Tool): this {
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
    this.memoryProviders.push(provider);
    this.invalidateRuntime();
    return this;
  }

  public registerPredictor(predictor: Predictor): this {
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
    this.policyProviders.push(provider);
    this.profile.policies.policy_ids.push(provider.name);
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

  public createSession(command: CreateSessionCommand): AgentSessionHandle {
    const runtime = this.createRuntime();
    const session = runtime.createSession(this.profile, command);
    return new AgentSessionHandle(runtime, this.profile, session.session_id, command.initial_input);
  }

  public createSessionFromCheckpoint(checkpoint: SessionCheckpoint): AgentSessionHandle {
    const runtime = this.createRuntime();
    const session = runtime.restoreSession(checkpoint);
    return new AgentSessionHandle(
      runtime,
      this.profile,
      session.session_id,
      checkpoint.pending_input
    );
  }

  public connectSession(sessionId: string, initialInput?: UserInput): AgentSessionHandle {
    const runtime = this.createRuntime();
    const session = runtime.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return new AgentSessionHandle(runtime, this.profile, session.session_id, initialInput);
  }

  public getProfile(): AgentProfile {
    return this.profile;
  }

  private createRuntime(): AgentRuntime {
    if (!this.reasoner) {
      throw new Error("AgentBuilder requires a reasoner before creating a session.");
    }

    if (!this.runtime) {
      const runtime = new AgentRuntime({
        reasoner: this.reasoner,
        memoryProviders: this.memoryProviders,
        predictors: this.predictors,
        policyProviders: this.policyProviders,
        skillProviders: this.skillProviders,
        stateStore: this.runtimeStateStoreFactory?.(),
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
