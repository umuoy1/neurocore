import type { ApprovalRequest } from "@neurocore/protocol";
import type { AgentRunLoopResult } from "@neurocore/runtime-core";

export interface SessionEventFilter {
  event_types?: import("@neurocore/protocol").NeuroCoreEventType[];
  cycle_id?: string;
  since_sequence_no?: number;
}

export interface SessionApprovalDecisionInput {
  approval_id?: string;
  approver_id: string;
  decision: "approved" | "rejected";
  comment?: string;
  reviewer_identity?: import("@neurocore/protocol").ApprovalReviewerIdentity;
}

export interface SessionApprovalDecisionResult {
  approval: ApprovalRequest;
  run?: AgentRunLoopResult;
}
