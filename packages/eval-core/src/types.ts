import type { SessionReplay, SessionState } from "@neurocore/protocol";

export interface EvalCase {
  case_id: string;
  description: string;
  input: {
    content: string;
    metadata?: Record<string, unknown>;
  };
  tags?: string[];
  expectations?: EvalExpectations;
}

export interface EvalExpectations {
  final_state?: SessionState;
  output_includes?: string[];
  min_steps?: number;
  max_steps?: number;
  tool_sequence?: string[];
  executed_tool_sequence?: string[];
  requires_approval?: boolean;
}

export interface EvalObservedResult {
  session_id: string;
  final_state: SessionState;
  step_count: number;
  output_text?: string;
  tool_sequence: string[];
  executed_tool_sequence: string[];
  replay: SessionReplay;
}

export interface EvalCaseResult {
  case_id: string;
  description: string;
  passed: boolean;
  score: number;
  failures: string[];
  observed: EvalObservedResult;
}

export interface EvalRunReport {
  run_id: string;
  tenant_id?: string;
  agent_id?: string;
  started_at: string;
  ended_at: string;
  case_count: number;
  pass_count: number;
  pass_rate: number;
  average_score: number;
  results: EvalCaseResult[];
}
