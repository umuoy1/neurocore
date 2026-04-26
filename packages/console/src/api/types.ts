import type {
  AgentSession,
  ApprovalRequest,
  BudgetAssessment,
  CandidateAction,
  CompetitionEntry,
  ConfidenceAssessment,
  CycleTrace,
  CycleTraceRecord,
  Episode,
  Goal,
  GoalStatus,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  NeuroCoreEvent,
  PolicyDecision,
  RiskAssessment,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import type { AgentDescriptor, DelegationStatusRecord } from "@neurocore/multi-agent";
import type { DeviceInfo } from "@neurocore/device-core";
import type { WorldEntity, WorldRelation } from "@neurocore/world-model";
import type { ConfigApiKeyEntry, PolicyTemplate } from "@neurocore/runtime-server";

export type {
  AgentSession,
  ApprovalRequest,
  BudgetAssessment,
  CandidateAction,
  CompetitionEntry,
  ConfidenceAssessment,
  CycleTrace,
  CycleTraceRecord,
  Episode,
  Goal,
  GoalStatus,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  NeuroCoreEvent,
  PolicyDecision,
  RiskAssessment,
  WorkspaceSnapshot,
  AgentDescriptor,
  DelegationStatusRecord,
  DeviceInfo,
  WorldEntity,
  WorldRelation,
  PolicyTemplate,
  ConfigApiKeyEntry
};

export type SessionState = AgentSession["state"];

export interface WorkingMemoryRecord {
  memory_id: string;
  summary: string;
  relevance: number;
  created_at?: string;
  expires_at?: string;
}

export interface SemanticMemoryRecord {
  memory_id: string;
  tenant_id: string;
  summary: string;
  relevance: number;
  occurrence_count: number;
  source_episode_ids: string[];
  session_ids: string[];
  pattern_key: string;
  valence: "positive" | "negative";
  last_updated_at: string;
}

export interface SkillDefinition {
  skill_id: string;
  name: string;
  kind: string;
  version: string;
  description?: string;
  status?: string;
  risk_level?: string;
  updated_at?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
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
  p50: number;
  p95: number;
  p99: number;
  by_agent: Record<string, { p50: number; p95: number; p99: number }>;
}

export interface EvalRunReport {
  run_id: string;
  tenant_id?: string;
  agent_id?: string;
  started_at: string;
  ended_at?: string;
  case_count: number;
  pass_count: number;
  pass_rate: number;
  average_score: number;
}

export interface AgentProfileSummary {
  agent_id: string;
  name: string;
  version: string;
  versions?: string[];
  has_runtime?: boolean;
}

export interface SessionListItem {
  session_id: string;
  agent_id: string;
  session: AgentSession;
  active_run: boolean;
  trace_count?: number;
  episode_count?: number;
  pending_approval?: ApprovalRequest | null;
  working_memory_count?: number;
  goals_count?: number;
  created_at?: string | null;
}

export interface AuditLogEntry {
  audit_id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export type PersonalAssistantGovernanceSessionState =
  | "created"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface PersonalAssistantGovernanceSession {
  session_id: string;
  agent_id: string;
  user_id?: string;
  state: PersonalAssistantGovernanceSessionState;
  route?: {
    platform?: string;
    chat_id?: string;
    thread_id?: string;
    profile_id?: string;
  };
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceTaskStatus = "created" | "running" | "succeeded" | "failed" | "cancelled";

export interface PersonalAssistantGovernanceBackgroundTask {
  task_id: string;
  source: "heartbeat" | "schedule" | "manual" | "webhook";
  status: PersonalAssistantGovernanceTaskStatus;
  description: string;
  target_user: string;
  target_platform?: string;
  priority?: string;
  session_id?: string;
  approval_id?: string;
  result_text?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  metadata: Record<string, unknown>;
}

export type PersonalAssistantGovernanceApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface PersonalAssistantGovernanceApproval {
  approval_id: string;
  session_id: string;
  status: PersonalAssistantGovernanceApprovalStatus;
  action_title: string;
  action_type?: string;
  risk_level?: string;
  requested_at: string;
  decided_at?: string;
  approver_id?: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceScheduleStatus = "active" | "paused" | "disabled";

export interface PersonalAssistantGovernanceSchedule {
  id: string;
  cron: string;
  task_description: string;
  target_user: string;
  target_platform?: string;
  enabled: boolean;
  mode?: "recurring" | "one_shot";
  run_at?: string;
  status: PersonalAssistantGovernanceScheduleStatus;
  next_run_at?: string;
  last_run_at?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export type PersonalAssistantGovernanceChildAgentStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface PersonalAssistantGovernanceChildAgent {
  child_agent_id: string;
  parent_session_id: string;
  task_id?: string;
  agent_id: string;
  status: PersonalAssistantGovernanceChildAgentStatus;
  goal: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceMemoryRecord {
  memory_id: string;
  subject: string;
  claim: string;
  lifecycle: "candidate" | "active" | "retired";
  confidence?: number;
  source_session_ids?: string[];
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceToolAction {
  tool_action_id: string;
  session_id?: string;
  task_id?: string;
  tool_name: string;
  status: "requested" | "approved" | "rejected" | "running" | "succeeded" | "failed" | "cancelled";
  risk_level?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceAuditRecord {
  audit_id: string;
  action: string;
  target_type: "approval" | "background_task" | "schedule" | "child_agent" | "session" | "memory" | "tool_action";
  target_id: string;
  actor_id: string;
  created_at: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface PersonalAssistantGovernanceSnapshot {
  sessions: PersonalAssistantGovernanceSession[];
  background_tasks: PersonalAssistantGovernanceBackgroundTask[];
  approvals: PersonalAssistantGovernanceApproval[];
  schedules: PersonalAssistantGovernanceSchedule[];
  child_agents: PersonalAssistantGovernanceChildAgent[];
  memories: PersonalAssistantGovernanceMemoryRecord[];
  tool_actions: PersonalAssistantGovernanceToolAction[];
  audit_records: PersonalAssistantGovernanceAuditRecord[];
  summary: {
    total_sessions: number;
    active_sessions: number;
    running_background_tasks: number;
    pending_approvals: number;
    active_schedules: number;
    active_child_agents: number;
    memory_records: number;
    tool_actions: number;
    audit_records: number;
  };
}
