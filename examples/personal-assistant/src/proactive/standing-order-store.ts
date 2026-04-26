import type { CreateStandingOrderInput, StandingOrderQuery, StandingOrderRecord, StandingOrderStatus } from "./types.js";

export interface StandingOrderStore {
  create(input: CreateStandingOrderInput): StandingOrderRecord;
  get(orderId: string): StandingOrderRecord | undefined;
  listActive(query: StandingOrderQuery): StandingOrderRecord[];
  updateStatus(orderId: string, status: StandingOrderStatus, updatedAt?: string): StandingOrderRecord | undefined;
  markApplied(orderId: string, appliedAt?: string): StandingOrderRecord | undefined;
  close?(): void;
}
