import type {
  ActionExecution,
  AgentSession,
  CandidateAction,
  CycleTrace,
  Episode,
  Goal,
  Observation,
  Prediction,
  PredictionError,
  Proposal,
  SkillDefinition,
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
  | "skill.matched"
  | "skill.executed"
  | "skill.promoted"
  | "budget.exceeded"
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
  | EventEnvelope<CandidateAction>
  | EventEnvelope<ActionExecution>
  | EventEnvelope<Observation>
  | EventEnvelope<Episode>
  | EventEnvelope<Prediction>
  | EventEnvelope<PredictionError>
  | EventEnvelope<CycleTrace>
  | EventEnvelope<SkillDefinition>;
