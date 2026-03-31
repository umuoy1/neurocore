import type {
  ActionExecution,
  CandidateAction,
  ModuleContext,
  Observation,
  SkillProvider
} from "@neurocore/protocol";
import { generateId, nowIso } from "../utils/ids.js";

export interface SkillExecutionResult {
  execution: ActionExecution;
  observation: Observation;
}

export async function executeSkill(
  provider: SkillProvider,
  ctx: ModuleContext,
  skillId: string,
  action: CandidateAction
): Promise<SkillExecutionResult | null> {
  if (!provider.execute) return null;

  const result = await provider.execute(ctx, skillId, action);
  if (!result) return null;

  const observation: Observation = {
    observation_id: generateId("obs"),
    session_id: ctx.session.session_id,
    cycle_id: ctx.session.current_cycle_id ?? generateId("cyc"),
    source_action_id: action.action_id,
    source_type: "runtime",
    status: result.status === "succeeded" ? "success" : "failure",
    summary: `Skill ${skillId} executed via ${provider.name}`,
    structured_payload: { skill_id: skillId, executor: result.executor },
    created_at: nowIso()
  };

  return { execution: result, observation };
}
