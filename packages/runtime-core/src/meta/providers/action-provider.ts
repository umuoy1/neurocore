import type { ActionMetaSignals } from "@neurocore/protocol";
import {
  average,
  clamp01,
  provenance,
  type MetaSignalInput,
  type MetaSignalProvider
} from "./provider.js";

export class HeuristicActionSignalProvider implements MetaSignalProvider<ActionMetaSignals> {
  public readonly name = "heuristic-action-provider";
  public readonly family = "action" as const;

  public collect(input: MetaSignalInput) {
    const timestamp = input.ctx.services.now();
    const toolPreconditionCompleteness = computeToolPreconditionCompleteness(input.actions);
    const schemaConfidence = computeSchemaConfidence(input.actions);
    const actionCount = Math.max(input.actions.length, 1);
    const highRiskActionCount = input.actions.filter((action) => action.side_effect_level === "high").length;
    const mediumRiskActionCount = input.actions.filter((action) => action.side_effect_level === "medium").length;
    const sideEffectSeverity = clamp01((highRiskActionCount + mediumRiskActionCount * 0.5) / actionCount);
    const reversibilityScore = computeReversibilityScore(input.actions);
    const observability = computeObservability(input.actions);
    const fallbackAvailability = input.actions.some(
      (action) => action.action_type === "respond" || action.action_type === "ask_user"
    )
      ? 1
      : 0.4;

    return {
      signals: {
        tool_precondition_completeness: toolPreconditionCompleteness,
        schema_confidence: schemaConfidence,
        side_effect_severity: sideEffectSeverity,
        reversibility_score: reversibilityScore,
        observability_after_action: observability,
        fallback_availability: fallbackAvailability
      },
      provenance: [
        provenance("action", "tool_precondition_completeness", this.name, "ok", timestamp),
        provenance("action", "schema_confidence", this.name, "ok", timestamp)
      ]
    };
  }
}

function computeToolPreconditionCompleteness(actions: MetaSignalInput["actions"]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.action_type !== "call_tool") {
          return 1;
        }
        if (!action.tool_name) {
          return 0.2;
        }
        if (!Array.isArray(action.preconditions) || action.preconditions.length === 0) {
          return 0.8;
        }
        return 0.9;
      })
    )
  );
}

function computeSchemaConfidence(actions: MetaSignalInput["actions"]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.action_type !== "call_tool") {
          return 1;
        }
        if (!action.tool_name) {
          return 0.3;
        }
        if (action.tool_args && Object.keys(action.tool_args).length > 0) {
          return 0.9;
        }
        return 0.7;
      })
    )
  );
}

function computeReversibilityScore(actions: MetaSignalInput["actions"]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.rollback_hint) {
          return 0.95;
        }
        if (action.side_effect_level === "high") {
          return 0.2;
        }
        if (action.side_effect_level === "medium") {
          return 0.5;
        }
        return 0.9;
      })
    )
  );
}

function computeObservability(actions: MetaSignalInput["actions"]): number {
  if (actions.length === 0) {
    return 0.5;
  }

  return clamp01(
    average(
      actions.map((action) => {
        if (action.action_type === "respond" || action.action_type === "ask_user") {
          return 0.95;
        }
        if (action.action_type === "call_tool") {
          return 0.75;
        }
        return 0.65;
      })
    )
  );
}
