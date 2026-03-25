import type {
  ActionExecution,
  AgentSession,
  CycleTrace,
  Goal,
  Observation,
  Prediction,
  PredictionError,
  Proposal,
  WorkspaceSnapshot
} from "./types.js";

export type NeuroCoreEventType =
  | "session.created"
  | "session.state_changed"
  | "goal.created"
  | "goal.updated"
  | "cycle.started"
  | "proposal.submitted"
  | "workspace.committed"
  | "action.selected"
  | "action.executed"
  | "observation.recorded"
  | "prediction.recorded"
  | "prediction_error.recorded"
  | "memory.written"
  | "session.completed"
  | "session.failed";

export interface EventEnvelope<T> {
  event_id: string;
  event_type: NeuroCoreEventType;
  schema_version: string;
  tenant_id: string;
  session_id?: string;
  cycle_id?: string;
  timestamp: string;
  payload: T;
}

export type NeuroCoreEvent =
  | EventEnvelope<AgentSession>
  | EventEnvelope<Goal>
  | EventEnvelope<Proposal>
  | EventEnvelope<WorkspaceSnapshot>
  | EventEnvelope<ActionExecution>
  | EventEnvelope<Observation>
  | EventEnvelope<Prediction>
  | EventEnvelope<PredictionError>
  | EventEnvelope<CycleTrace>;

