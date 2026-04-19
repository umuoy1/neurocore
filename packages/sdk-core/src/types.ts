import type { ApprovalRequest } from "@neurocore/protocol";
import type { AgentRunLoopResult } from "@neurocore/runtime-core";

export type MaybePromise<T> = T | Promise<T>;

export interface SessionEventFilter {
  event_types?: import("@neurocore/protocol").NeuroCoreEventType[];
  cycle_id?: string;
  since_sequence_no?: number;
}

export interface PaginationInput {
  offset?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
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

export interface SessionHandleLike<TSession = unknown, TReplay = unknown, TSettled = unknown> {
  readonly id: string;
  getSession(): MaybePromise<TSession | undefined>;
  getState(): import("@neurocore/protocol").SessionState | undefined;
  isTerminal(): boolean;
  isRunning(): boolean;
  checkpoint(): MaybePromise<import("@neurocore/protocol").SessionCheckpoint>;
  suspend(): MaybePromise<import("@neurocore/protocol").SessionCheckpoint>;
  replay(): MaybePromise<TReplay>;
  waitForSettled(options?: { pollIntervalMs?: number; timeoutMs?: number }): Promise<TSettled>;
  cleanup(options?: { force?: boolean }): MaybePromise<void>;
}
