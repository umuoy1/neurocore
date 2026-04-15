import type { GovernanceMetaSignals } from "@neurocore/protocol";
import {
  clamp01,
  provenance,
  ratio,
  type MetaSignalInput,
  type MetaSignalProvider
} from "./provider.js";

export class HeuristicGovernanceSignalProvider implements MetaSignalProvider<GovernanceMetaSignals> {
  public readonly name = "heuristic-governance-provider";
  public readonly family = "governance" as const;

  public collect(input: MetaSignalInput) {
    const timestamp = input.ctx.services.now();
    const warnCount = input.policies.filter((decision) => decision.level === "warn").length;
    const actionCount = Math.max(input.actions.length, 1);
    const highRiskActionCount = input.actions.filter((action) => action.side_effect_level === "high").length;
    const budgetPressure = computeBudgetPressure(input.ctx);
    const remainingRecoveryOptions = computeRecoveryOptions(input.actions);
    const needForHumanAccountability = clamp01(
      (highRiskActionCount > 0 ? 0.7 : 0) +
        (warnCount > 0 ? 0.2 : 0) +
        (budgetPressure >= 0.9 ? 0.1 : 0)
    );

    return {
      signals: {
        policy_warning_density: clamp01(warnCount / actionCount),
        budget_pressure: budgetPressure,
        remaining_recovery_options: remainingRecoveryOptions,
        need_for_human_accountability: needForHumanAccountability
      },
      provenance: [
        provenance(
          "governance",
          "budget_pressure",
          this.name,
          budgetPressure > 0 ? "ok" : "fallback",
          timestamp
        ),
        provenance("governance", "policy_warning_density", this.name, "ok", timestamp)
      ]
    };
  }
}

function computeBudgetPressure(ctx: MetaSignalInput["ctx"]) {
  const state = ctx.session.budget_state;
  const ratios = [
    ratio(state.token_budget_used, state.token_budget_total),
    ratio(state.cost_budget_used, state.cost_budget_total),
    ratio(state.tool_call_used, state.tool_call_limit),
    ratio(state.cycle_used, state.cycle_limit)
  ].filter((value): value is number => typeof value === "number");

  if (ratios.length === 0) {
    return 0;
  }

  const maxRatio = Math.max(...ratios);
  const meanRatio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return clamp01(maxRatio * 0.7 + meanRatio * 0.3);
}

function computeRecoveryOptions(actions: MetaSignalInput["actions"]) {
  if (actions.length === 0) {
    return 0;
  }

  const count = actions.filter(
    (action) =>
      action.action_type === "ask_user" ||
      action.action_type === "respond" ||
      Boolean(action.rollback_hint)
  ).length;
  return clamp01(count / actions.length);
}
