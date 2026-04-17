export type SessionState =
  | "created" | "hydrated" | "running" | "waiting" | "suspended"
  | "escalated" | "completed" | "failed" | "aborted";

export type SessionMode = "sync" | "async" | "stream";

export type GoalStatus = "pending" | "active" | "blocked" | "waiting_input" | "completed" | "failed" | "cancelled";
export type GoalType = "task" | "subtask" | "question" | "information_gap" | "verification" | "recovery";

export type ActionType = "respond" | "ask_user" | "call_tool" | "update_goal" | "write_memory" | "delegate" | "wait" | "complete" | "abort";
export type SideEffectLevel = "none" | "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface AgentSession {
  agent_id: string;
  tenant_id: string;
  user_id?: string;
  session_mode: SessionMode;
  state: SessionState;
  current_cycle_id?: string;
}

export interface Goal {
  goal_id: string;
  parent_goal_id?: string;
  title: string;
  description?: string;
  goal_type: GoalType;
  status: GoalStatus;
  priority: number;
  progress?: number;
  dependencies?: string[];
  acceptance_criteria?: AcceptanceCriterion[];
  owner?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface WorkingMemoryRecord {
  memory_id: string;
  summary: string;
  relevance: number;
}

export interface Episode {
  episode_id: string;
  session_id: string;
  trigger_summary: string;
  selected_strategy: string;
  outcome: "success" | "partial" | "failure";
  outcome_summary: string;
  valence?: "positive" | "neutral" | "negative";
  lessons?: string[];
  promoted_to_skill?: boolean;
  created_at?: string;
}

export interface MemoryDigest {
  memory_id: string;
  memory_type: "working" | "episodic" | "semantic" | "procedural";
  summary: string;
  relevance: number;
}

export interface SkillDigest {
  skill_id: string;
  name: string;
  relevance: number;
}

export interface CandidateAction {
  action_id: string;
  action_type: ActionType;
  title: string;
  description?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  side_effect_level: SideEffectLevel;
  expected_outcome?: string;
}

export interface Prediction {
  prediction_id: string;
  expected_outcome: string;
  success_probability?: number;
  side_effects?: string[];
  estimated_cost?: number;
  uncertainty?: number;
}

export interface PredictionError {
  prediction_error_id: string;
  error_type: string;
  severity: "low" | "medium" | "high";
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}

export interface WorkspaceSnapshot {
  workspace_id: string;
  session_id: string;
  cycle_id: string;
  context_summary: string;
  active_goals: GoalDigest[];
  memory_digest: MemoryDigest[];
  skill_digest: SkillDigest[];
  candidate_actions: CandidateAction[];
  selected_proposal_id?: string;
  risk_assessment?: RiskAssessment;
  confidence_assessment?: ConfidenceAssessment;
  budget_assessment?: BudgetAssessment;
  policy_decisions?: PolicyDecision[];
  decision_reasoning?: string;
  competition_log?: CompetitionLog;
  created_at: string;
}

export interface GoalDigest {
  goal_id: string;
  title: string;
  status: GoalStatus;
  priority: number;
}

export interface RiskAssessment {
  risk: number;
  urgency?: number;
  uncertainty?: number;
  impact?: number;
  summary?: string;
}

export interface ConfidenceAssessment {
  confidence: number;
  summary?: string;
}

export interface BudgetAssessment {
  within_budget: boolean;
  summary?: string;
}

export interface PolicyDecision {
  decision_id: string;
  policy_name: string;
  level: "info" | "warn" | "block";
  severity: 10 | 20 | 30;
  target_type: string;
  reason: string;
  recommendation?: string;
}

export interface CompetitionLog {
  entries: CompetitionEntry[];
  conflicts: CompetitionConflict[];
  selection_reasoning: string;
}

export interface CompetitionEntry {
  proposal_id: string;
  module_name: string;
  source: string;
  raw_salience: number;
  source_weight: number;
  goal_alignment: number;
  final_score: number;
  rank: number;
}

export interface CompetitionConflict {
  proposal_ids: string[];
  conflict_type: string;
  score_gap: number;
}

export interface CycleTrace {
  trace_id: string;
  session_id: string;
  cycle_id: string;
  started_at: string;
  ended_at?: string;
  metrics?: { total_latency_ms?: number; total_tokens?: number; total_cost?: number };
}

export interface CycleTraceRecord {
  trace: CycleTrace;
  inputs: unknown[];
  proposals: unknown[];
  candidate_actions: CandidateAction[];
  predictions: Prediction[];
  policy_decisions: PolicyDecision[];
  prediction_errors: PredictionError[];
  selected_action?: CandidateAction;
  action_execution?: ActionExecution;
  observation?: Observation;
  workspace?: WorkspaceSnapshot;
}

export interface ActionExecution {
  execution_id: string;
  status: string;
  started_at: string;
  ended_at?: string;
  metrics?: { latency_ms?: number; cost?: number; input_tokens?: number; output_tokens?: number };
}

export interface Observation {
  observation_id: string;
  source_type: string;
  status: string;
  summary: string;
  confidence?: number;
  side_effects?: string[];
}

export interface ApprovalRequest {
  approval_id: string;
  session_id: string;
  cycle_id: string;
  action_id: string;
  status: ApprovalStatus;
  requested_at: string;
  action: CandidateAction;
  review_reason?: string;
}

export interface NeuroCoreEvent {
  event_id: string;
  event_type: string;
  session_id?: string;
  cycle_id?: string;
  timestamp: string;
  payload: unknown;
}

export interface MetricsSnapshot {
  total_sessions_created: number;
  total_cycles_executed: number;
  active_sessions: number;
  total_eval_runs: number;
  error_count: number;
  average_latency_ms: number;
  eval_pass_rate: number;
  uptime_seconds: number;
  version: string;
  active_sse_connections?: number;
}

export interface TimeseriesPoint {
  timestamp: string;
  value: number;
}

export interface LatencyPercentiles {
  agents: { agent_id: string; p50: number; p95: number; p99: number }[];
}

export interface AgentDescriptor {
  agent_id: string;
  instance_id: string;
  name: string;
  status: string;
  capabilities: { name: string; proficiency: number }[];
  current_load: number;
  max_capacity: number;
}

export interface EvalRunReport {
  run_id: string;
  agent_id?: string;
  started_at: string;
  ended_at: string;
  case_count: number;
  pass_count: number;
  pass_rate: number;
  average_score: number;
}

export interface WorldEntity {
  entity_id: string;
  entity_type: string;
  properties: Record<string, unknown>;
  confidence: number;
  last_observed: string;
}

export interface WorldRelation {
  relation_id: string;
  relation_type: string;
  source_entity_id: string;
  target_entity_id: string;
  strength: number;
  confidence: number;
}

export interface DeviceInfo {
  device_id: string;
  device_type: "sensor" | "actuator";
  status: string;
  health_status: string;
  modality?: string;
}
