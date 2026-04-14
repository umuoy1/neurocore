import type { Verifier, VerifierResult } from "@neurocore/protocol";

export class DefaultEvidenceVerifier implements Verifier {
  public readonly name = "evidence-verifier";
  public readonly mode = "evidence" as const;
  public readonly timeoutMs = 150;

  public shouldRun(input: Parameters<Verifier["verify"]>[0]) {
    return (
      input.triggerTags.includes("evidence_gap") ||
      input.triggerTags.includes("policy_warned")
    );
  }

  public async verify(input: Parameters<Verifier["verify"]>[0]): Promise<VerifierResult> {
    const coverage = input.frame.evidence_signals.retrieval_coverage;
    const gaps: NonNullable<VerifierResult["issues"]> = input.frame.evidence_signals.missing_critical_evidence_flags.map((flag) => ({
      key: flag,
      severity: flag.includes("low") ? "medium" : "high",
      summary: flag.replaceAll("_", " ")
    }));
    const agreement = input.frame.evidence_signals.evidence_agreement_score;
    const freshness = input.frame.evidence_signals.evidence_freshness;
    const verdict =
      gaps.length > 0 || coverage < 0.25
        ? "inconclusive"
        : coverage < 0.45 || agreement < 0.5 || freshness < 0.4
          ? "weak-pass"
          : "pass";

    return {
      verifier: this.name,
      mode: this.mode,
      verdict,
      summary:
        verdict === "inconclusive"
          ? "Evidence is insufficient for confident execution."
          : verdict === "weak-pass"
            ? "Evidence is present but still thin."
            : "Evidence coverage is sufficient.",
      issues: gaps,
      evidence_gaps: gaps.map((gap) => ({ ...gap })),
      metadata: {
        retrieval_coverage: coverage,
        evidence_agreement_score: agreement,
        evidence_freshness: freshness
      }
    };
  }
}
