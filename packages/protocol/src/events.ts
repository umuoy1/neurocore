import type {
  ActionExecution,
  AgentSession,
  ApprovalRequest,
  AutonomousPlan,
  AutonomyDecision,
  CandidateAction,
  CycleTrace,
  Episode,
  DriftSignal,
  Goal,
  HealthReport,
  IntrinsicMotivation,
  KnowledgeSnapshot,
  MemoryGovernanceEvent,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  Observation,
  ExplorationEvent,
  PolicyUpdateEvent,
  RecoveryAction,
  RewardSignal,
  SemanticCard,
  Prediction,
  PredictionError,
  SuggestedGoal,
  SkillPruneEvent,
  SkillEvaluation,
  SkillTransferEvent,
  ProceduralSkillSpec,
  TransferResult,
  RuntimeOutput,
  RuntimeStatus,
  SessionCheckpoint,
  SkillPolicyState,
  SkillDefinition,
  SkillSelection,
  SkillTransferResult,
  WorkspaceSnapshot,
  Proposal
} from "./types.js";

export type NeuroCoreEventType =
  | "session.created"
  | "session.state_changed"
  | "session.suspended"
  | "session.resumed"
  | "runtime.status"
  | "runtime.output"
  | "goal.created"
  | "goal.updated"
  | "goal.completed"
  | "cycle.started"
  | "proposal.submitted"
  | "workspace.committed"
  | "action.selected"
  | "action.executed"
  | "observation.recorded"
  | "prediction.recorded"
  | "prediction_error.recorded"
  | "memory.written"
  | "memory.retrieval_planned"
  | "memory.retrieved"
  | "memory.episode_activated"
  | "memory.semantic_card_created"
  | "memory.skill_spec_created"
  | "memory.object_marked_suspect"
  | "memory.object_tombstoned"
  | "memory.rollback_applied"
  | "reward.computed"
  | "policy.updated"
  | "exploration.triggered"
  | "plan.generated"
  | "plan.revised"
  | "plan.status_changed"
  | "motivation.computed"
  | "goal.self_generated"
  | "transfer.attempted"
  | "transfer.validated"
  | "consolidation.completed"
  | "drift.detected"
  | "recovery.triggered"
  | "recovery.completed"
  | "health.report"
  | "skill.matched"
  | "skill.executed"
  | "skill.promoted"
  | "skill.evaluated"
  | "skill.pruned"
  | "skill.transferred"
  | "approval.requested"
  | "budget.exceeded"
  | "checkpoint.created"
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

export interface NeuroCoreEventPayloadMap {
  "session.created": AgentSession;
  "session.state_changed": AgentSession;
  "session.suspended": AgentSession;
  "session.resumed": AgentSession;
  "runtime.status": RuntimeStatus;
  "runtime.output": RuntimeOutput;
  "goal.created": Goal;
  "goal.updated": Goal;
  "goal.completed": Goal;
  "cycle.started": CycleTrace;
  "proposal.submitted": Proposal;
  "workspace.committed": WorkspaceSnapshot;
  "action.selected": CandidateAction;
  "action.executed": ActionExecution;
  "observation.recorded": Observation;
  "prediction.recorded": Prediction;
  "prediction_error.recorded": PredictionError;
  "memory.written": Episode;
  "memory.retrieval_planned": MemoryRetrievalPlan;
  "memory.retrieved": MemoryRecallBundle;
  "memory.episode_activated": Episode;
  "memory.semantic_card_created": SemanticCard;
  "memory.skill_spec_created": ProceduralSkillSpec;
  "memory.object_marked_suspect": MemoryGovernanceEvent;
  "memory.object_tombstoned": MemoryGovernanceEvent;
  "memory.rollback_applied": MemoryGovernanceEvent;
  "reward.computed": RewardSignal;
  "policy.updated": PolicyUpdateEvent;
  "exploration.triggered": ExplorationEvent;
  "plan.generated": AutonomousPlan;
  "plan.revised": AutonomousPlan;
  "plan.status_changed": AutonomyDecision;
  "motivation.computed": IntrinsicMotivation;
  "goal.self_generated": SuggestedGoal;
  "transfer.attempted": TransferResult;
  "transfer.validated": TransferResult;
  "consolidation.completed": KnowledgeSnapshot;
  "drift.detected": DriftSignal;
  "recovery.triggered": RecoveryAction;
  "recovery.completed": RecoveryAction;
  "health.report": HealthReport;
  "skill.matched": SkillDefinition;
  "skill.executed": ActionExecution;
  "skill.promoted": SkillDefinition;
  "skill.evaluated": SkillEvaluation;
  "skill.pruned": SkillPruneEvent;
  "skill.transferred": SkillTransferEvent;
  "approval.requested": ApprovalRequest;
  "budget.exceeded": WorkspaceSnapshot;
  "checkpoint.created": SessionCheckpoint;
  "session.completed": AgentSession;
  "session.failed": AgentSession;
  "sensor.reading": Observation;
  "actuator.command": CandidateAction;
  "actuator.result": Observation;
  "world_state.updated": WorkspaceSnapshot;
  "simulation.completed": Prediction;
  "device.registered": WorkspaceSnapshot;
  "device.error": Observation;
  "agent.registered": WorkspaceSnapshot;
  "agent.deregistered": WorkspaceSnapshot;
  "agent.status_changed": WorkspaceSnapshot;
  "agent.heartbeat_lost": WorkspaceSnapshot;
  "delegation.requested": CandidateAction;
  "delegation.accepted": Observation;
  "delegation.rejected": Observation;
  "delegation.completed": Observation;
  "delegation.failed": Observation;
  "delegation.timeout": Observation;
  "auction.started": WorkspaceSnapshot;
  "auction.bid_received": WorkspaceSnapshot;
  "auction.completed": WorkspaceSnapshot;
  "coordination.started": WorkspaceSnapshot;
  "coordination.assignment_created": WorkspaceSnapshot;
  "coordination.completed": WorkspaceSnapshot;
  "world_state.conflict_detected": WorkspaceSnapshot;
  "world_state.conflict_resolved": WorkspaceSnapshot;
}

export interface EventEnvelope<T extends NeuroCoreEventType = NeuroCoreEventType> {
  event_id: string;
  event_type: T;
  schema_version: string;
  tenant_id: string;
  session_id?: string;
  cycle_id?: string;
  timestamp: string;
  sequence_no: number;
  payload: NeuroCoreEventPayloadMap[T];
}

export type NeuroCoreEvent = {
  [T in NeuroCoreEventType]: EventEnvelope<T>;
}[NeuroCoreEventType];
