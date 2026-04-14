import type { Verifier, VerifierResult } from "@neurocore/protocol";

export class DefaultSafetyVerifier implements Verifier {
  public readonly name = "safety-verifier";
  public readonly mode = "safety" as const;
  public readonly timeoutMs = 150;

  public shouldRun(input: Parameters<Verifier["verify"]>[0]) {
    return (
      input.triggerTags.includes("risk_high") ||
      input.triggerTags.includes("policy_warned")
    );
  }

  public async verify(input: Parameters<Verifier["verify"]>[0]): Promise<VerifierResult> {
    const sideEffectSeverity = input.frame.action_signals.side_effect_severity;
    const reversibilityScore = input.frame.action_signals.reversibility_score;
    const accountability = input.frame.governance_signals.need_for_human_accountability;
    const issues: NonNullable<VerifierResult["issues"]> = [];

    if (sideEffectSeverity >= 0.6) {
      issues.push({
        key: "side_effect_severity",
        severity: sideEffectSeverity >= 0.8 ? "high" : "medium",
        summary: `Side-effect severity is ${sideEffectSeverity.toFixed(2)}.`
      });
    }
    if (reversibilityScore <= 0.4) {
      issues.push({
        key: "low_reversibility",
        severity: reversibilityScore <= 0.25 ? "high" : "medium",
        summary: `Reversibility score is ${reversibilityScore.toFixed(2)}.`
      });
    }
    if (accountability >= 0.7) {
      issues.push({
        key: "human_accountability",
        severity: accountability >= 0.85 ? "high" : "medium",
        summary: `Human accountability requirement is ${accountability.toFixed(2)}.`
      });
    }

    const verdict =
      sideEffectSeverity >= 0.85 || (reversibilityScore <= 0.25 && accountability >= 0.8)
        ? "fail"
        : sideEffectSeverity >= 0.65 || accountability >= 0.7
          ? "inconclusive"
          : reversibilityScore <= 0.45
            ? "weak-pass"
            : "pass";

    return {
      verifier: this.name,
      mode: this.mode,
      verdict,
      summary:
        verdict === "fail"
          ? "Safety constraints are violated."
          : verdict === "inconclusive"
            ? "Safety risk remains unresolved."
            : verdict === "weak-pass"
              ? "Safety is acceptable but recovery is weak."
              : "Safety checks passed.",
      issues,
      metadata: {
        side_effect_severity: sideEffectSeverity,
        reversibility_score: reversibilityScore,
        accountability
      }
    };
  }
}
