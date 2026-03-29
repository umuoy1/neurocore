import type { TokenEstimator } from "@neurocore/protocol";

const CHARS_PER_TOKEN = 4;

export class DefaultTokenEstimator implements TokenEstimator {
  public estimate(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
