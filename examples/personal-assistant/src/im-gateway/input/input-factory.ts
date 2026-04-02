import type { UserInput } from "@neurocore/protocol";

export function createUserInput(
  content: string,
  metadata?: Record<string, unknown>
): UserInput {
  return {
    input_id: `inp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    created_at: new Date().toISOString(),
    metadata
  };
}
