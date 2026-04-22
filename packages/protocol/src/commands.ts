import type { AgentProfile, SystemInput, UserInput } from "./types.js";

export type MutableAgentProfileOverrides = Omit<
  Partial<AgentProfile>,
  | "agent_id"
  | "schema_version"
  | "name"
  | "version"
  | "description"
  | "role"
  | "domain"
  | "mode"
  | "tool_refs"
  | "skill_refs"
  | "policies"
>;

export interface CreateSessionCommand {
  command_type: "create_session";
  agent_id: string;
  agent_version?: string;
  tenant_id: string;
  user_id?: string;
  session_mode?: "sync" | "async" | "stream";
  initial_input: UserInput;
  overrides?: MutableAgentProfileOverrides;
}

export interface SubmitInputCommand {
  command_type: "submit_input";
  session_id: string;
  input: UserInput | SystemInput;
  expect_response?: boolean;
}

export interface StartCycleCommand {
  command_type: "start_cycle";
  session_id: string;
  trigger: "new_input" | "resume" | "tool_result" | "timer" | "internal";
  preferred_mode?: "fast" | "standard" | "deep";
}

export interface ExecuteActionCommand {
  command_type: "execute_action";
  session_id: string;
  cycle_id: string;
  action_id: string;
  approval_token?: string;
}

export interface ApproveActionCommand {
  command_type: "approve_action";
  session_id: string;
  action_id: string;
  approver_id: string;
  decision: "approved" | "rejected";
  comment?: string;
}

export interface SuspendSessionCommand {
  command_type: "suspend_session";
  session_id: string;
}

export interface ResumeSessionCommand {
  command_type: "resume_session";
  session_id: string;
  input?: UserInput | SystemInput;
}

export interface CheckpointCommand {
  command_type: "create_checkpoint";
  session_id: string;
}

export type RuntimeCommand =
  | CreateSessionCommand
  | SubmitInputCommand
  | StartCycleCommand
  | ExecuteActionCommand
  | ApproveActionCommand
  | SuspendSessionCommand
  | ResumeSessionCommand
  | CheckpointCommand;
