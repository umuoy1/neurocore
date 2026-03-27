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
  UserInput,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import { DefaultPolicyProvider } from "@neurocore/policy-core";
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
      services
    };

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
    const reasonerProposals = await input.reasoner.plan(enrichedContext);
    const proposals = [...memoryState.proposals, ...skillState.proposals, ...reasonerProposals];
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
    const actions = await input.reasoner.respond(enrichedContext);
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
    const workspace = this.workspaceCoordinator.buildSnapshot({
      sessionId: input.session.session_id,
      cycleId,
      contextSummary: input.input.content,
      goals: input.goals,
      proposals,
      candidateActions: actions,
      budgetState: input.session.budget_state,
      memoryDigest: memoryState.digest,
      skillDigest: skillState.digest,
      policyDecisions: policies
    });

    const decision = await input.metaController.evaluate(
      { ...enrichedContext, workspace },
      actions,
      predictions,
      policies
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
  }

  private async collectMemoryState(
    ctx: ModuleContext,
    providers: MemoryProvider[]
  ): Promise<{ proposals: Proposal[]; digest: MemoryDigest[] }> {
    const results = await Promise.all(
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
    const predictions = await Promise.all(
      actions.flatMap((action) => predictors.map(async (predictor) => predictor.predict(ctx, action)))
    );

    return predictions.filter((prediction): prediction is Prediction => prediction !== null);
  }

  private async collectSkillState(
    ctx: ModuleContext,
    providers: SkillProvider[]
  ): Promise<{ proposals: Proposal[]; digest: SkillDigest[] }> {
    const results = await Promise.all(
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
    const policyResults = await Promise.all(
      actions.flatMap((action) => policies.map(async (policy) => policy.evaluateAction(ctx, action)))
    );

    return policyResults.flat();
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
