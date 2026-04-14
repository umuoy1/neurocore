import type {
  CounterfactualSimulator,
  Verifier,
  VerifierInput,
  VerifierResult,
  VerifierRunRecord
} from "@neurocore/protocol";

export async function runVerifierWithGuard(
  verifier: Verifier,
  input: VerifierInput
): Promise<{ result?: VerifierResult; run: VerifierRunRecord }> {
  const startedAt = Date.now();

  try {
    const result = await withTimeout(
      verifier.verify(input),
      verifier.timeoutMs,
      `${verifier.name} timed out`
    );
    return {
      result,
      run: {
        verifier: verifier.name,
        mode: verifier.mode,
        status: "ok",
        verdict: result.verdict,
        summary: result.summary,
        elapsed_ms: Date.now() - startedAt,
        metadata: result.metadata,
        issues: result.issues
      }
    };
  } catch (error) {
    return {
      run: {
        verifier: verifier.name,
        mode: verifier.mode,
        status: isTimeoutError(error) ? "timeout" : "failed",
        summary: isTimeoutError(error) ? `${verifier.name} timed out` : `${verifier.name} failed`,
        elapsed_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function runSimulatorWithGuard(
  simulator: CounterfactualSimulator,
  input: VerifierInput
): Promise<{ result?: VerifierResult; run: VerifierRunRecord } | null> {
  const startedAt = Date.now();

  try {
    const result = await withTimeout(
      simulator.simulate(input),
      simulator.timeoutMs,
      `${simulator.name} timed out`
    );
    if (!result) {
      return null;
    }
    return {
      result,
      run: {
        verifier: simulator.name,
        mode: result.mode,
        status: "ok",
        verdict: result.verdict,
        summary: result.summary,
        elapsed_ms: Date.now() - startedAt,
        metadata: result.metadata,
        issues: result.issues
      }
    };
  } catch (error) {
    return {
      run: {
        verifier: simulator.name,
        mode: "process",
        status: isTimeoutError(error) ? "timeout" : "failed",
        summary: isTimeoutError(error) ? `${simulator.name} timed out` : `${simulator.name} failed`,
        elapsed_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, message: string) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(message));
      }, timeoutMs);
    })
  ]);
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && /timed out/i.test(error.message);
}
