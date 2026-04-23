import type {
  AutonomyState,
  IntrinsicMotivation,
  ModuleContext,
  SelfGoalGenerator,
  SuggestedGoal
} from "@neurocore/protocol";

export class DefaultSelfGoalGenerator implements SelfGoalGenerator {
  public readonly name = "default-self-goal-generator";

  public async suggestGoals(
    ctx: ModuleContext,
    _state: AutonomyState,
    motivation: IntrinsicMotivation
  ): Promise<SuggestedGoal[]> {
    if (motivation.composite_drive < (ctx.profile.autonomy_config?.goal_value_threshold ?? 0.45)) {
      return [];
    }

    const generatedAt = ctx.services.now();
    return [
      {
        suggested_goal_id: ctx.services.generateId("sgl"),
        session_id: ctx.session.session_id,
        title: "Inspect uncovered task surface",
        description: "Explore unresolved uncertainty and expand usable knowledge before the next external request.",
        goal_type: "information_gap",
        priority: 35,
        status: "proposed",
        justification: "Composite intrinsic drive exceeded the goal generation threshold.",
        created_at: generatedAt
      }
    ];
  }
}
