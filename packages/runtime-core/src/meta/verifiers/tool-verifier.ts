import type { Verifier, VerifierResult } from "@neurocore/protocol";

export class DefaultToolVerifier implements Verifier {
  public readonly name = "tool-verifier";
  public readonly mode = "tool" as const;
  public readonly timeoutMs = 150;

  public shouldRun(input: Parameters<Verifier["verify"]>[0]) {
    return (
      input.triggerTags.includes("tool_not_ready") ||
      input.triggerTags.includes("risk_high")
    );
  }

  public async verify(input: Parameters<Verifier["verify"]>[0]): Promise<VerifierResult> {
    const completeness = input.frame.action_signals.tool_precondition_completeness;
    const schemaConfidence = input.frame.action_signals.schema_confidence;
    const fallbackAvailability = input.frame.action_signals.fallback_availability;
    const issues: NonNullable<VerifierResult["issues"]> = [];

    if (completeness < 0.5) {
      issues.push({
        key: "tool_preconditions_incomplete",
        severity: completeness < 0.3 ? "high" : "medium",
        summary: `Tool precondition completeness is ${completeness.toFixed(2)}.`
      });
    }
    if (schemaConfidence < 0.5) {
      issues.push({
        key: "tool_schema_uncertain",
        severity: schemaConfidence < 0.3 ? "high" : "medium",
        summary: `Tool schema confidence is ${schemaConfidence.toFixed(2)}.`
      });
    }

    const verdict =
      completeness < 0.3 || schemaConfidence < 0.3
        ? "fail"
        : completeness < 0.55 || schemaConfidence < 0.55
          ? "inconclusive"
          : fallbackAvailability < 0.45
            ? "weak-pass"
            : "pass";

    return {
      verifier: this.name,
      mode: this.mode,
      verdict,
      summary:
        verdict === "fail"
          ? "Tool execution preconditions are not met."
          : verdict === "inconclusive"
            ? "Tool execution readiness is unresolved."
            : verdict === "weak-pass"
              ? "Tool path is usable but fallback is weak."
              : "Tool execution readiness passed.",
      issues,
      metadata: {
        tool_precondition_completeness: completeness,
        schema_confidence: schemaConfidence,
        fallback_availability: fallbackAvailability
      }
    };
  }
}
