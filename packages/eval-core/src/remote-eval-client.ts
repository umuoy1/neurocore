import type { EvalCase, EvalRunReport } from "./types.js";

export interface RemoteEvalClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export class RemoteEvalClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  public constructor(options: RemoteEvalClientOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultHeaders = options.headers ?? {};
  }

  public async runEval(
    agentId: string,
    cases: EvalCase[],
    options?: { parallelism?: number; agentVersion?: string }
  ): Promise<EvalRunReport> {
    return this.request<EvalRunReport>("POST", "/v1/evals/runs", {
      agent_id: agentId,
      cases,
      ...(typeof options?.parallelism === "number" ? { parallelism: options.parallelism } : {}),
      ...(typeof options?.agentVersion === "string" ? { agent_version: options.agentVersion } : {})
    });
  }

  public async getEvalReport(runId: string): Promise<EvalRunReport> {
    return this.request<EvalRunReport>("GET", `/v1/evals/runs/${encodeURIComponent(runId)}`);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.defaultHeaders,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `${method} ${path} failed with status ${response.status}: ${
          typeof payload.message === "string" ? payload.message : "Unknown error."
        }`
      );
    }

    return payload as T;
  }
}

export function connectRemoteEval(options: RemoteEvalClientOptions): RemoteEvalClient {
  return new RemoteEvalClient(options);
}
