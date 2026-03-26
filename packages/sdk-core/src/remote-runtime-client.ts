import type {
  AgentSession,
  ApprovalRequest,
  CreateSessionCommand,
  CycleTraceRecord,
  Episode,
  NeuroCoreEvent,
  UserInput,
  WorkspaceSnapshot
} from "@neurocore/protocol";
import type {
  SessionApprovalDecisionInput,
  SessionApprovalDecisionResult
} from "./types.js";

export interface SessionRunSummary {
  final_state: AgentSession["state"];
  output_text?: string;
  step_count: number;
  last_cycle_id?: string;
  updated_at: string;
}

export interface RemoteSessionRecord {
  agent_id: string;
  session: AgentSession;
  last_run: SessionRunSummary | null;
  active_run: boolean;
  trace_count: number;
  episode_count: number;
  pending_approval: ApprovalRequest | null;
}

export interface RemoteRuntimeClientOptions {
  agentId: string;
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface WaitForSessionOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface RemoteSessionEventStream {
  close(): void;
  done: Promise<void>;
}

interface ApprovalDecisionResponse extends RemoteSessionRecord {
  approval: ApprovalRequest;
}

export class RemoteAgentClient {
  private readonly agentId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  public constructor(options: RemoteRuntimeClientOptions) {
    this.agentId = options.agentId;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultHeaders = options.headers ?? {};
  }

  public async createSession(
    command: CreateSessionCommand,
    options?: { runImmediately?: boolean }
  ): Promise<RemoteSessionHandle> {
    const record = await this.request<RemoteSessionRecord>(
      "POST",
      `/v1/agents/${encodeURIComponent(this.agentId)}/sessions`,
      {
        tenant_id: command.tenant_id,
        user_id: command.user_id,
        session_mode: command.session_mode,
        initial_input: command.initial_input,
        run_immediately: options?.runImmediately ?? false
      }
    );

    return new RemoteSessionHandle(this, record, command.initial_input);
  }

  public async connectSession(sessionId: string): Promise<RemoteSessionHandle> {
    const record = await this.fetchSession(sessionId);
    return new RemoteSessionHandle(this, record);
  }

  public async fetchSession(sessionId: string): Promise<RemoteSessionRecord> {
    return this.request("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  public async submitInput(sessionId: string, input: UserInput): Promise<RemoteSessionRecord> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/inputs`, { input });
  }

  public async resumeSession(sessionId: string, input?: UserInput): Promise<RemoteSessionRecord> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/resume`, input ? { input } : {});
  }

  public async cancelSession(sessionId: string): Promise<RemoteSessionRecord> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
  }

  public async cleanupSession(sessionId: string, options?: { force?: boolean }): Promise<void> {
    await this.request(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(sessionId)}${options?.force ? "?force=true" : ""}`
    );
  }

  public async fetchTraces(sessionId: string): Promise<CycleTraceRecord[]> {
    const response = await this.request<{ traces: CycleTraceRecord[] }>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/traces`
    );
    return response.traces;
  }

  public async fetchEpisodes(sessionId: string): Promise<Episode[]> {
    const response = await this.request<{ episodes: Episode[] }>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/episodes`
    );
    return response.episodes;
  }

  public async fetchEvents(sessionId: string): Promise<NeuroCoreEvent[]> {
    const response = await this.request<{ events: NeuroCoreEvent[] }>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/events`
    );
    return response.events;
  }

  public async fetchWorkspace(sessionId: string, cycleId: string): Promise<WorkspaceSnapshot> {
    const response = await this.request<{ workspace: WorkspaceSnapshot }>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/workspace/${encodeURIComponent(cycleId)}`
    );
    return response.workspace;
  }

  public async fetchApproval(approvalId: string): Promise<ApprovalRequest> {
    const response = await this.request<{ approval: ApprovalRequest }>(
      "GET",
      `/v1/approvals/${encodeURIComponent(approvalId)}`
    );
    return response.approval;
  }

  public async decideApproval(
    approvalId: string,
    input: Omit<SessionApprovalDecisionInput, "approval_id">
  ): Promise<ApprovalDecisionResponse> {
    return this.request(
      "POST",
      `/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
      input
    );
  }

  public async waitForSessionSettled(
    sessionId: string,
    options: WaitForSessionOptions = {}
  ): Promise<RemoteSessionRecord> {
    const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 100);
    const timeoutAt = Date.now() + (options.timeoutMs ?? 30_000);

    while (true) {
      const record = await this.fetchSession(sessionId);
      if (!record.active_run && record.session.state !== "running") {
        return record;
      }

      if (Date.now() >= timeoutAt) {
        throw new Error(`Timed out waiting for session ${sessionId} to settle.`);
      }

      await sleep(pollIntervalMs);
    }
  }

  public async subscribeToSessionEvents(
    sessionId: string,
    listener: (event: NeuroCoreEvent) => void
  ): Promise<RemoteSessionEventStream> {
    const controller = new AbortController();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events/stream`, {
      method: "GET",
      headers: {
        ...this.defaultHeaders,
        accept: "text/event-stream"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      let message = "Unknown error.";
      try {
        const payload = (await response.json()) as Record<string, unknown>;
        if (typeof payload.message === "string") {
          message = payload.message;
        }
      } catch {}

      throw new Error(
        `GET /v1/sessions/${encodeURIComponent(sessionId)}/events/stream failed with status ${response.status}: ${message}`
      );
    }

    if (!response.body) {
      throw new Error("Runtime server did not provide a readable event stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const done = (async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });
          ({ buffer } = drainSseBuffer(buffer, listener));
        }

        buffer += decoder.decode();
        ({ buffer } = drainSseBuffer(buffer, listener, true));
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
    })();

    return {
      close() {
        controller.abort();
      },
      done
    };
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
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

export class RemoteSessionHandle {
  private record: RemoteSessionRecord;

  public constructor(
    private readonly client: RemoteAgentClient,
    record: RemoteSessionRecord,
    private readonly initialInput?: UserInput
  ) {
    this.record = record;
  }

  public get id(): string {
    return this.record.session.session_id;
  }

  public getSession(): AgentSession {
    return structuredClone(this.record.session);
  }

  public getLastRun(): SessionRunSummary | null {
    return this.record.last_run ? structuredClone(this.record.last_run) : null;
  }

  public getPendingApproval(): ApprovalRequest | undefined {
    return this.record.pending_approval ? structuredClone(this.record.pending_approval) : undefined;
  }

  public getTraceCount(): number {
    return this.record.trace_count;
  }

  public getEpisodeCount(): number {
    return this.record.episode_count;
  }

  public hasActiveRun(): boolean {
    return this.record.active_run;
  }

  public async refresh(): Promise<RemoteSessionRecord> {
    this.record = await this.client.fetchSession(this.id);
    return structuredClone(this.record);
  }

  public async run(): Promise<RemoteSessionRecord> {
    if (!this.initialInput) {
      throw new Error("This remote session handle does not have a default seed input. Use runInput or resume instead.");
    }
    return this.runInput(this.initialInput);
  }

  public async runInput(input: UserInput): Promise<RemoteSessionRecord> {
    this.record = await this.client.submitInput(this.id, input);
    return structuredClone(this.record);
  }

  public async runText(content: string, metadata?: Record<string, unknown>): Promise<RemoteSessionRecord> {
    return this.runInput({
      input_id: `inp_${Date.now()}`,
      content,
      created_at: new Date().toISOString(),
      metadata
    });
  }

  public async resume(input?: UserInput): Promise<RemoteSessionRecord> {
    this.record = await this.client.resumeSession(this.id, input);
    return structuredClone(this.record);
  }

  public async resumeText(content: string, metadata?: Record<string, unknown>): Promise<RemoteSessionRecord> {
    return this.resume({
      input_id: `inp_${Date.now()}`,
      content,
      created_at: new Date().toISOString(),
      metadata
    });
  }

  public async cancel(): Promise<RemoteSessionRecord> {
    this.record = await this.client.cancelSession(this.id);
    return structuredClone(this.record);
  }

  public async cleanup(options?: { force?: boolean }): Promise<void> {
    await this.client.cleanupSession(this.id, options);
  }

  public async waitForSettled(options?: WaitForSessionOptions): Promise<RemoteSessionRecord> {
    this.record = await this.client.waitForSessionSettled(this.id, options);
    return structuredClone(this.record);
  }

  public async getTraceRecords(): Promise<CycleTraceRecord[]> {
    return this.client.fetchTraces(this.id);
  }

  public async getEpisodes(): Promise<Episode[]> {
    return this.client.fetchEpisodes(this.id);
  }

  public async getEvents(): Promise<NeuroCoreEvent[]> {
    return this.client.fetchEvents(this.id);
  }

  public async getWorkspace(cycleId: string): Promise<WorkspaceSnapshot> {
    return this.client.fetchWorkspace(this.id, cycleId);
  }

  public async getApproval(approvalId?: string): Promise<ApprovalRequest> {
    const resolvedApprovalId = approvalId ?? this.getPendingApproval()?.approval_id;
    if (!resolvedApprovalId) {
      throw new Error(`Session ${this.id} does not have a pending approval request.`);
    }
    return this.client.fetchApproval(resolvedApprovalId);
  }

  public async subscribeToEvents(
    listener: (event: NeuroCoreEvent) => void
  ): Promise<RemoteSessionEventStream> {
    return this.client.subscribeToSessionEvents(this.id, listener);
  }

  public async decideApproval(input: SessionApprovalDecisionInput): Promise<SessionApprovalDecisionResult> {
    const approvalId = input.approval_id ?? this.getPendingApproval()?.approval_id;
    if (!approvalId) {
      throw new Error(`Session ${this.id} does not have a pending approval request.`);
    }

    const response = await this.client.decideApproval(approvalId, {
      approver_id: input.approver_id,
      decision: input.decision,
      comment: input.comment
    });
    this.record = {
      agent_id: response.agent_id,
      session: response.session,
      last_run: response.last_run,
      active_run: response.active_run,
      trace_count: response.trace_count,
      episode_count: response.episode_count,
      pending_approval: response.pending_approval
    };

    return {
      approval: response.approval
    };
  }

  public async approve(
    input: Omit<SessionApprovalDecisionInput, "decision">
  ): Promise<SessionApprovalDecisionResult> {
    return this.decideApproval({
      ...input,
      decision: "approved"
    });
  }

  public async reject(
    input: Omit<SessionApprovalDecisionInput, "decision">
  ): Promise<SessionApprovalDecisionResult> {
    return this.decideApproval({
      ...input,
      decision: "rejected"
    });
  }
}

export function connectRemoteAgent(options: RemoteRuntimeClientOptions): RemoteAgentClient {
  return new RemoteAgentClient(options);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function drainSseBuffer(
  rawBuffer: string,
  listener: (event: NeuroCoreEvent) => void,
  flush = false
): { buffer: string } {
  let buffer = rawBuffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (true) {
    const boundaryIndex = buffer.indexOf("\n\n");
    if (boundaryIndex === -1) {
      break;
    }

    const frame = buffer.slice(0, boundaryIndex);
    buffer = buffer.slice(boundaryIndex + 2);
    const parsed = parseSseFrame(frame);
    if (parsed) {
      listener(parsed);
    }
  }

  if (flush && buffer.trim().length > 0) {
    const parsed = parseSseFrame(buffer);
    if (parsed) {
      listener(parsed);
    }
    buffer = "";
  }

  return { buffer };
}

function parseSseFrame(frame: string): NeuroCoreEvent | undefined {
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return JSON.parse(dataLines.join("\n")) as NeuroCoreEvent;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
