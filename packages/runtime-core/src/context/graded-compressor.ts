import type {
  CompressResult,
  ContextCompressor,
  Proposal,
  TokenEstimator,
  WorkspaceSnapshot
} from "@neurocore/protocol";

export class GradedContextCompressor implements ContextCompressor {
  public compress(
    snapshot: WorkspaceSnapshot,
    proposals: Proposal[],
    tokenBudget: number,
    estimator: TokenEstimator
  ): CompressResult {
    let currentSnapshot: WorkspaceSnapshot = structuredClone(snapshot);
    let currentProposals: Proposal[] = structuredClone(proposals);
    const stagesApplied: string[] = [];
    let tokensSaved = 0;
    const initialTokens = estimator.estimate(JSON.stringify({ workspace: currentSnapshot, proposals: currentProposals }));

    // Stage 1: Halve memory_digest entries
    if (estimator.estimate(JSON.stringify({ workspace: currentSnapshot, proposals: currentProposals })) > tokenBudget) {
      const half = Math.ceil(currentSnapshot.memory_digest.length / 2);
      currentSnapshot = { ...currentSnapshot, memory_digest: currentSnapshot.memory_digest.slice(0, half) };
      stagesApplied.push("memory_digest_halved");
    }

    // Stage 2: Slim proposals — keep only salience + type
    if (estimator.estimate(JSON.stringify({ workspace: currentSnapshot, proposals: currentProposals })) > tokenBudget) {
      currentProposals = currentProposals.map((p) => ({
        ...p,
        payload: {},
        explanation: undefined,
        metadata: undefined,
        supersedes: undefined,
        estimated_cost: undefined,
        estimated_latency_ms: undefined
      }));
      stagesApplied.push("proposals_slimmed");
    }

    // Stage 3: Truncate goals + context_summary
    if (estimator.estimate(JSON.stringify({ workspace: currentSnapshot, proposals: currentProposals })) > tokenBudget) {
      const activeGoals = currentSnapshot.active_goals.filter((g) => g.status === "active");
      const rootGoals = currentSnapshot.active_goals.filter((g) => g.priority >= 3);
      currentSnapshot = {
        ...currentSnapshot,
        active_goals: activeGoals.length > 0 ? activeGoals : rootGoals.length > 0 ? rootGoals : currentSnapshot.active_goals.slice(0, 1),
        context_summary: currentSnapshot.context_summary.slice(0, 500)
      };
      stagesApplied.push("goals_truncated");
    }

    // Stage 4: Last resort — aggressive truncation
    if (estimator.estimate(JSON.stringify({ workspace: currentSnapshot, proposals: currentProposals })) > tokenBudget) {
      currentSnapshot = {
        ...currentSnapshot,
        context_summary: currentSnapshot.context_summary.slice(0, 200),
        policy_decisions: []
      };
      stagesApplied.push("final_truncation");
    }

    const finalTokens = estimator.estimate(JSON.stringify({ workspace: currentSnapshot, proposals: currentProposals }));
    tokensSaved = initialTokens - finalTokens;

    return { snapshot: currentSnapshot, proposals: currentProposals, tokensSaved, stagesApplied };
  }
}
