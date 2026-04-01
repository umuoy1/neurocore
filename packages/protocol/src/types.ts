export type Timestamp = string;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue | undefined>;

export type JsonSchema = Record<string, unknown>;

export type SessionState =
  | "created"
  | "hydrated"
  | "running"
  | "waiting"
  | "suspended"
  | "escalated"
  | "completed"
  | "failed"
  | "aborted";

export type SessionMode = "sync" | "async" | "stream";

export type GoalType =
  | "task"
  | "subtask"
  | "question"
  | "information_gap"
  | "verification"
  | "recovery";

export type GoalStatus =
  | "pending"
  | "active"
  | "blocked"
  | "waiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type ProposalType =
  | "context"
  | "memory_recall"
  | "skill_match"
  | "plan"
  | "prediction"
  | "risk_alert"
  | "action";

export type ActionType =
  | "respond"
  | "ask_user"
  | "call_tool"
  | "update_goal"
  | "write_memory"
  | "delegate"
  | "wait"
  | "complete"
  | "abort";

export type SideEffectLevel = "none" | "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type EventSource = "system" | "user" | "reasoner" | "memory" | "tool" | "runtime";

export interface ModelRef {
  provider?: string;
  model: string;
}

export interface Constraint {
  type: string;
  description: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface PolicyBundleRef {
  policy_ids: string[];
}

export interface RuntimeConfig {
  max_cycles: number;
  max_runtime_ms?: number;
  default_sync_timeout_ms?: number;
  cycle_mode?: "fast" | "standard" | "deep";
  allow_parallel_modules?: boolean;
  allow_async_tools?: boolean;
  checkpoint_interval?: "cycle" | "action" | "manual";
  tool_execution?: ToolExecutionPolicy;
  auto_approve?: boolean;
}

export interface ToolExecutionPolicy {
  timeout_ms?: number;
  max_retries?: number;
  retry_backoff_ms?: number;
  retry_on_timeout?: boolean;
}

export interface MemoryConfig {
  working_memory_enabled: boolean;
  episodic_memory_enabled: boolean;
  semantic_memory_enabled?: boolean;
  procedural_memory_enabled?: boolean;
  write_policy: "immediate" | "deferred" | "hybrid";
  retrieval_top_k?: number;
  consolidation_enabled?: boolean;
}

export interface PredictionConfig {
  enabled: boolean;
  required_for_side_effect_actions?: boolean;
  predictor_order?: string[];
  uncertainty_threshold?: number;
}

export interface ObservabilityConfig {
  trace_enabled?: boolean;
  event_stream_enabled?: boolean;
}

export interface ContextBudget {
  max_context_tokens?: number;
  compression_strategy?: "truncate_oldest" | "summarize" | "graded";
}

export interface BudgetState {
  token_budget_total?: number;
  token_budget_used?: number;
  cost_budget_total?: number;
  cost_budget_used?: number;
  tool_call_limit?: number;
  tool_call_used?: number;
  cycle_limit?: number;
  cycle_used?: number;
}

export interface PolicyState {
  approval_required?: boolean;
  output_restrictions?: string[];
  blocked_tools?: string[];
  escalation_level?: "none" | "review" | "approval" | "hard_stop";
  risk_mode?: "normal" | "conservative" | "strict";
}

export interface AgentProfile {
  agent_id: string;
  schema_version: string;
  name: string;
  version: string;
  description?: string;
  role: string;
  domain?: string;
  mode: "embedded" | "runtime" | "hybrid";
  default_model?: ModelRef;
  tool_refs: string[];
  skill_refs: string[];
  policies: PolicyBundleRef;
  memory_config: MemoryConfig;
  prediction_config?: PredictionConfig;
  runtime_config: RuntimeConfig;
  observability_config?: ObservabilityConfig;
  context_budget?: ContextBudget;
  cost_per_token?: number;
  cost_budget?: number;
  approval_policy?: { allowed_approvers?: string[] };
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  session_id: string;
  schema_version: string;
  tenant_id: string;
  agent_id: string;
  user_id?: string;
  state: SessionState;
  session_mode: SessionMode;
  current_cycle_id?: string;
  goal_tree_ref: string;
  workspace_ref?: string;
  budget_state: BudgetState;
  policy_state: PolicyState;
  checkpoint_ref?: string;
  started_at?: Timestamp;
  ended_at?: Timestamp;
  metadata?: Record<string, unknown>;
  last_active_at?: Timestamp;
}

export interface Goal {
  goal_id: string;
  schema_version: string;
  session_id: string;
  parent_goal_id?: string;
  title: string;
  description?: string;
  goal_type: GoalType;
  status: GoalStatus;
  priority: number;
  importance?: number;
  urgency?: number;
  deadline_at?: Timestamp;
  dependencies?: string[];
  constraints?: Constraint[];
  acceptance_criteria?: AcceptanceCriterion[];
  progress?: number;
  owner?: "agent" | "user" | "human_reviewer" | "system";
  metadata?: Record<string, unknown>;
  created_at?: Timestamp;
  updated_at?: Timestamp;
}

export interface GoalDigest {
  goal_id: string;
  title: string;
  status: GoalStatus;
  priority: number;
}

export interface MemoryDigest {
  memory_id: string;
  memory_type: "working" | "episodic" | "semantic" | "procedural";
  summary: string;
  relevance: number;
}

export interface WorkingMemoryRecord {
  memory_id: string;
  summary: string;
  relevance: number;
}

export interface SkillDigest {
  skill_id: string;
  name: string;
  relevance: number;
}

export interface WorldStateDigest {
  summary: string;
  uncertainty?: number;
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

export interface InputEventRef {
  input_id: string;
  source_type: "user" | "system" | "tool" | "runtime";
}

export interface Proposal {
  proposal_id: string;
  schema_version: string;
  session_id: string;
  cycle_id: string;
  module_name: string;
  proposal_type: ProposalType;
  salience_score: number;
  confidence?: number;
  risk?: number;
  estimated_cost?: number;
  estimated_latency_ms?: number;
  payload: Record<string, unknown>;
  explanation?: string;
  supersedes?: string[];
  metadata?: Record<string, unknown>;
}

export interface CandidateAction {
  action_id: string;
  action_type: ActionType;
  title: string;
  description?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  expected_outcome?: string;
  preconditions?: string[];
  side_effect_level?: SideEffectLevel;
  idempotency_key?: string;
  rollback_hint?: string;
  source_proposal_id?: string;
}

export type ProposalSource = "reasoner" | "memory" | "skill";

export interface CompetitionEntry {
  proposal_id: string;
  module_name: string;
  source: ProposalSource;
  raw_salience: number;
  source_weight: number;
  goal_alignment: number;
  final_score: number;
  rank: number;
  fused_with?: string[];
}

export interface CompetitionConflict {
  proposal_ids: [string, ...string[]];
  conflict_type: "overlapping_action";
  score_gap: number;
}

export interface CompetitionLog {
  entries: CompetitionEntry[];
  conflicts: CompetitionConflict[];
  selection_reasoning: string;
}

export interface WorkspaceSnapshot {
  workspace_id: string;
  schema_version: string;
  session_id: string;
  cycle_id: string;
  input_events: InputEventRef[];
  active_goals: GoalDigest[];
  context_summary: string;
  memory_digest: MemoryDigest[];
  skill_digest: SkillDigest[];
  world_state_digest?: WorldStateDigest;
  candidate_actions: CandidateAction[];
  selected_proposal_id?: string;
  risk_assessment?: RiskAssessment;
  confidence_assessment?: ConfidenceAssessment;
  budget_assessment?: BudgetAssessment;
  policy_decisions?: PolicyDecision[];
  decision_reasoning?: string;
  competition_log?: CompetitionLog;
  created_at: Timestamp;
}

export interface ActionExecution {
  execution_id: string;
  session_id: string;
  cycle_id: string;
  action_id: string;
  status: "approved" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: Timestamp;
  ended_at?: Timestamp;
  executor: "runtime" | "tool_gateway" | "human";
  approval_ref?: string;
  result_ref?: string;
  error_ref?: string;
  metrics?: {
    latency_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
    attempt_count?: number;
    retry_count?: number;
    timeout_ms?: number;
  };
}

export interface ApprovalRequest {
  approval_id: string;
  session_id: string;
  tenant_id?: string;
  cycle_id: string;
  action_id: string;
  status: ApprovalStatus;
  requested_at: Timestamp;
  decided_at?: Timestamp;
  approver_id?: string;
  decision?: "approved" | "rejected";
  comment?: string;
  review_reason?: string;
  approval_token?: string;
  action: CandidateAction;
}

export interface Observation {
  observation_id: string;
  session_id: string;
  cycle_id: string;
  source_action_id?: string;
  source_type: "tool" | "user" | "system" | "memory" | "runtime";
  status: "success" | "partial" | "failure" | "unknown";
  summary: string;
  raw_ref?: string;
  structured_payload?: Record<string, unknown>;
  side_effects?: string[];
  confidence?: number;
  created_at: Timestamp;
}

export interface Prediction {
  prediction_id: string;
  session_id: string;
  cycle_id: string;
  action_id: string;
  predictor_name: string;
  expected_outcome: string;
  success_probability?: number;
  side_effects?: string[];
  estimated_cost?: number;
  estimated_duration_ms?: number;
  required_preconditions?: string[];
  uncertainty?: number;
  reasoning?: string;
  created_at: Timestamp;
}

export interface PredictionError {
  prediction_error_id: string;
  prediction_id: string;
  action_id: string;
  session_id: string;
  cycle_id: string;
  error_type:
    | "outcome_mismatch"
    | "cost_mismatch"
    | "duration_mismatch"
    | "side_effect_mismatch"
    | "precondition_mismatch";
  severity: "low" | "medium" | "high";
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  impact_summary?: string;
  created_at: Timestamp;
}

export interface Episode {
  episode_id: string;
  schema_version: string;
  session_id: string;
  trigger_summary: string;
  goal_refs: string[];
  context_digest: string;
  selected_strategy: string;
  action_refs: string[];
  observation_refs: string[];
  outcome: "success" | "partial" | "failure";
  outcome_summary: string;
  valence?: "positive" | "neutral" | "negative";
  lessons?: string[];
  promoted_to_skill?: boolean;
  metadata?: Record<string, unknown>;
  created_at: Timestamp;
}

export interface TriggerCondition {
  field: string;
  operator: "eq" | "contains" | "gt" | "lt";
  value: string | number | boolean;
}

export interface InputContract {
  name: string;
  required: boolean;
}

export interface SkillExecutionTemplate {
  kind: "reasoning" | "workflow" | "toolchain";
  steps?: string[];
}

export interface FallbackPolicy {
  on_failure: "reason" | "abort" | "ask_user";
}

export interface SkillDefinition {
  skill_id: string;
  schema_version: string;
  name: string;
  version: string;
  kind: "reasoning_skill" | "workflow_skill" | "toolchain_skill" | "compiled_skill";
  description?: string;
  trigger_conditions: TriggerCondition[];
  required_inputs?: InputContract[];
  execution_template: SkillExecutionTemplate;
  applicable_domains?: string[];
  risk_level?: "low" | "medium" | "high";
  fallback_policy?: FallbackPolicy;
  evaluation_metrics?: string[];
  metadata?: Record<string, unknown>;
}

export interface UserInput {
  input_id: string;
  content: string;
  created_at: Timestamp;
  metadata?: Record<string, unknown>;
}

export interface SystemInput {
  input_id: string;
  content: string;
  created_at: Timestamp;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
  decision_id: string;
  policy_name: string;
  level: "info" | "warn" | "block";
  target_type: "input" | "proposal" | "action" | "output";
  target_id?: string;
  reason: string;
  recommendation?: string;
}

export interface MetaDecision {
  decision_type:
    | "continue_internal"
    | "ask_user"
    | "execute_action"
    | "request_approval"
    | "escalate"
    | "complete"
    | "abort";
  selected_action_id?: string;
  confidence?: number;
  risk_summary?: string;
  budget_summary?: string;
  requires_human_approval?: boolean;
  rejection_reasons?: string[];
  explanation?: string;
}

export interface CycleTrace {
  trace_id: string;
  session_id: string;
  cycle_id: string;
  started_at: Timestamp;
  ended_at?: Timestamp;
  input_refs: string[];
  proposal_refs: string[];
  prediction_refs: string[];
  policy_decision_refs: string[];
  prediction_error_refs: string[];
  selected_action_ref?: string;
  observation_refs: string[];
  episode_ref?: string;
  metrics?: {
    total_latency_ms?: number;
    total_tokens?: number;
    total_cost?: number;
  };
}

export interface CycleTraceRecord {
  trace: CycleTrace;
  inputs: UserInput[];
  proposals: Proposal[];
  candidate_actions: CandidateAction[];
  predictions: Prediction[];
  policy_decisions: PolicyDecision[];
  prediction_errors: PredictionError[];
  selected_action?: CandidateAction;
  action_execution?: ActionExecution;
  observation?: Observation;
  workspace?: WorkspaceSnapshot;
}

export interface SessionReplay {
  session_id: string;
  cycle_count: number;
  traces: CycleTraceRecord[];
  final_output?: string;
}

export interface SessionCheckpoint {
  checkpoint_id: string;
  session: AgentSession;
  goals: Goal[];
  working_memory: WorkingMemoryRecord[];
  episodes: Episode[];
  traces: CycleTraceRecord[];
  pending_input?: UserInput;
  created_at: Timestamp;
}

export interface PendingApprovalContextSnapshot {
  approval_id: string;
  cycle_id: string;
  input: UserInput;
  proposals: Proposal[];
  candidate_actions: CandidateAction[];
  predictions: Prediction[];
  workspace: WorkspaceSnapshot;
  selected_action: CandidateAction;
  started_at: Timestamp;
}

export interface RuntimeSessionSnapshot {
  session: AgentSession;
  goals: Goal[];
  working_memory: WorkingMemoryRecord[];
  episodes: Episode[];
  trace_records: CycleTraceRecord[];
  approvals: ApprovalRequest[];
  pending_approvals: PendingApprovalContextSnapshot[];
  checkpoints: SessionCheckpoint[];
}
