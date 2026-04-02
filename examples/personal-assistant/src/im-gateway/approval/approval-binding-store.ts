import type { ApprovalBinding, IMPlatform } from "../types.js";

export interface ApprovalBindingStore {
  upsertBinding(binding: ApprovalBinding): void;
  getBinding(platform: IMPlatform, platformMessageId: string): ApprovalBinding | undefined;
  getBindingByApprovalId(approvalId: string): ApprovalBinding | undefined;
  deleteByApprovalId(approvalId: string): void;
}
