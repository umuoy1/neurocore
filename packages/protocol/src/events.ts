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
  | "session.failed"
  | "sensor.reading"
  | "actuator.command"
  | "actuator.result"
  | "world_state.updated"
  | "simulation.completed"
  | "device.registered"
  | "device.error"
  | "agent.registered"
  | "agent.deregistered"
  | "agent.status_changed"
  | "agent.heartbeat_lost"
  | "delegation.requested"
  | "delegation.accepted"
  | "delegation.rejected"
  | "delegation.completed"
  | "delegation.failed"
  | "delegation.timeout"
  | "auction.started"
  | "auction.bid_received"
  | "auction.completed"
  | "coordination.started"
  | "coordination.assignment_created"
  | "coordination.completed"
  | "world_state.conflict_detected"
  | "world_state.conflict_resolved";

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
