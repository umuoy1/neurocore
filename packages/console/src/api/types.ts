import type {
  AgentSession,
  ApprovalRequest,
  CycleTrace,
  CycleTraceRecord,
  Episode,
  Goal,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  NeuroCoreEvent,
  PolicyDecision,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import type { AgentDescriptor, DelegationStatusRecord } from "@neurocore/multi-agent";
import type { DeviceInfo } from "@neurocore/device-core";
import type { WorldEntity, WorldRelation } from "@neurocore/world-model";
import type { ConfigApiKeyEntry, PolicyTemplate } from "@neurocore/runtime-server";

export type {
  AgentSession,
  ApprovalRequest,
  CycleTrace,
  CycleTraceRecord,
  Episode,
  Goal,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  NeuroCoreEvent,
  PolicyDecision,
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
