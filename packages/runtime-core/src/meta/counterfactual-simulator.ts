import type { CounterfactualSimulator, VerifierResult } from "@neurocore/protocol";

export class DefaultCounterfactualSimulator implements CounterfactualSimulator {
  public readonly name = "counterfactual-simulator";
  public readonly timeoutMs = 150;

  public shouldRun(input: Parameters<CounterfactualSimulator["simulate"]>[0]) {
    return (
      input.triggerTags.includes("simulation_unreliable") ||
      input.triggerTags.includes("risk_high")
    );
  }

  public async simulate(
    input: Parameters<CounterfactualSimulator["simulate"]>[0]
  ): Promise<VerifierResult | null> {
    const simulatorConfidence = input.frame.prediction_signals.simulator_confidence;
    const mismatch = input.frame.prediction_signals.world_model_mismatch_score;
    const safeAlternative =
      input.actions.some((action) => action.action_type === "respond" || action.action_type === "ask_user");
    const verdict =
      mismatch >= 0.8
        ? "fail"
        : simulatorConfidence < 0.35 || mismatch >= 0.55
          ? "inconclusive"
          : simulatorConfidence < 0.5
            ? "weak-pass"
            : "pass";

    return {
      verifier: this.name,
      mode: "process",
      verdict,
      summary:
        verdict === "fail"
          ? "Counterfactual simulation predicts unacceptable drift."
          : verdict === "inconclusive"
            ? "Counterfactual simulation remains unreliable."
            : verdict === "weak-pass"
              ? "Counterfactual simulation is weak but usable."
              : "Counterfactual simulation passed.",
      counterfactual_checks: [
        {
          check: "safe-alternative-available",
          result: safeAlternative ? "yes" : "no"
        }
      ],
      metadata: {
        simulator_confidence: simulatorConfidence,
        world_model_mismatch_score: mismatch
      }
    };
  }
}
