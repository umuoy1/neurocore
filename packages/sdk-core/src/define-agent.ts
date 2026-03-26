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
import { AgentRuntime } from "@neurocore/runtime-core";
import { AgentSessionHandle } from "./session-handle.js";

export interface DefineAgentOptions {
  id: string;
  name?: string;
  role: string;
  version?: string;
  schemaVersion?: string;
  domain?: string;
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
    return this;
  }

  public registerMemoryProvider(provider: MemoryProvider): this {
    this.memoryProviders.push(provider);
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
    return this;
  }

  public useRuntimeStateStore(factory: () => RuntimeStateStore): this {
    this.runtimeStateStoreFactory = factory;
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

    const runtime = new AgentRuntime({
      reasoner: this.reasoner,
      memoryProviders: this.memoryProviders,
      predictors: this.predictors,
      policyProviders: this.policyProviders,
      skillProviders: this.skillProviders,
      stateStore: this.runtimeStateStoreFactory?.()
    });
    for (const tool of this.tools) {
      runtime.tools.register(tool);
    }
    return runtime;
  }
}

export function defineAgent(options: DefineAgentOptions): AgentBuilder {
  return new AgentBuilder(options);
}
