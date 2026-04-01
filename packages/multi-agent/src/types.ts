export type AgentStatus = "registering" | "idle" | "busy" | "draining" | "unreachable" | "terminated";

export interface AgentCapability {
  name: string;
  domain?: string;
  proficiency: number;
  max_concurrent_tasks?: number;
}

export interface AgentDescriptor {
  agent_id: string;
  instance_id: string;
  name: string;
  version: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  domains: string[];
  current_load: number;
  max_capacity: number;
  endpoint?: string;
  heartbeat_interval_ms: number;
  last_heartbeat_at: string;
  registered_at: string;
  metadata?: Record<string, unknown>;
}

export interface AgentQuery {
  capabilities?: string[];
  domains?: string[];
  status?: AgentStatus[];
  min_available_capacity?: number;
}

export type StatusChangeCallback = (descriptor: AgentDescriptor, previous: AgentStatus) => void;

export type MessagePattern = "request" | "response" | "event" | "stream_start" | "stream_data" | "stream_end";

export interface InterAgentMessage {
  message_id: string;
  correlation_id: string;
  trace_id: string;
  parent_span_id?: string;
  pattern: MessagePattern;
  source_agent_id: string;
  source_instance_id: string;
  target_agent_id?: string;
  topic?: string;
  payload: Record<string, unknown>;
  created_at: string;
  ttl_ms?: number;
}

export type DelegationMode = "unicast" | "broadcast" | "auction";

export type DelegationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export interface DelegationRequest {
  delegation_id: string;
  source_agent_id: string;
  source_session_id: string;
  source_cycle_id: string;
  source_goal_id: string;
  mode: DelegationMode;
  target_agent_id?: string;
  target_capabilities?: string[];
  target_domains?: string[];
  goal: {
    title: string;
    description?: string;
    goal_type: string;
    priority: number;
    constraints?: Array<{ type: string; description: string }>;
    acceptance_criteria?: Array<{ id: string; description: string }>;
  };
  timeout_ms: number;
  max_depth: number;
  current_depth: number;
  context?: Record<string, unknown>;
  created_at: string;
}

export interface AuctionBid {
  agent_id: string;
  instance_id: string;
  estimated_duration_ms: number;
  estimated_cost: number;
  confidence: number;
  reasoning?: string;
}

export interface DelegationResponse {
  delegation_id: string;
  status: DelegationStatus;
  assigned_agent_id?: string;
  assigned_instance_id?: string;
  assigned_session_id?: string;
  bids?: AuctionBid[];
  selected_bid?: AuctionBid;
  result?: {
    status: "success" | "partial" | "failure";
    summary: string;
    payload?: Record<string, unknown>;
  };
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface CoordinationContext {
  initiator_agent_id: string;
  participating_agents: AgentDescriptor[];
  goal: {
    goal_id: string;
    title: string;
    description?: string;
    priority: number;
  };
  world_state?: Record<string, unknown>;
}

export interface TaskAssignment {
  agent_id: string;
  instance_id: string;
  sub_goal: {
    title: string;
    description?: string;
    priority: number;
    dependencies?: string[];
  };
  estimated_cost?: number;
}

export interface CoordinationResult {
  strategy_name: string;
  assignments: TaskAssignment[];
  coordination_metadata?: Record<string, unknown>;
  reasoning: string;
}

export interface GoalAssignment {
  goal_id: string;
  agent_id: string;
  instance_id: string;
  session_id: string;
  status: string;
  progress?: number;
  updated_at: string;
}

export interface MultiAgentConfig {
  enabled: boolean;
  heartbeat_interval_ms?: number;
  heartbeat_timeout_multiplier?: number;
  heartbeat_max_misses?: number;
  delegation_timeout_ms?: number;
  auction_timeout_ms?: number;
  max_delegation_depth?: number;
  coordination_strategy?: "hierarchical" | "peer_to_peer" | "market_based";
  capabilities?: AgentCapability[];
  domains?: string[];
  max_capacity?: number;
  auto_accept_delegation?: boolean;
  shared_state_config?: {
    sync_mode: "push" | "pull" | "bidirectional";
    namespaces?: string[];
    conflict_resolution: "last_writer_wins" | "merge";
  };
}

export interface HierarchicalConfig {
  max_tree_depth: number;
  worker_selection: "round_robin" | "least_loaded" | "best_fit";
  result_aggregation: "all_success" | "majority" | "any_success";
}

export interface PeerToPeerConfig {
  consensus_mode: "simple_majority" | "weighted_majority" | "unanimous";
  voting_timeout_ms: number;
  max_voting_rounds: number;
  agent_weights?: Record<string, number>;
}

export interface MarketBasedConfig {
  auction_timeout_ms: number;
  min_bids: number;
  scoring_weights: {
    duration: number;
    cost: number;
    confidence: number;
  };
  reserve_price?: number;
}
