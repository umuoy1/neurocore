import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type {
  AgentSession,
  ApprovalRequest,
  CreateSessionCommand,
  SessionState,
  UserInput
} from "@neurocore/protocol";
import { SessionStateConflictError } from "@neurocore/runtime-core";
import type { AgentBuilder, AgentSessionHandle } from "@neurocore/sdk-core";

export interface RuntimeServerOptions {
  host?: string;
  port?: number;
  agents?: AgentBuilder[];
}

interface SessionRunSummary {
  final_state: SessionState;
  output_text?: string;
  step_count: number;
  last_cycle_id?: string;
  updated_at: string;
}

interface ManagedSession {
  agent_id: string;
  handle: AgentSessionHandle;
  last_run?: SessionRunSummary;
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class NeuroRuntimeServer {
  private readonly host: string;
  private readonly port: number;
  private readonly agents = new Map<string, AgentBuilder>();
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly server: HttpServer;

  public constructor(options: RuntimeServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    for (const agent of options.agents ?? []) {
      this.registerAgent(agent);
    }

    this.server = createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response);
      } catch (error) {
        if (error instanceof HttpError) {
          writeJson(response, error.statusCode, {
            error: error.code,
            message: error.message
          });
          return;
        }

        if (error instanceof SessionStateConflictError) {
          writeJson(response, 409, {
            error: "state_conflict",
            message: error.message
          });
          return;
        }

        const message = error instanceof Error ? error.message : "Internal server error.";
        writeJson(response, 500, {
          error: "internal_error",
          message
        });
      }
    });
  }

  public registerAgent(agent: AgentBuilder): this {
    this.agents.set(agent.getProfile().agent_id, agent);
    return this;
  }

  public async listen(): Promise<{ host: string; port: number; url: string }> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Runtime server did not expose a TCP address.");
    }

    return {
      host: this.host,
      port: address.port,
      url: `http://${this.host}:${address.port}`
    };
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const path = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && path.length === 1 && path[0] === "healthz") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (method === "POST" && path.length === 4 && path[0] === "v1" && path[1] === "agents" && path[3] === "sessions") {
      const agentId = path[2] ?? "";
      const body = await readJson(request);
      const record = await this.createSession(agentId, body);
      writeJson(response, 201, this.serializeManagedSession(record));
      return;
    }

    if (path.length >= 3 && path[0] === "v1" && path[1] === "sessions") {
      const sessionId = path[2] ?? "";
      const record = this.requireSession(sessionId);

      if (method === "GET" && path.length === 3) {
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "inputs") {
        const body = await readJson(request);
        const input = normalizeInput(body.input ?? body, "session_input");
        const result = await record.handle.runInput(input);
        record.last_run = summarizeLoopResult(result);
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "resume") {
        const body = await readJson(request);
        const input = body.input ? normalizeInput(body.input, "resume_input") : undefined;
        const result = await record.handle.resume(input);
        record.last_run = summarizeLoopResult(result);
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "cancel") {
        record.handle.cancel();
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "GET" && path.length === 4 && path[3] === "traces") {
        writeJson(response, 200, {
          session_id: sessionId,
          traces: record.handle.getTraceRecords()
        });
        return;
      }

      if (method === "GET" && path.length === 5 && path[3] === "workspace") {
        const cycleId = path[4] ?? "";
        const workspace = record.handle
          .getTraceRecords()
          .find((trace) => trace.trace.cycle_id === cycleId)?.workspace;

        if (!workspace) {
          writeJson(response, 404, {
            error: "workspace_not_found",
            message: `No workspace found for cycle ${cycleId}.`
          });
          return;
        }

        writeJson(response, 200, {
          session_id: sessionId,
          cycle_id: cycleId,
          workspace
        });
        return;
      }

      if (method === "GET" && path.length === 4 && path[3] === "episodes") {
        writeJson(response, 200, {
          session_id: sessionId,
          episodes: record.handle.getEpisodes()
        });
        return;
      }
    }

    if (path.length >= 2 && path[0] === "v1" && path[1] === "approvals") {
      const approvalId = path[2] ?? "";
      const approvalRecord = this.requireApproval(approvalId);
      const sessionRecord = this.requireSession(approvalRecord.session_id);

      if (method === "GET" && path.length === 3) {
        writeJson(response, 200, {
          approval: approvalRecord
        });
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "decision") {
        const body = await readJson(request);
        const result = await sessionRecord.handle.decideApproval({
          approval_id: approvalId,
          approver_id: getRequiredString(body.approver_id, "approver_id"),
          decision: normalizeApprovalDecision(body.decision),
          comment: getOptionalString(body.comment)
        });

        if (result.run) {
          sessionRecord.last_run = summarizeLoopResult(result.run);
        }

        writeJson(response, 200, {
          approval: result.approval,
          ...this.serializeManagedSession(sessionRecord)
        });
        return;
      }
    }

    if (path.length >= 3 && path[0] === "v1" && path[1] === "evals" && path[2] === "runs") {
      writeJson(response, 501, {
        error: "not_implemented",
        message: "Eval API is not implemented in the MVP runtime-server yet."
      });
      return;
    }

    writeJson(response, 404, {
      error: "not_found",
      message: `No route matched ${method} ${url.pathname}.`
    });
  }

  private async createSession(agentId: string, payload: Record<string, unknown>): Promise<ManagedSession> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new HttpError(404, "agent_not_found", `Unknown agent: ${agentId}`);
    }

    const initialInput = normalizeInput(payload.initial_input, "initial_input");
    const command: CreateSessionCommand = {
      agent_id: agentId,
      tenant_id: getRequiredString(payload.tenant_id, "tenant_id"),
      user_id: getOptionalString(payload.user_id),
      session_mode: normalizeSessionMode(payload.session_mode),
      initial_input: initialInput
    };

    const handle = agent.createSession(command);
    const record: ManagedSession = {
      agent_id: agentId,
      handle
    };
    this.sessions.set(handle.id, record);

    const runImmediately = payload.run_immediately !== false;
    if (runImmediately) {
      const result = await handle.run();
      record.last_run = summarizeLoopResult(result);
    }

    return record;
  }

  private requireSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId) ?? this.connectPersistedSession(sessionId);
    if (!session) {
      throw new HttpError(404, "session_not_found", `Unknown session: ${sessionId}`);
    }
    return session;
  }

  private connectPersistedSession(sessionId: string): ManagedSession | undefined {
    for (const [agentId, agent] of this.agents.entries()) {
      try {
        const handle = agent.connectSession(sessionId);
        const record: ManagedSession = {
          agent_id: agentId,
          handle
        };
        this.sessions.set(sessionId, record);
        return record;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private requireApproval(approvalId: string): ApprovalRequest {
    for (const record of this.sessions.values()) {
      const approval = record.handle.getApproval(approvalId);
      if (approval) {
        return approval;
      }
    }

    throw new HttpError(404, "approval_not_found", `Unknown approval request: ${approvalId}`);
  }

  private serializeManagedSession(record: ManagedSession): Record<string, unknown> {
    const session = record.handle.getSession();
    if (!session) {
      throw new HttpError(404, "session_not_found", `Session ${record.handle.id} is unavailable.`);
    }

    return {
      agent_id: record.agent_id,
      session,
      last_run: record.last_run ?? null,
      trace_count: record.handle.getTraceRecords().length,
      episode_count: record.handle.getEpisodes().length,
      pending_approval: record.handle.getPendingApproval() ?? null
    };
  }
}

export function createRuntimeServer(options: RuntimeServerOptions = {}): NeuroRuntimeServer {
  return new NeuroRuntimeServer(options);
}

function summarizeLoopResult(result: {
  finalState: SessionState;
  outputText?: string;
  steps: Array<{ cycleId: string }>;
}): SessionRunSummary {
  return {
    final_state: result.finalState,
    output_text: result.outputText,
    step_count: result.steps.length,
    last_cycle_id: result.steps.at(-1)?.cycleId,
    updated_at: new Date().toISOString()
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_request", "Expected a JSON object payload.");
  }
  return parsed as Record<string, unknown>;
}

function normalizeInput(value: unknown, prefix: string): UserInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `Expected ${prefix} to be an object.`);
  }

  const record = value as Record<string, unknown>;
  return {
    input_id: getOptionalString(record.input_id) ?? `${prefix}_${Date.now()}`,
    content: getRequiredString(record.content, `${prefix}.content`),
    created_at: getOptionalString(record.created_at) ?? new Date().toISOString(),
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : undefined
  };
}

function normalizeSessionMode(value: unknown): AgentSession["session_mode"] | undefined {
  if (value === "sync" || value === "async" || value === "stream") {
    return value;
  }
  return undefined;
}

function normalizeApprovalDecision(value: unknown): "approved" | "rejected" {
  if (value === "approved" || value === "rejected") {
    return value;
  }
  throw new HttpError(400, "invalid_request", "Expected decision to be either 'approved' or 'rejected'.");
}

function getRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "invalid_request", `Expected ${field} to be a non-empty string.`);
  }
  return value;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function writeJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}
