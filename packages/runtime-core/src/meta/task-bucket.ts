import type {
  AgentProfile,
  CandidateAction,
  MetaSignalFrame,
  MetaState,
  Prediction,
  UserInput
} from "@neurocore/protocol";

export interface CalibrationTaskBucketDescriptor {
  taskBucket: string;
  domain: string;
  actionType: string;
  riskLevel: string;
  toolFamily: string;
  retrievalNeeded: boolean;
  predictorId?: string;
}

export function buildCalibrationTaskBucket(input: {
  profile?: AgentProfile;
  frame?: MetaSignalFrame;
  input?: UserInput;
  action?: CandidateAction;
  actions?: CandidateAction[];
  predictions?: Prediction[];
  metaState?: MetaState;
  predictorId?: string;
}): CalibrationTaskBucketDescriptor {
  const action =
    input.action ??
    pickAnchorAction(input.actions ?? [], input.predictions ?? []);
  const riskLevel = deriveRiskLevel(action, input.metaState);
  const toolFamily = deriveToolFamily(action?.tool_name);
  const actionType = action?.action_type ?? "unknown";
  const domain = input.profile?.domain?.trim() || input.profile?.role?.trim() || "general";
  const retrievalNeeded = deriveRetrievalNeeded(input.frame, input.input);
  const predictorId = input.predictorId ?? pickPredictorId(action?.action_id, input.predictions ?? []);
  const taskBucket = [
    domain,
    actionType,
    riskLevel,
    toolFamily,
    retrievalNeeded ? "retrieval" : "direct"
  ].join(":");

  return {
    taskBucket,
    domain,
    actionType,
    riskLevel,
    toolFamily,
    retrievalNeeded,
    predictorId
  };
}

function pickAnchorAction(actions: CandidateAction[], predictions: Prediction[]) {
  if (actions.length === 0) {
    return undefined;
  }
  const highRisk = actions.find((action) => action.side_effect_level === "high");
  if (highRisk) {
    return highRisk;
  }
  const callTool = actions.find((action) => action.action_type === "call_tool");
  if (callTool) {
    return callTool;
  }
  if (predictions.length > 0) {
    const bestPrediction = [...predictions].sort(
      (left, right) => (right.success_probability ?? 0) - (left.success_probability ?? 0)
    )[0];
    const matched = actions.find((action) => action.action_id === bestPrediction?.action_id);
    if (matched) {
      return matched;
    }
  }
  return actions[0];
}

function deriveRiskLevel(action: CandidateAction | undefined, metaState?: MetaState) {
  if (metaState === "high-risk" || action?.side_effect_level === "high") {
    return "high";
  }
  if (
    metaState === "high-conflict" ||
    metaState === "evidence-insufficient" ||
    metaState === "needs-deep-eval" ||
    action?.side_effect_level === "medium"
  ) {
    return "medium";
  }
  return "low";
}

function deriveToolFamily(toolName?: string) {
  if (!toolName) {
    return "none";
  }
  return toolName.split(/[_./:-]/)[0] || toolName;
}

function deriveRetrievalNeeded(frame?: MetaSignalFrame, input?: UserInput) {
  if (frame) {
    return (
      frame.evidence_signals.retrieval_coverage < 0.65 ||
      frame.evidence_signals.evidence_freshness < 0.45 ||
      frame.evidence_signals.missing_critical_evidence_flags.length > 0
    );
  }

  const content = input?.content?.toLowerCase() ?? "";
  return /\b(latest|current|today|now|price|news|search|lookup)\b/.test(content);
}

function pickPredictorId(actionId: string | undefined, predictions: Prediction[]) {
  if (!actionId) {
    return undefined;
  }
  const names = new Set(
    predictions
      .filter((prediction) => prediction.action_id === actionId)
      .map((prediction) => prediction.predictor_name)
  );
  return names.size === 1 ? Array.from(names)[0] : undefined;
}
