import type { ApprovalRequest } from "@neurocore/protocol";
import type { AgentRunLoopResult } from "@neurocore/runtime-core";

export interface SessionApprovalDecisionInput {
  approval_id?: string;
  approver_id: string;
  decision: "approved" | "rejected";
  comment?: string;
}

export interface SessionApprovalDecisionResult {
  approval: ApprovalRequest;
  run?: AgentRunLoopResult;
}
