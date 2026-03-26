import type {
  BudgetAssessment,
  CandidateAction,
  Goal,
  MemoryDigest,
  PolicyDecision,
  Proposal,
  RiskAssessment,
  SkillDigest,
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
  memoryDigest?: MemoryDigest[];
  skillDigest?: SkillDigest[];
  policyDecisions?: PolicyDecision[];
}

export class WorkspaceCoordinator {
  public buildSnapshot(input: BuildWorkspaceInput): WorkspaceSnapshot {
    const risk = this.computeRisk(input.proposals);
    const budget = this.computeBudget(input.candidateActions);
    const selectedProposal = [...input.proposals].sort(
      (left, right) => right.salience_score - left.salience_score
    )[0];

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
      skill_digest: input.skillDigest ?? [],
      candidate_actions: input.candidateActions,
      selected_proposal_id: selectedProposal?.proposal_id,
      risk_assessment: risk,
      confidence_assessment: {
        confidence: selectedProposal?.confidence ?? 0.5,
        summary: "Derived from the top-ranked proposal."
      },
      budget_assessment: budget,
      policy_decisions: input.policyDecisions ?? [],
      decision_reasoning: selectedProposal?.explanation,
      created_at: nowIso()
    };
  }

  private computeRisk(proposals: Proposal[]): RiskAssessment {
    const risk = proposals.reduce((max, proposal) => Math.max(max, proposal.risk ?? 0), 0);
    return {
      risk,
      summary: "Highest proposal risk in the current cycle."
    };
  }

  private computeBudget(actions: CandidateAction[]): BudgetAssessment {
    return {
      within_budget: actions.length < 20,
      summary: "MVP budget check only validates candidate action count."
    };
  }
}
