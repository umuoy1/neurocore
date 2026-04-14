import type {
  MetaDecision,
  MetaDecisionV2
} from "@neurocore/protocol";

export function toLegacyMetaDecision(decision: MetaDecisionV2): MetaDecision {
  if (decision.control_action === "abort") {
    return {
      decision_type: "abort",
      selected_action_id: decision.selected_action_id,
      confidence: decision.confidence,
      meta_state: decision.meta_state,
      meta_actions: [decision.control_action],
      risk_summary: decision.risk_summary,
      budget_summary: decision.budget_summary,
      requires_human_approval: false,
      rejection_reasons: decision.rejection_reasons,
      explanation: decision.rationale
    };
  }

  const decisionType =
    decision.control_action === "execute-with-approval" || decision.control_action === "ask-human"
      ? "request_approval"
      : "execute_action";

  return {
    decision_type: decisionType,
    selected_action_id: decision.selected_action_id,
    confidence: decision.confidence,
    meta_state: decision.meta_state,
    meta_actions: [decision.control_action],
    risk_summary: decision.risk_summary,
    budget_summary: decision.budget_summary,
    requires_human_approval: decision.requires_approval,
    explanation: decision.rationale
  };
}

export function toControlModeFromDecisionV2(decision: MetaDecisionV2 | undefined) {
  if (!decision) {
    return "fast-path";
  }
  if (decision.control_action === "abort") {
    return "blocked";
  }
  if (decision.control_action === "execute-with-approval" || decision.control_action === "ask-human") {
    return "approval";
  }
  if (decision.decision_source === "deep") {
    return "deep-eval";
  }
  return "fast-path";
}
