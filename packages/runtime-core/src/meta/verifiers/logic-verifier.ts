import type { Verifier, VerifierResult } from "@neurocore/protocol";

export class DefaultLogicVerifier implements Verifier {
  public readonly name = "logic-verifier";
  public readonly mode = "logic" as const;
  public readonly timeoutMs = 150;

  public shouldRun(input: Parameters<Verifier["verify"]>[0]) {
    return (
      input.triggerTags.includes("reasoning_conflict") ||
      input.triggerTags.includes("calibration_weak") ||
      input.triggerTags.includes("task_novel")
    );
  }

  public async verify(input: Parameters<Verifier["verify"]>[0]): Promise<VerifierResult> {
    const contradictionScore = input.frame.reasoning_signals.contradiction_score;
    const unsupportedLeapCount = input.frame.reasoning_signals.unsupported_leap_count;
    const divergence = input.frame.reasoning_signals.candidate_reasoning_divergence;
    const contestedSteps = input.actions
      .filter((action) => contradictionScore >= 0.45 || divergence >= 0.55)
      .map((action) => ({
        action_id: action.action_id,
        action_type: action.action_type,
        label: contradictionScore >= 0.55 ? "contradictory" : "unstable",
        summary: action.title
      }));

    const issues: NonNullable<VerifierResult["issues"]> = [];
    if (unsupportedLeapCount > 0) {
      issues.push({
        key: "unsupported_leaps",
        severity: unsupportedLeapCount >= 2 ? "high" : "medium",
        summary: `Detected ${unsupportedLeapCount} unsupported reasoning leaps.`
      });
    }
    if (contradictionScore >= 0.5) {
      issues.push({
        key: "contradiction_score",
        severity: contradictionScore >= 0.7 ? "high" : "medium",
        summary: `Reasoning contradiction score is ${contradictionScore.toFixed(2)}.`
      });
    }

    const verdict =
      contradictionScore >= 0.75 || unsupportedLeapCount >= 3
        ? "fail"
        : contradictionScore >= 0.5 || divergence >= 0.65
          ? "inconclusive"
          : unsupportedLeapCount > 0 || divergence >= 0.45
            ? "weak-pass"
            : "pass";

    return {
      verifier: this.name,
      mode: this.mode,
      verdict,
      summary:
        verdict === "fail"
          ? "Logical consistency failed."
          : verdict === "inconclusive"
            ? "Logical consistency remains unresolved."
            : verdict === "weak-pass"
              ? "Logical consistency is usable but fragile."
              : "Logical consistency passed.",
      issues,
      contested_steps: contestedSteps,
      metadata: {
        contradiction_score: contradictionScore,
        unsupported_leap_count: unsupportedLeapCount,
        divergence
      }
    };
  }
}
