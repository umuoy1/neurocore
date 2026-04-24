import type {
  BudgetAssessment,
  BudgetState,
  CandidateAction,
  CompetitionConflict,
  CompetitionEntry,
  CompetitionLog,
  Goal,
  MemoryDigest,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  PolicyDecision,
  Proposal,
  ProposalSource,
  RiskAssessment,
  SkillDigest,
  WorldStateDigest,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

export interface BuildWorkspaceInput {
  sessionId: string;
  cycleId: string;
  contextSummary: string;
  goals: Goal[];
  proposals: Proposal[];
  candidateActions: CandidateAction[];
  budgetState: BudgetState;
  memoryDigest?: MemoryDigest[];
  memoryRetrievalPlan?: MemoryRetrievalPlan;
  memoryRecallBundle?: MemoryRecallBundle;
  skillDigest?: SkillDigest[];
  policyDecisions?: PolicyDecision[];
  worldStateDigest?: WorldStateDigest;
}

export interface WorkspaceCoordinatorConfig {
  sourceWeights?: Record<ProposalSource, number>;
  conflictThreshold?: number;
}

interface BroadcastEntry {
  proposal: Proposal;
  source: ProposalSource;
}

const DEFAULT_SOURCE_WEIGHTS: Record<ProposalSource, number> = {
  reasoner: 1.0,
  memory: 0.8,
  skill: 0.9
};

const DEFAULT_CONFLICT_THRESHOLD = 0.05;

export class WorkspaceCoordinator {
  private readonly sourceWeights: Record<ProposalSource, number>;
  private readonly conflictThreshold: number;

  constructor(config?: WorkspaceCoordinatorConfig) {
    this.sourceWeights = config?.sourceWeights ?? DEFAULT_SOURCE_WEIGHTS;
    this.conflictThreshold = config?.conflictThreshold ?? DEFAULT_CONFLICT_THRESHOLD;
  }

  public buildSnapshot(input: BuildWorkspaceInput): WorkspaceSnapshot {
    const broadcastState = this.broadcast(input.proposals);
    const { entries, conflicts } = this.compete(broadcastState, input.goals);
    const { selectedProposalId, selectionReasoning } = this.select(entries, conflicts);

    const risk = this.computeRisk(input.proposals);
    const winner = input.proposals.find((p) => p.proposal_id === selectedProposalId);

    const competitionLog: CompetitionLog = {
      entries,
      conflicts,
      selection_reasoning: selectionReasoning
    };

    return {
      workspace_id: generateId("wsp"),
      schema_version: "0.1.0",
      session_id: input.sessionId,
      cycle_id: input.cycleId,
      input_events: [],
      active_goals: input.goals.map((goal) => ({
        goal_id: goal.goal_id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority
      })),
      context_summary: input.contextSummary,
      memory_digest: input.memoryDigest ?? [],
      memory_retrieval_plan: input.memoryRetrievalPlan,
      memory_recall_bundle: input.memoryRecallBundle,
      skill_digest: input.skillDigest ?? [],
      world_state_digest: input.worldStateDigest,
      candidate_actions: input.candidateActions,
      plan_graph: buildPlanGraph(input.candidateActions),
      selected_proposal_id: selectedProposalId,
      risk_assessment: risk,
      confidence_assessment: {
        confidence: winner?.confidence ?? 0.5,
        summary: "Derived from the top-ranked proposal."
      },
      budget_assessment: this.computeBudget(input.budgetState),
      policy_decisions: input.policyDecisions ?? [],
      decision_reasoning: selectionReasoning,
      competition_log: competitionLog,
      created_at: nowIso()
    };
  }

  private broadcast(proposals: Proposal[]): BroadcastEntry[] {
    return proposals.map((proposal) => ({
      proposal,
      source: this.inferSource(proposal)
    }));
  }

  private compete(
    broadcastState: BroadcastEntry[],
    goals: Goal[]
  ): { entries: CompetitionEntry[]; conflicts: CompetitionConflict[] } {
    if (broadcastState.length === 0) {
      return { entries: [], conflicts: [] };
    }

    const fusedMap = new Map<string, BroadcastEntry & { fusedWith: string[] }>();
    for (const entry of broadcastState) {
      let fused = false;
      for (const [existingId, existing] of fusedMap) {
        if (this.proposalsOverlap(existing.proposal, entry.proposal)) {
          const primary = existing.proposal.salience_score >= entry.proposal.salience_score
            ? existing
            : { ...entry, fusedWith: [...existing.fusedWith, existing.proposal.proposal_id] };
          const secondary = primary === existing ? entry : existing;

          if (primary === existing) {
            existing.fusedWith.push(entry.proposal.proposal_id);
          }

          primary.proposal = {
            ...primary.proposal,
            salience_score: this.computeFusedSalience(
              primary.proposal.salience_score,
              secondary.proposal.salience_score
            )
          };
          fused = true;
          break;
        }
      }
      if (!fused) {
        fusedMap.set(entry.proposal.proposal_id, { ...entry, fusedWith: [] });
      }
    }

    const activeGoalKeywords = this.extractGoalKeywords(goals);

    const scoredEntries: CompetitionEntry[] = [];
    for (const entry of fusedMap.values()) {
      const sourceWeight = this.sourceWeights[entry.source];
      const goalAlignment = this.computeGoalAlignment(entry.proposal, activeGoalKeywords);
      const finalScore = entry.proposal.salience_score * sourceWeight + goalAlignment * 0.15;

      scoredEntries.push({
        proposal_id: entry.proposal.proposal_id,
        module_name: entry.proposal.module_name,
        source: entry.source,
        raw_salience: entry.proposal.salience_score,
        source_weight: sourceWeight,
        goal_alignment: goalAlignment,
        final_score: finalScore,
        rank: 0,
        fused_with: entry.fusedWith.length > 0 ? entry.fusedWith : undefined
      });
    }

    scoredEntries.sort((a, b) => b.final_score - a.final_score);
    for (let i = 0; i < scoredEntries.length; i++) {
      scoredEntries[i].rank = i + 1;
    }

    const conflicts = this.detectConflicts(scoredEntries);

    return { entries: scoredEntries, conflicts };
  }

  private select(
    entries: CompetitionEntry[],
    conflicts: CompetitionConflict[]
  ): { selectedProposalId: string | undefined; selectionReasoning: string } {
    if (entries.length === 0) {
      return {
        selectedProposalId: undefined,
        selectionReasoning: "No proposals submitted; workspace has empty competition."
      };
    }

    const winner = entries[0];
    const parts: string[] = [
      `Selected "${winner.module_name}" (${winner.source}) with final_score=${winner.final_score.toFixed(4)} (raw_salience=${winner.raw_salience}, weight=${winner.source_weight}, goal_alignment=${winner.goal_alignment}).`
    ];

    if (winner.fused_with && winner.fused_with.length > 0) {
      parts.push(`Fused with proposals: ${winner.fused_with.join(", ")}.`);
    }

    if (conflicts.length > 0) {
      const conflictIds = conflicts.flatMap((c) => c.proposal_ids);
      parts.push(`Conflict detected among: ${conflictIds.join(", ")} (score_gap < ${this.conflictThreshold}).`);
    }

    if (entries.length > 1) {
      const gap = winner.final_score - entries[1].final_score;
      parts.push(`Runner-up: "${entries[1].module_name}" with final_score=${entries[1].final_score.toFixed(4)} (gap=${gap.toFixed(4)}).`);
    }

    return {
      selectedProposalId: winner.proposal_id,
      selectionReasoning: parts.join(" ")
    };
  }

  private inferSource(proposal: Proposal): ProposalSource {
    if (proposal.proposal_type === "memory_recall") return "memory";
    if (proposal.proposal_type === "skill_match") return "skill";
    return "reasoner";
  }

  private proposalsOverlap(a: Proposal, b: Proposal): boolean {
    if (a.proposal_type !== b.proposal_type) return false;
    const textA = this.payloadText(a);
    const textB = this.payloadText(b);
    return this.textOverlap(textA, textB) > 0.3;
  }

  private payloadText(proposal: Proposal): string {
    return Object.values(proposal.payload).join(" ").toLowerCase();
  }

  private textOverlap(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private computeFusedSalience(primary: number, secondary: number): number {
    return Math.min(1.0, primary + secondary * 0.3);
  }

  private extractGoalKeywords(goals: Goal[]): string[] {
    const keywords: string[] = [];
    for (const goal of goals) {
      if (goal.status !== "active") continue;
      const words = `${goal.title} ${goal.description ?? ""}`.toLowerCase().split(/\s+/);
      keywords.push(...words.filter((w) => w.length > 2));
    }
    return keywords;
  }

  private computeGoalAlignment(proposal: Proposal, goalKeywords: string[]): number {
    if (goalKeywords.length === 0) return 0;
    const payloadWords = new Set(this.payloadText(proposal).split(/\s+/));
    const matched = goalKeywords.filter((kw) => payloadWords.has(kw));
    return Math.min(1.0, matched.length / goalKeywords.length);
  }

  private detectConflicts(entries: CompetitionEntry[]): CompetitionConflict[] {
    const conflicts: CompetitionConflict[] = [];
    for (let i = 0; i < entries.length - 1; i++) {
      const gap = entries[i].final_score - entries[i + 1].final_score;
      if (gap < this.conflictThreshold) {
        const ids = [entries[i].proposal_id, entries[i + 1].proposal_id] as [string, ...string[]];
        for (let j = i + 2; j < entries.length; j++) {
          if (entries[i].final_score - entries[j].final_score < this.conflictThreshold) {
            ids.push(entries[j].proposal_id);
          }
        }
        conflicts.push({
          proposal_ids: ids,
          conflict_type: "overlapping_action",
          score_gap: gap
        });
      }
    }
    return conflicts;
  }

  private computeRisk(proposals: Proposal[]): RiskAssessment {
    const risk = proposals.reduce((max, proposal) => Math.max(max, proposal.risk ?? 0), 0);
    return {
      risk,
      summary: "Highest proposal risk in the current cycle."
    };
  }

  private computeBudget(budgetState: BudgetState): BudgetAssessment {
    const cycleExceeded =
      budgetState.cycle_limit !== undefined &&
      (budgetState.cycle_used ?? 0) >= budgetState.cycle_limit;
    const toolExceeded =
      budgetState.tool_call_limit !== undefined &&
      (budgetState.tool_call_used ?? 0) >= budgetState.tool_call_limit;
    const tokenExceeded =
      budgetState.token_budget_total !== undefined &&
      (budgetState.token_budget_used ?? 0) >= budgetState.token_budget_total;

    if (cycleExceeded) {
      return {
        within_budget: false,
        summary: `Cycle limit reached (${budgetState.cycle_used}/${budgetState.cycle_limit}).`
      };
    }
    if (toolExceeded) {
      return {
        within_budget: false,
        summary: `Tool call limit reached (${budgetState.tool_call_used}/${budgetState.tool_call_limit}).`
      };
    }
    if (tokenExceeded) {
      return {
        within_budget: false,
        summary: `Token budget exceeded (${budgetState.token_budget_used}/${budgetState.token_budget_total}).`
      };
    }
    const costExceeded =
      budgetState.cost_budget_total !== undefined &&
      (budgetState.cost_budget_used ?? 0) >= budgetState.cost_budget_total;
    if (costExceeded) {
      return {
        within_budget: false,
        summary: `Cost budget exceeded (${budgetState.cost_budget_used}/${budgetState.cost_budget_total}).`
      };
    }
    return { within_budget: true, summary: "Within budget." };
  }
}

function buildPlanGraph(actions: CandidateAction[]) {
  if (actions.length === 0) {
    return undefined;
  }

  const nodes = actions.map((action) => ({
    action_id: action.action_id,
    action_type: action.action_type,
    title: action.title,
    depends_on_action_ids:
      Array.isArray(action.depends_on_action_ids) && action.depends_on_action_ids.length > 0
        ? [...action.depends_on_action_ids]
        : undefined,
    next_action_id_on_success: action.next_action_id_on_success,
    next_action_id_on_failure: action.next_action_id_on_failure,
    plan_group_id: action.plan_group_id
  }));

  const grouped = new Map<string, string[]>();
  for (const action of actions) {
    const groupId = typeof action.plan_group_id === "string" && action.plan_group_id.trim().length > 0
      ? action.plan_group_id
      : undefined;
    if (!groupId) {
      continue;
    }
    const entry = grouped.get(groupId) ?? [];
    entry.push(action.action_id);
    grouped.set(groupId, entry);
  }

  return {
    groups: [...grouped.entries()].map(([plan_group_id, node_ids]) => ({
      plan_group_id,
      node_ids
    })),
    nodes
  };
}
