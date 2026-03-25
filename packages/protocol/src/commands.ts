import type { AgentProfile, SystemInput, UserInput } from "./types.js";

export interface CreateSessionCommand {
  agent_id: string;
  tenant_id: string;
  user_id?: string;
  session_mode?: "sync" | "async" | "stream";
  initial_input: UserInput;
  overrides?: Partial<AgentProfile>;
}

export interface SubmitInputCommand {
  session_id: string;
  input: UserInput | SystemInput;
  expect_response?: boolean;
}

export interface StartCycleCommand {
  session_id: string;
  trigger: "new_input" | "resume" | "tool_result" | "timer" | "internal";
  preferred_mode?: "fast" | "standard" | "deep";
}

export interface ExecuteActionCommand {
  session_id: string;
  cycle_id: string;
  action_id: string;
  approval_token?: string;
}

export interface ApproveActionCommand {
  session_id: string;
  action_id: string;
  approver_id: string;
  decision: "approved" | "rejected";
  comment?: string;
}

export type RuntimeCommand =
  | CreateSessionCommand
  | SubmitInputCommand
  | StartCycleCommand
  | ExecuteActionCommand
  | ApproveActionCommand;

