import type {
  AutonomousPlan,
  AutonomousPlanner,
  AutonomyDecision,
  AutonomyState,
  Goal,
  ModuleContext
} from "@neurocore/protocol";

function now(ctx: ModuleContext): string {
  return ctx.services.now();
}

function pickPrimaryGoal(goals: Goal[]): Goal | undefined {
  return [...goals]
    .filter((goal) => goal.status === "active" || goal.status === "pending" || goal.status === "blocked")
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0];
}

export class DefaultAutonomousPlanner implements AutonomousPlanner {
  public readonly name = "default-autonomous-planner";

  public async generatePlan(ctx: ModuleContext, state: AutonomyState): Promise<AutonomousPlan | null> {
    const primaryGoal = pickPrimaryGoal(ctx.goals);
    if (!primaryGoal) {
      return null;
    }

    const createdAt = now(ctx);
    const phaseAssess = {
      phase_id: ctx.services.generateId("aph"),
      title: `Assess ${primaryGoal.title}`,
      summary: `Clarify scope and constraints for ${primaryGoal.title}.`,
      goal_type: "information_gap" as const,
      priority: Math.max((primaryGoal.priority ?? 100) - 5, 1)
    };
    const phaseExecute = {
      phase_id: ctx.services.generateId("aph"),
      title: `Execute ${primaryGoal.title}`,
      summary: `Perform the main execution path for ${primaryGoal.title}.`,
      goal_type: primaryGoal.goal_type,
      priority: Math.max((primaryGoal.priority ?? 100) - 10, 1),
      dependencies: [phaseAssess.phase_id]
    };
    const phaseVerify = {
      phase_id: ctx.services.generateId("aph"),
      title: `Verify ${primaryGoal.title}`,
      summary: `Verify outcome quality and close ${primaryGoal.title}.`,
      goal_type: "verification" as const,
      priority: Math.max((primaryGoal.priority ?? 100) - 15, 1),
      dependencies: [phaseExecute.phase_id]
    };

    return {
      plan_id: ctx.services.generateId("apl"),
      session_id: ctx.session.session_id,
      title: `Autonomous plan for ${primaryGoal.title}`,
      summary: `Three-phase autonomous plan derived from ${primaryGoal.title}.`,
      status: "active",
      phase: "planning",
      phases: [phaseAssess, phaseExecute, phaseVerify],
      current_phase_id: phaseAssess.phase_id,
      next_checkpoint_id: ctx.services.generateId("apc"),
      goal_ids: [],
      checkpoints: [
        {
          checkpoint_id: ctx.services.generateId("apc"),
          summary: phaseAssess.title,
          goal_ids: [],
          created_at: createdAt
        },
        {
          checkpoint_id: ctx.services.generateId("apc"),
          summary: phaseExecute.title,
          goal_ids: [],
          created_at: createdAt
        },
        {
          checkpoint_id: ctx.services.generateId("apc"),
          summary: phaseVerify.title,
          goal_ids: [],
          created_at: createdAt
        }
      ],
      contingencies: [
        {
          branch_id: ctx.services.generateId("abr"),
          trigger: "phase_failure",
          summary: `Revise plan and gather more evidence before retrying ${primaryGoal.title}.`
        }
      ],
      resource_estimate: {
        estimated_cycles: 3,
        estimated_tool_calls: 2,
        estimated_runtime_ms: 60_000
      },
      feedback: state.active_plan?.feedback ?? [],
      created_at: createdAt,
      updated_at: createdAt
    };
  }

  public async revisePlan(ctx: ModuleContext, state: AutonomyState): Promise<AutonomyDecision | null> {
    if (!state.active_plan) {
      return null;
    }

    return {
      decision_id: ctx.services.generateId("adn"),
      session_id: ctx.session.session_id,
      source: "planner",
      decision_type: "revise_plan",
      summary: `Revise ${state.active_plan.title} after degraded execution feedback.`,
      plan_id: state.active_plan.plan_id,
      created_at: now(ctx)
    };
  }
}
