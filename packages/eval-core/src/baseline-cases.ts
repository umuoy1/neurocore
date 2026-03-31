import type { EvalCase } from "./types.js";

export const BASELINE_CASES: EvalCase[] = [
  {
    case_id: "d1-echo-hello",
    description: "Agent echoes hello back.",
    input: { content: "hello baseline" },
    tags: ["echo", "basic"],
    expectations: {
      final_state: "completed",
      output_includes: ["hello baseline"],
      max_steps: 2
    }
  },
  {
    case_id: "d1-echo-world",
    description: "Agent echoes world back.",
    input: { content: "world baseline" },
    tags: ["echo", "basic"],
    expectations: {
      final_state: "completed",
      output_includes: ["world baseline"]
    }
  },
  {
    case_id: "d2-single-tool",
    description: "Agent calls fetch_data once then responds.",
    input: { content: "run fetch" },
    tags: ["tool", "chain"],
    expectations: {
      final_state: "completed",
      executed_tool_sequence: ["fetch_data"],
      output_includes: ["fetch-result"]
    }
  },
  {
    case_id: "d3-clarification",
    description: "Ambiguous input triggers ask_user, leaving session in waiting state.",
    input: { content: "do something" },
    tags: ["clarification"],
    expectations: {
      final_state: "waiting",
      requires_approval: false
    }
  },
  {
    case_id: "d4-approval-escalation",
    description: "High-risk tool call escalates session for human approval.",
    input: { content: "run destructive op" },
    tags: ["approval", "escalation"],
    expectations: {
      final_state: "escalated",
      requires_approval: true
    }
  },
  {
    case_id: "d5-tool-chain",
    description: "Agent executes step_a then step_b in order.",
    input: { content: "run the chain" },
    tags: ["tool", "chain", "multi-step"],
    expectations: {
      final_state: "completed",
      executed_tool_sequence: ["step_a", "step_b"],
      min_steps: 3
    }
  },
  {
    case_id: "d6-resume-after-waiting",
    description: "Session enters awaiting_input state, resumes, then completes.",
    input: { content: "need clarification" },
    tags: ["resume", "waiting"],
    expectations: {
      final_state: "waiting"
    }
  },
  {
    case_id: "d7-memory-recall-influence",
    description: "Cross-session episodic recall influences subsequent decision.",
    input: { content: "recall previous experience" },
    tags: ["memory", "recall"],
    expectations: {
      final_state: "completed"
    }
  }
];
