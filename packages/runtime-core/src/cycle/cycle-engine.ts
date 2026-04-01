import { DefaultPolicyProvider } from "@neurocore/policy-core";
import type {
  AgentProfile,
  CandidateAction,
  Goal,
  MemoryDigest,
  MemoryProvider,
  MetaDecision,
  ModuleContext,
  Observation,
  PolicyProvider,
  Prediction,
  Predictor,
  Proposal,
  Reasoner,
  SkillDigest,
  SkillProvider,
  TokenEstimator,
  UserInput,
  WorldStateDigest,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import type { DeviceRegistry, PerceptionPipeline } from "@neurocore/device-core";
import type { WorldStateGraph } from "@neurocore/world-model";
import type { TaskDelegator, AgentRegistry } from "@neurocore/multi-agent";
import { GradedContextCompressor } from "../context/graded-compressor.js";
import { DefaultTokenEstimator } from "../context/token-estimator.js";
import { debugLog } from "../utils/debug.js";
import { generateId, nowIso } from "../utils/ids.js";
import { WorkspaceCoordinator } from "../workspace/workspace-coordinator.js";

export interface CycleExecutionInput {
  tenantId: string;
  session: ModuleContext["session"];
  profile: AgentProfile;
  input: UserInput;
  goals: Goal[];
  reasoner: Reasoner;
  metaController: ModuleContext["services"] extends never ? never : import("@neurocore/protocol").MetaController;
  policies?: PolicyProvider[];
  memoryProviders?: MemoryProvider[];
  predictors?: Predictor[];
  skillProviders?: SkillProvider[];
  tokenEstimator?: TokenEstimator;
  predictionErrorRate?: number;
  deviceRegistry?: DeviceRegistry;
  perceptionPipeline?: PerceptionPipeline;
  worldStateGraph?: WorldStateGraph;
  taskDelegator?: TaskDelegator;
  agentRegistry?: AgentRegistry;
}

export interface CycleExecutionResult {
  cycleId: string;
  workspace: WorkspaceSnapshot;
  proposals: Proposal[];
  actions: CandidateAction[];
  predictions: Prediction[];
  decision: MetaDecision;
  observation?: Observation;
}

export class CycleEngine {
  private readonly workspaceCoordinator = new WorkspaceCoordinator();

  public async run(input: CycleExecutionInput): Promise<CycleExecutionResult> {
    const cycleId = generateId("cyc");
    debugLog("cycle", "Starting cycle", {
      sessionId: input.session.session_id,
      cycleId,
      goalCount: input.goals.length,
      inputChars: input.input.content.length
    });
    try {
    const services = {
      now: nowIso,
      generateId
    };
    const baseContext: ModuleContext = {
      tenant_id: input.tenantId,
      session: { ...input.session, current_cycle_id: cycleId, state: "running" },
      profile: input.profile,
      goals: input.goals,
      runtime_state: {
        current_input_content: input.input.content,
        current_input_metadata: input.input.metadata ?? null,
      },
      services,
      memory_config: input.profile.memory_config
    };

    let worldStateDigest: WorldStateDigest | undefined;
    if (input.deviceRegistry && input.perceptionPipeline && input.worldStateGraph) {
      try {
        const now = nowIso();
        const onlineSensors = input.deviceRegistry
          .query({ device_type: "sensor", status: "online" })
          .map((d) => d.device_id);

        if (onlineSensors.length > 0) {
          const readings = await Promise.all(
            onlineSensors.map((id) => {
              const sensor = input.deviceRegistry!.getSensor(id);
              return sensor ? sensor.read() : Promise.resolve(null);
            })
          );
          const validReadings = readings.filter((r) => r !== null);

          if (validReadings.length > 0) {
            const percepts = await input.perceptionPipeline.ingest(validReadings);
            input.worldStateGraph.decayConfidence(now);
            input.worldStateGraph.pruneExpired(now);
            if (percepts.length > 0) {
              input.worldStateGraph.applyPercepts(percepts);
            }
          }
        } else {
          input.worldStateGraph.decayConfidence(now);
          input.worldStateGraph.pruneExpired(now);
        }

        worldStateDigest = input.worldStateGraph.toDigest();
        debugLog("cycle", "Perceive phase completed", {
          sessionId: input.session.session_id,
          cycleId,
          worldStateDigest: worldStateDigest.summary
        });
      } catch (error) {
        debugLog("cycle", "Perceive phase failed", {
          sessionId: input.session.session_id,
          cycleId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const memoryState = await this.collectMemoryState(baseContext, input.memoryProviders ?? []);
    const skillState = await this.collectSkillState(baseContext, input.skillProviders ?? []);
    const enrichedContext: ModuleContext = {
      ...baseContext,
      runtime_state: {
        ...baseContext.runtime_state,
        memory_recall_proposals: memoryState.proposals,
        skill_match_proposals: skillState.proposals
      }
    };
    let reasonerProposals: Proposal[] = [];
    try {
      reasonerProposals = await input.reasoner.plan(enrichedContext);
    } catch (error) {
      debugLog("cycle", "reasoner.plan() failed", {
        sessionId: input.session.session_id,
        cycleId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    let proposals = [...memoryState.proposals, ...skillState.proposals, ...reasonerProposals];
    debugLog("cycle", "Collected proposals", {
      sessionId: input.session.session_id,
      cycleId,
      memoryProposalCount: memoryState.proposals.length,
      memoryDigestCount: memoryState.digest.length,
      skillProposalCount: skillState.proposals.length,
      skillDigestCount: skillState.digest.length,
      reasonerProposalCount: reasonerProposals.length,
      totalProposalCount: proposals.length
    });
    let actions: CandidateAction[] = [];
    try {
      actions = await input.reasoner.respond(enrichedContext);
    } catch (error) {
      debugLog("cycle", "reasoner.respond() failed", {
        sessionId: input.session.session_id,
        cycleId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    debugLog("cycle", "Collected candidate actions", {
      sessionId: input.session.session_id,
      cycleId,
      actionCount: actions.length,
      actionTypes: actions.map((action) => action.action_type)
    });
    const predictions = await this.collectPredictions(enrichedContext, actions, input.predictors ?? []);
    const policies = await this.collectPolicyDecisions(enrichedContext, actions, input.policies ?? [new DefaultPolicyProvider()]);
    debugLog("cycle", "Collected predictions and policy decisions", {
      sessionId: input.session.session_id,
      cycleId,
      predictionCount: predictions.length,
      policyDecisionCount: policies.length
    });
    let workspace = this.workspaceCoordinator.buildSnapshot({
      sessionId: input.session.session_id,
      cycleId,
      contextSummary: input.input.content,
      goals: input.goals,
      proposals,
      candidateActions: actions,
      budgetState: input.session.budget_state,
      memoryDigest: memoryState.digest,
      skillDigest: skillState.digest,
      policyDecisions: policies,
      worldStateDigest
    });

    const maxTokens = input.profile.context_budget?.max_context_tokens;
    const estimator = input.tokenEstimator ?? new DefaultTokenEstimator();
    if (maxTokens) {
      const totalTokens = estimator.estimate(JSON.stringify({ workspace, proposals }));
      if (totalTokens > maxTokens) {
        const compressor = new GradedContextCompressor();
        const result = compressor.compress(workspace, proposals, maxTokens, estimator);
        workspace = result.snapshot;
        proposals = result.proposals;
        debugLog("cycle", "Context compressed", {
          tokensSaved: result.tokensSaved,
          stages: result.stagesApplied
        });
      }
    }

    const inputTokens = estimator.estimate(JSON.stringify({ workspace, proposals }));
    input.session.budget_state.token_budget_used =
      (input.session.budget_state.token_budget_used ?? 0) + inputTokens;

    const costPerToken = input.profile.cost_per_token;
    if (costPerToken !== undefined && costPerToken > 0) {
      const cycleCost = inputTokens * costPerToken;
      input.session.budget_state.cost_budget_used = (input.session.budget_state.cost_budget_used ?? 0) + cycleCost;
      if (input.profile.cost_budget !== undefined) {
        input.session.budget_state.cost_budget_total = input.profile.cost_budget;
      }
    }

    const decision = await input.metaController.evaluate(
      { ...enrichedContext, workspace },
      actions,
      predictions,
      policies,
      input.predictionErrorRate
    );
    debugLog("cycle", "Meta decision completed", {
      sessionId: input.session.session_id,
      cycleId,
      decisionType: decision.decision_type,
      selectedActionId: decision.selected_action_id,
      requiresHumanApproval: decision.requires_human_approval ?? false
    });

    return {
      cycleId,
      workspace,
      proposals,
      actions,
      predictions,
      decision
    };
    } catch (error) {
      debugLog("cycle", "Cycle failed with unhandled error", {
        sessionId: input.session.session_id,
        cycleId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async collectMemoryState(
    ctx: ModuleContext,
    providers: MemoryProvider[]
  ): Promise<{ proposals: Proposal[]; digest: MemoryDigest[] }> {
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const [proposals, digest] = await Promise.all([
          provider.retrieve(ctx),
          provider.getDigest ? provider.getDigest(ctx) : Promise.resolve([])
        ]);
        return {
          providerName: provider.name,
          proposals,
          digest
        };
      })
    );

    const results = settled.filter((r): r is PromiseFulfilledResult<{ providerName: string; proposals: Proposal[]; digest: MemoryDigest[] }> => {
      if (r.status === "rejected") {
        debugLog("cycle", "MemoryProvider failed", {
          sessionId: ctx.session.session_id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        });
        return false;
      }
      return true;
    }).map(r => r.value);

    debugLog("cycle", "Collected provider memory state", {
      sessionId: ctx.session.session_id,
      cycleId: ctx.session.current_cycle_id,
      providers: results.map((result) => ({
        provider: result.providerName,
        proposalCount: result.proposals.length,
        digestCount: result.digest.length
      }))
    });

    return {
      proposals: results.flatMap((result) => result.proposals),
      digest: results
        .flatMap((result) => result.digest)
        .sort((left, right) => right.relevance - left.relevance)
    };
  }

  private async collectPredictions(
    ctx: ModuleContext,
    actions: CandidateAction[],
    predictors: Predictor[]
  ): Promise<Prediction[]> {
    const settled = await Promise.allSettled(
      actions.flatMap((action) => predictors.map(async (predictor) => predictor.predict(ctx, action)))
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<Prediction | null> => {
        if (r.status === "rejected") {
          debugLog("cycle", "Predictor failed", {
            sessionId: ctx.session.session_id,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason)
          });
          return false;
        }
        return true;
      })
      .map(r => r.value)
      .filter((prediction): prediction is Prediction => prediction !== null);
  }

  private async collectSkillState(
    ctx: ModuleContext,
    providers: SkillProvider[]
  ): Promise<{ proposals: Proposal[]; digest: SkillDigest[] }> {
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const proposals = await provider.match(ctx);
        return {
          providerName: provider.name,
          proposals,
          digest: proposals
            .filter((proposal) => proposal.proposal_type === "skill_match")
            .map((proposal) => toSkillDigest(provider.name, proposal))
        };
      })
    );

    const results = settled.filter((r): r is PromiseFulfilledResult<{ providerName: string; proposals: Proposal[]; digest: SkillDigest[] }> => {
      if (r.status === "rejected") {
        debugLog("cycle", "SkillProvider failed", {
          sessionId: ctx.session.session_id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        });
        return false;
      }
      return true;
    }).map(r => r.value);

    debugLog("cycle", "Collected skill matches", {
      sessionId: ctx.session.session_id,
      cycleId: ctx.session.current_cycle_id,
      providers: results.map((result) => ({
        provider: result.providerName,
        proposalCount: result.proposals.length,
        digestCount: result.digest.length
      }))
    });

    return {
      proposals: results.flatMap((result) => result.proposals),
      digest: results
        .flatMap((result) => result.digest)
        .sort((left, right) => right.relevance - left.relevance)
    };
  }

  private async collectPolicyDecisions(
    ctx: ModuleContext,
    actions: CandidateAction[],
    policies: PolicyProvider[]
  ) {
    const settled = await Promise.allSettled(
      actions.flatMap((action) => policies.map(async (policy) => policy.evaluateAction(ctx, action)))
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<import("@neurocore/protocol").PolicyDecision[]> => {
        if (r.status === "rejected") {
          debugLog("cycle", "PolicyProvider failed", {
            sessionId: ctx.session.session_id,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason)
          });
          return false;
        }
        return true;
      })
      .map(r => r.value)
      .flat();
  }
}

function toSkillDigest(providerName: string, proposal: Proposal): SkillDigest {
  const skillId =
    typeof proposal.payload.skill_id === "string" && proposal.payload.skill_id.trim().length > 0
      ? proposal.payload.skill_id
      : proposal.proposal_id;
  const name =
    typeof proposal.payload.skill_name === "string" && proposal.payload.skill_name.trim().length > 0
      ? proposal.payload.skill_name
      : providerName;

  return {
    skill_id: skillId,
    name,
    relevance: proposal.salience_score
  };
}
