import type {
  AutonomyState,
  IntrinsicMotivation,
  IntrinsicMotivationEngine,
  ModuleContext
} from "@neurocore/protocol";

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export class DefaultIntrinsicMotivationEngine implements IntrinsicMotivationEngine {
  public readonly name = "default-intrinsic-motivation-engine";

  public async compute(ctx: ModuleContext, state: AutonomyState): Promise<IntrinsicMotivation> {
    const predictionErrorRate =
      typeof ctx.runtime_state.recent_prediction_error_rate === "number"
        ? ctx.runtime_state.recent_prediction_error_rate
        : 0;
    const skillCoverage =
      typeof ctx.runtime_state.skill_coverage === "number"
        ? ctx.runtime_state.skill_coverage
        : 0.5;
    const blockedGoals = ctx.goals.filter((goal) => goal.status === "blocked").length;
    const availableTools =
      Array.isArray(ctx.runtime_state.available_tool_names)
        ? ctx.runtime_state.available_tool_names.length
        : ctx.profile.tool_refs.length;
    const approvalRequired =
      typeof ctx.session.policy_state.approval_required === "boolean"
        ? ctx.session.policy_state.approval_required
        : false;
    const weights = ctx.profile.autonomy_config?.motivation_weights ?? {};
    const curiosityScore = clamp(0.35 + predictionErrorRate * 0.45 + blockedGoals * 0.05);
    const competenceScore = clamp(0.3 + skillCoverage * 0.6);
    const autonomyScore = clamp(0.25 + Math.min(availableTools, 6) * 0.08 - (approvalRequired ? 0.25 : 0));
    const curiosityWeight = weights.curiosity ?? 0.4;
    const competenceWeight = weights.competence ?? 0.3;
    const autonomyWeight = weights.autonomy ?? 0.3;
    const compositeDrive = clamp(
      curiosityScore * curiosityWeight +
      competenceScore * competenceWeight +
      autonomyScore * autonomyWeight
    );

    return {
      motivation_id: ctx.services.generateId("mot"),
      session_id: ctx.session.session_id,
      curiosity: {
        score: curiosityScore,
        rationale: predictionErrorRate > 0.2
          ? "Prediction error indicates unexplored or unstable state."
          : "Prediction error remains within expected range."
      },
      competence: {
        score: competenceScore,
        rationale: skillCoverage < 0.5
          ? "Skill coverage is incomplete for the active problem space."
          : "Current skills cover most of the active problem space."
      },
      autonomy: {
        score: autonomyScore,
        rationale: approvalRequired
          ? "Approval friction reduces autonomous execution freedom."
          : "Current tool and policy state supports autonomous progress."
      },
      composite_drive: compositeDrive,
      exploration_targets: state.suggested_goals?.map((goal) => ({
        target_id: goal.suggested_goal_id,
        target_type: "goal",
        summary: goal.title,
        score: compositeDrive
      })) ?? [],
      created_at: ctx.services.now()
    };
  }
}
