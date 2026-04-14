import type { Verifier, VerifierResult } from "@neurocore/protocol";

export class DefaultProcessVerifier implements Verifier {
  public readonly name = "process-verifier";
  public readonly mode = "process" as const;
  public readonly timeoutMs = 150;

  public shouldRun(input: Parameters<Verifier["verify"]>[0]) {
    return (
      input.triggerTags.includes("task_novel") ||
      input.triggerTags.includes("ood_detected") ||
      input.triggerTags.includes("simulation_unreliable") ||
      input.triggerTags.includes("reasoning_conflict")
    );
  }

  public async verify(input: Parameters<Verifier["verify"]>[0]): Promise<VerifierResult> {
    const novelty = input.frame.task_signals.task_novelty;
    const ood = input.frame.task_signals.ood_score;
    const disagreement = input.frame.prediction_signals.uncertainty_decomposition.model_disagreement;
    const simulatorUnreliability = input.frame.prediction_signals.uncertainty_decomposition.simulator_unreliability;
    const issues: NonNullable<VerifierResult["issues"]> = [];

    if (ood >= 0.65) {
      issues.push({
        key: "ood_detected",
        severity: ood >= 0.8 ? "high" : "medium",
        summary: `OOD score is ${ood.toFixed(2)}.`
      });
    }
    if (simulatorUnreliability >= 0.6) {
      issues.push({
        key: "simulator_unreliable",
        severity: simulatorUnreliability >= 0.8 ? "high" : "medium",
        summary: `Simulator unreliability is ${simulatorUnreliability.toFixed(2)}.`
      });
    }

    const verdict =
      ood >= 0.8 || simulatorUnreliability >= 0.85
        ? "fail"
        : ood >= 0.65 || disagreement >= 0.65 || novelty >= 0.75
          ? "inconclusive"
          : simulatorUnreliability >= 0.55 || disagreement >= 0.5
            ? "weak-pass"
            : "pass";

    return {
      verifier: this.name,
      mode: this.mode,
      verdict,
      summary:
        verdict === "fail"
          ? "Process reliability failed under novelty or OOD."
          : verdict === "inconclusive"
            ? "Process reliability remains unresolved."
            : verdict === "weak-pass"
              ? "Process reliability is usable but unstable."
              : "Process reliability passed.",
      issues,
      metadata: {
        task_novelty: novelty,
        ood_score: ood,
        model_disagreement: disagreement,
        simulator_unreliability: simulatorUnreliability
      }
    };
  }
}
