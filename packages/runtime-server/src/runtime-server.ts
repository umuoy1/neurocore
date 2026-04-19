import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentSession,
  ApprovalRequest,
  CreateSessionCommand,
  NeuroCoreEvent,
  NeuroCoreEventType,
  SessionState,
  UserInput
} from "@neurocore/protocol";
import { SessionStateConflictError } from "@neurocore/runtime-core";
import { InProcessAgentMesh, type AgentBuilder, type AgentSessionHandle } from "@neurocore/sdk-core";
import { EvalRunner, createSessionExecutor, type EvalCase, type EvalRunReport, compareEvalRuns } from "@neurocore/eval-core";
import type { Authenticator, AuthContext } from "./auth.js";
import { InMemoryEvalStore, SqliteEvalStore, type EvalStore } from "./eval-store.js";
import { Logger } from "./logger.js";
import { InMemoryMetricsStore, type MetricsStore } from "./metrics-store.js";
import { InMemoryAuditStore, type AuditStore } from "./audit-store.js";
import { InMemoryConfigStore, type ConfigStore } from "./config-store.js";
import { WsServer } from "./ws-server.js";

export interface RuntimeServerOptions {
  host?: string;
  port?: number;
  agents?: AgentBuilder[];
  webhooks?: RuntimeWebhookTarget[];
  fetch?: typeof fetch;
  authenticator?: Authenticator;
  evalStore?: EvalStore;
  evalStoreFilename?: string;
  metricsStore?: MetricsStore;
  auditStore?: AuditStore;
  configStore?: ConfigStore;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface RuntimeWebhookTarget {
  url: string;
  headers?: Record<string, string>;
  event_types?: NeuroCoreEventType[];
  session_modes?: AgentSession["session_mode"][];
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
  active_run?: Promise<void>;
  webhook_unsubscribe?: () => void;
}

interface WebhookDeliveryRecord {
  event_type: string;
  target_url: string;
  status: "success" | "failed";
  attempts: number;
  last_error?: string;
  timestamp: string;
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
  private readonly activeOperations = new Map<string, string>();
  private readonly evalStore: EvalStore;
  private readonly metricsStore: MetricsStore;
  private readonly auditStore: AuditStore;
  private readonly configStore: ConfigStore;
  private readonly server: HttpServer;
  private readonly webhookTargets: RuntimeWebhookTarget[];
  private readonly fetchImpl: typeof fetch;
  private readonly authenticator?: Authenticator;
  private readonly logger: Logger;
  private readonly startedAt = Date.now();
  private readonly sseConnections = new Set<ServerResponse>();
  private readonly webhookDeliveryLog: WebhookDeliveryRecord[] = [];
  private wsServer: WsServer | null = null;
  private multiAgentMesh: InProcessAgentMesh | null = null;
  private multiAgentConfigured = false;
  private static readonly MAX_DELIVERY_LOG = 1000;
  private totalSessionsCreated = 0;
  private totalCyclesExecuted = 0;

  public constructor(options: RuntimeServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    this.webhookTargets = options.webhooks ?? [];
    this.fetchImpl = options.fetch ?? fetch;
    this.authenticator = options.authenticator;
    this.evalStore = options.evalStore ??
      (options.evalStoreFilename
        ? new SqliteEvalStore({ filename: options.evalStoreFilename })
        : new InMemoryEvalStore());
    this.metricsStore = options.metricsStore ?? new InMemoryMetricsStore();
    this.auditStore = options.auditStore ?? new InMemoryAuditStore();
    this.configStore = options.configStore ?? new InMemoryConfigStore();
    this.logger = new Logger({ minLevel: options.logLevel ?? "info" });
    for (const agent of options.agents ?? []) {
      this.registerAgent(agent);
    }

    this.server = createServer(async (request, response) => {
      const start = Date.now();
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      let authContext: AuthContext | undefined;
      try {
        authContext = await this.authenticateRequest(request, url);
        await this.handleRequest(request, response, authContext);
      } catch (error) {
        if (error instanceof HttpError) {
          writeJson(response, error.statusCode, {
            error: error.code,
            message: error.message
          });
        } else if (error instanceof SessionStateConflictError) {
          writeJson(response, 409, {
            error: "state_conflict",
            message: error.message
          });
        } else {
          const message = error instanceof Error ? error.message : "Internal server error.";
          writeJson(response, 500, {
            error: "internal_error",
            message
          });
        }
      } finally {
        const duration = Date.now() - start;
        this.logger.info("request", {
          method,
          path: url.pathname,
          status: response.statusCode,
          duration_ms: duration,
          tenant_id: authContext?.tenant_id
        });
      }
    });
  }

  public registerAgent(agent: AgentBuilder): this {
    this.agents.set(agent.getProfile().agent_id, agent);
    this.multiAgentConfigured = false;
    return this;
  }

  public async listen(): Promise<{ host: string; port: number; url: string }> {
    await this.ensureMultiAgentMesh();
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
    this.wsServer?.stop();
    for (const record of this.sessions.values()) {
      record.webhook_unsubscribe?.();
      record.webhook_unsubscribe = undefined;
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await this.multiAgentMesh?.close();
    this.multiAgentMesh = null;
    this.multiAgentConfigured = false;
    this.evalStore.close?.();
  }

  private async authenticateRequest(req: IncomingMessage, url: URL): Promise<AuthContext | undefined> {
    if (!this.authenticator) {
      return undefined;
    }

    const path = url.pathname.split("/").filter(Boolean);
    if (path.length === 1 && path[0] === "healthz") {
      return undefined;
    }

    const ctx = await this.authenticator.authenticate(req);
    if (!ctx) {
      throw new HttpError(401, "unauthorized", "Invalid or missing API key.");
    }

    return ctx;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse, authContext?: AuthContext): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const path = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && path.length === 1 && path[0] === "healthz") {
      const pkg = { version: "0.0.0" };
      try {
        const fs = await import("node:fs");
        const p = await import("node:path");
        const raw = fs.readFileSync(p.resolve(import.meta.dirname ?? ".", "..", "package.json"), "utf8");
        Object.assign(pkg, JSON.parse(raw));
      } catch {}
      writeJson(response, 200, {
        status: "ok",
        active_sessions: this.sessions.size,
        uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
        version: pkg.version
      });
      return;
    }

    requireRoutePermission(authContext, method, path);

    if (method === "GET" && path.length === 2 && path[0] === "v1" && path[1] === "metrics") {
      const pkg = { version: "0.0.0" };
      try {
        const fs = await import("node:fs");
        const p = await import("node:path");
        const raw = fs.readFileSync(p.resolve(import.meta.dirname ?? ".", "..", "package.json"), "utf8");
        Object.assign(pkg, JSON.parse(raw));
      } catch {}
      writeJson(response, 200, this.metricsStore.getSnapshot(
        this.sessions.size,
        Math.floor((Date.now() - this.startedAt) / 1000),
        pkg.version,
        this.sseConnections.size
      ) as unknown as Record<string, unknown>);
      return;
    }

    if (method === "GET" && path.length === 3 && path[0] === "v1" && path[1] === "metrics" && path[2] === "timeseries") {
      const metric = url.searchParams.get("metric") ?? "cycles_executed";
      const windowMs = parseInt(url.searchParams.get("window_ms") ?? "3600000", 10);
      const intervalMs = parseInt(url.searchParams.get("interval_ms") ?? "60000", 10);
      writeJson(response, 200, {
        metric,
        points: this.metricsStore.queryTimeseries(metric, windowMs, intervalMs)
      });
      return;
    }

    if (method === "GET" && path.length === 3 && path[0] === "v1" && path[1] === "metrics" && path[2] === "latency") {
      const windowMs = parseInt(url.searchParams.get("window_ms") ?? "3600000", 10);
      writeJson(response, 200, this.metricsStore.getLatencyPercentiles(windowMs) as unknown as Record<string, unknown>);
      return;
    }

    if (method === "GET" && path.length === 3 && path[0] === "v1" && path[1] === "metrics" && path[2] === "prometheus") {
      const pkg = { version: "0.0.0" };
      try {
        const fs = await import("node:fs");
        const p = await import("node:path");
        const raw = fs.readFileSync(p.resolve(import.meta.dirname ?? ".", "..", "package.json"), "utf8");
        Object.assign(pkg, JSON.parse(raw));
      } catch {}
      const snapshot = this.metricsStore.getSnapshot(
        this.sessions.size,
        Math.floor((Date.now() - this.startedAt) / 1000),
        pkg.version,
        this.sseConnections.size
      );
      const latency = this.metricsStore.getLatencyPercentiles(3600000);
      writeText(response, 200, formatPrometheusMetrics(snapshot, latency), "text/plain; version=0.0.4");
      return;
    }

    if (method === "GET" && path.length === 3 && path[0] === "v1" && path[1] === "runtime" && path[2] === "saturation") {
      writeJson(response, 200, buildRuntimeSaturationReport(this.sessions, this.activeOperations, this.sseConnections.size));
      return;
    }

    if (method === "GET" && path.length === 2 && path[0] === "v1" && path[1] === "agents") {
      const profiles = this.configStore.listProfiles();
      const runtime = Array.from(this.agents.entries()).map(([id, builder]) => {
        const p = builder.getProfile();
        const stored = this.configStore.getProfile(id);
        return {
          agent_id: id,
          name: (stored?.name as string) ?? p.name ?? id,
          version: (stored?.version as string) ?? p.version ?? "0.0.0",
          has_runtime: true,
        };
      });
      for (const sp of profiles) {
        if (!runtime.find((r) => r.agent_id === sp.agent_id)) {
          runtime.push({ ...sp, has_runtime: false });
        }
      }
      writeJson(response, 200, { agents: runtime });
      return;
    }

    if (path.length >= 3 && path[0] === "v1" && path[1] === "agents" && path[2] !== "sessions") {
      const agentId = path[2] ?? "";

      if (method === "GET" && path.length === 4 && path[3] === "profile") {
        const profile = this.configStore.getProfile(agentId);
        if (!profile) {
          const builder = this.agents.get(agentId);
          if (builder) {
            writeJson(response, 200, { profile: builder.getProfile() as unknown as Record<string, unknown> });
            return;
          }
          throw new HttpError(404, "agent_not_found", `Unknown agent: ${agentId}`);
        }
        writeJson(response, 200, { profile });
        return;
      }

      if (method === "PUT" && path.length === 4 && path[3] === "profile") {
        const body = await readJson(request);
        this.configStore.setProfile(agentId, body);
        this.auditStore.record({
          tenant_id: authContext?.tenant_id ?? "system",
          user_id: authContext?.tenant_id ?? "system",
          action: "config.update",
          target_type: "agent_profile",
          target_id: agentId,
          details: { fields: Object.keys(body) },
        });
        writeJson(response, 200, { agent_id: agentId, updated: true });
        return;
      }
    }

    if (path.length >= 2 && path[0] === "v1" && path[1] === "policies") {
      if (method === "GET" && path.length === 2) {
        const tenantFilter = url.searchParams.get("tenant_id") ?? authContext?.tenant_id;
        writeJson(response, 200, { policies: this.configStore.listPolicies(tenantFilter) });
        return;
      }
      if (method === "POST" && path.length === 2) {
        const body = await readJson(request);
        const policy = this.configStore.createPolicy({
          name: getRequiredString(body.name, "name"),
          description: getOptionalString(body.description) ?? "",
          tenant_id: authContext?.tenant_id ?? "default",
          affected_tools: Array.isArray(body.affected_tools) ? body.affected_tools as string[] : [],
          risk_levels: Array.isArray(body.risk_levels) ? body.risk_levels as string[] : [],
          rules: (body.rules ?? {}) as Record<string, unknown>,
        });
        writeJson(response, 201, policy as unknown as Record<string, unknown>);
        return;
      }
      if (path.length >= 3) {
        const policyId = path[2] ?? "";
        if (method === "GET" && path.length === 3) {
          const policy = this.configStore.getPolicy(policyId);
          if (!policy) throw new HttpError(404, "policy_not_found", `Unknown policy: ${policyId}`);
          writeJson(response, 200, policy as unknown as Record<string, unknown>);
          return;
        }
        if (method === "PUT" && path.length === 3) {
          const body = await readJson(request);
          const updated = this.configStore.updatePolicy(policyId, body as Partial<import("./config-store.js").PolicyTemplate>);
          if (!updated) throw new HttpError(404, "policy_not_found", `Unknown policy: ${policyId}`);
          writeJson(response, 200, updated as unknown as Record<string, unknown>);
          return;
        }
        if (method === "DELETE" && path.length === 3) {
          const deleted = this.configStore.deletePolicy(policyId);
          writeJson(response, deleted ? 200 : 404, { policy_id: policyId, deleted });
          return;
        }
      }
    }

    if (path.length >= 2 && path[0] === "v1" && path[1] === "api-keys") {
      if (method === "GET" && path.length === 2) {
        const tenantFilter = url.searchParams.get("tenant_id") ?? authContext?.tenant_id;
        writeJson(response, 200, { keys: this.configStore.listApiKeys(tenantFilter) });
        return;
      }
      if (method === "POST" && path.length === 2) {
        const body = await readJson(request);
        const result = this.configStore.createApiKey({
          tenant_id: getRequiredString(body.tenant_id, "tenant_id"),
          role: getOptionalString(body.role) ?? "viewer",
          expiration: getOptionalString(body.expiration),
        });
        this.auditStore.record({
          tenant_id: authContext?.tenant_id ?? "system",
          user_id: authContext?.tenant_id ?? "system",
          action: "key.create",
          target_type: "api_key",
          target_id: result.key_id,
          details: {},
        });
        writeJson(response, 201, result as unknown as Record<string, unknown>);
        return;
      }
      if (method === "DELETE" && path.length === 3) {
        const keyId = path[2] ?? "";
        const revoked = this.configStore.revokeApiKey(keyId);
        if (revoked) {
          this.auditStore.record({
            tenant_id: authContext?.tenant_id ?? "system",
            user_id: authContext?.tenant_id ?? "system",
            action: "key.revoke",
            target_type: "api_key",
            target_id: keyId,
            details: {},
          });
        }
        writeJson(response, revoked ? 200 : 404, { key_id: keyId, revoked });
        return;
      }
    }

    if (method === "GET" && path.length === 2 && path[0] === "v1" && path[1] === "audit-logs") {
      const filter: import("./audit-store.js").AuditQueryFilter = {
        tenant_id: url.searchParams.get("tenant_id") ?? authContext?.tenant_id,
        user_id: url.searchParams.get("user_id") ?? undefined,
        action: url.searchParams.get("action") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        limit: parseInt(url.searchParams.get("limit") ?? "100", 10),
        offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
      };
      writeJson(response, 200, this.auditStore.query(filter) as unknown as Record<string, unknown>);
      return;
    }

    if (method === "GET" && path.length === 2 && path[0] === "v1" && path[1] === "sessions") {
      const tenantFilter = url.searchParams.get("tenant_id") ?? authContext?.tenant_id;
      const stateFilter = url.searchParams.get("state");
      const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      let entries = Array.from(this.sessions.entries()).map(([id, rec]) => ({
        session_id: id,
        agent_id: rec.agent_id,
        session: rec.handle.getSession(),
        active_run: Boolean(rec.active_run)
      }));

      if (tenantFilter) {
        entries = entries.filter((e) => e.session?.tenant_id === tenantFilter);
      }
      if (stateFilter) {
        entries = entries.filter((e) => e.session?.state === stateFilter);
      }

      writeJson(response, 200, {
        sessions: entries.slice(offset, offset + limit),
        total: entries.length
      });
      return;
    }

    if (method === "GET" && path.length === 2 && path[0] === "v1" && path[1] === "approvals") {
      const tenantFilter = url.searchParams.get("tenant_id") ?? authContext?.tenant_id;
      const statusFilter = url.searchParams.get("status");

      let approvals: Array<{ approval: ApprovalRequest; session_id: string; agent_id: string }> = [];
      for (const [, rec] of this.sessions) {
        const pending = rec.handle.getPendingApproval();
        if (pending) {
          approvals.push({ approval: pending, session_id: rec.handle.id, agent_id: rec.agent_id });
        }
      }

      if (tenantFilter) {
        approvals = approvals.filter((a) => {
          const sess = this.sessions.get(a.session_id);
          return sess?.handle.getSession()?.tenant_id === tenantFilter;
        });
      }
      if (statusFilter) {
        approvals = approvals.filter((a) => a.approval.status === statusFilter);
      }

      writeJson(response, 200, { approvals });
      return;
    }

    if (method === "POST" && path.length === 4 && path[0] === "v1" && path[1] === "agents" && path[3] === "sessions") {
      const agentId = path[2] ?? "";
      const body = await readJson(request);
      const record = await this.createSession(agentId, body, authContext);
      writeJson(response, 201, this.serializeManagedSession(record));
      return;
    }

    if (path.length >= 3 && path[0] === "v1" && path[1] === "sessions") {
      const sessionId = path[2] ?? "";
      const record = this.requireSession(sessionId);

      if (method === "DELETE" && path.length === 3) {
        const force = url.searchParams.get("force") === "true";
        await this.runSessionOperation(record, "cleanup", async () => {
          record.handle.cleanup({ force });
        });
        record.webhook_unsubscribe?.();
        record.webhook_unsubscribe = undefined;
        record.active_run = undefined;
        this.sessions.delete(sessionId);
        writeJson(response, 200, {
          session_id: sessionId,
          deleted: true
        });
        return;
      }

      if (method === "GET" && path.length === 3) {
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "inputs") {
        const body = await readJson(request);
        const input = normalizeInput(body.input ?? body, "session_input");
        if (isBackgroundMode(record.handle.getSession()?.session_mode)) {
          this.startBackgroundRun(record, "run_input", async () => record.handle.runInput(input));
          writeJson(response, 202, this.serializeManagedSession(record));
          return;
        }

        const result = await this.runSessionOperation(record, "run_input", async () => record.handle.runInput(input));
        record.last_run = summarizeLoopResult(result);
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "resume") {
        const body = await readJson(request);
        const input = body.input ? normalizeInput(body.input, "resume_input") : undefined;
        if (isBackgroundMode(record.handle.getSession()?.session_mode)) {
          this.startBackgroundRun(record, "resume", async () => record.handle.resume(input));
          writeJson(response, 202, this.serializeManagedSession(record));
          return;
        }

        const result = await this.runSessionOperation(record, "resume", async () => record.handle.resume(input));
        record.last_run = summarizeLoopResult(result);
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "cancel") {
        await this.runSessionOperation(record, "cancel", async () => {
          record.handle.cancel();
        });
        writeJson(response, 200, this.serializeManagedSession(record));
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "checkpoint") {
        let checkpoint;
        await this.runSessionOperation(record, "checkpoint", async () => {
          checkpoint = record.handle.checkpoint();
        });
        writeJson(response, 200, {
          session_id: sessionId,
          checkpoint
        });
        return;
      }

      if (method === "POST" && path.length === 4 && path[3] === "suspend") {
        let checkpoint;
        await this.runSessionOperation(record, "suspend", async () => {
          checkpoint = record.handle.suspend();
        });
        writeJson(response, 200, {
          session_id: sessionId,
          checkpoint
        });
        return;
      }

      if (method === "GET" && path.length === 4 && path[3] === "traces") {
        const traces = record.handle.getTraceRecords();
        const page = paginateItems(
          traces,
          parsePaginationParams(url)
        );
        writeJson(response, 200, {
          session_id: sessionId,
          traces: page.items,
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          has_more: page.has_more
        });
        return;
      }

      if (method === "GET" && path.length === 5 && path[3] === "traces" && path[4] === "export") {
        const traces = record.handle.getTraceRecords();
        const format = url.searchParams.get("format") ?? "json";
        if (format === "ndjson") {
          writeText(
            response,
            200,
            traces.map((trace) => JSON.stringify(trace)).join("\n"),
            "application/x-ndjson"
          );
          return;
        }

        writeJson(response, 200, {
          session_id: sessionId,
          trace_count: traces.length,
          traces
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
        const episodes = record.handle.getEpisodes();
        const page = paginateItems(
          episodes,
          parsePaginationParams(url)
        );
        writeJson(response, 200, {
          session_id: sessionId,
          episodes: page.items,
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          has_more: page.has_more
        });
        return;
      }

      if (method === "GET" && path.length === 4 && path[3] === "events") {
        const events = record.handle.getEvents();
        const page = paginateItems(
          events,
          parsePaginationParams(url)
        );
        writeJson(response, 200, {
          session_id: sessionId,
          events: page.items,
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          has_more: page.has_more
        });
        return;
      }

      if (method === "GET" && path.length === 5 && path[3] === "events" && path[4] === "stream") {
        this.streamSessionEvents(request, response, record);
        return;
      }

      if (method === "GET" && path.length === 4 && path[3] === "replay") {
        const traces = record.handle.getTraceRecords();
        const finalRecord = traces.at(-1);
        const finalOutput =
          finalRecord?.observation?.summary ??
          finalRecord?.selected_action?.description ??
          finalRecord?.selected_action?.title;
        writeJson(response, 200, {
          session_id: sessionId,
          cycle_count: traces.length,
          traces: traces,
          final_output: finalOutput ?? null
        });
        return;
      }

      if (method === "GET" && path.length === 5 && path[3] === "replay") {
        const cycleId = path[4] ?? "";
        const cycleRecord = record.handle.getTraceRecords()
          .find((tr) => tr.trace.cycle_id === cycleId);
        if (!cycleRecord) {
          throw new HttpError(404, "cycle_not_found", `No cycle record found for ${cycleId}.`);
        }
        writeJson(response, 200, cycleRecord as unknown as Record<string, unknown>);
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
        if (authContext) {
          const sessionTenantId = sessionRecord.handle.getSession()?.tenant_id;
          if (sessionTenantId && authContext.tenant_id !== sessionTenantId) {
            throw new HttpError(403, "tenant_mismatch", `Authenticated tenant ${authContext.tenant_id} cannot decide approvals for tenant ${sessionTenantId}.`);
          }
        }
        const body = await readJson(request);
        const result = await this.runSessionOperation(sessionRecord, "approval_decision", async () => {
          return sessionRecord.handle.decideApproval({
            approval_id: approvalId,
            approver_id: getRequiredString(body.approver_id, "approver_id"),
            decision: normalizeApprovalDecision(body.decision),
            comment: getOptionalString(body.comment),
            reviewer_identity: authContext
              ? {
                  api_key_id: authContext.api_key_id,
                  tenant_id: authContext.tenant_id,
                  permissions: authContext.permissions
                }
              : undefined
          });
        });

        this.auditStore.record({
          tenant_id: authContext?.tenant_id ?? sessionRecord.handle.getSession()?.tenant_id ?? "system",
          user_id: authContext?.api_key_id ?? getRequiredString(body.approver_id, "approver_id"),
          action: result.approval.decision === "approved" ? "approval.approved" : "approval.rejected",
          target_type: "approval",
          target_id: approvalId,
          details: {
            session_id: result.approval.session_id,
            action_id: result.approval.action_id,
            approver_id: result.approval.approver_id,
            reviewer_identity: result.approval.reviewer_identity
          },
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

    if (method === "GET" && path.length === 3 && path[0] === "v1" && path[1] === "evals" && path[2] === "compare") {
      const runAId = url.searchParams.get("run_a");
      const runBId = url.searchParams.get("run_b");
      if (!runAId || !runBId) {
        throw new HttpError(400, "invalid_request", "Both run_a and run_b query parameters are required.");
      }
      const reportA = this.evalStore.get(runAId);
      if (!reportA) {
        throw new HttpError(404, "eval_run_not_found", `Unknown eval run: ${runAId}`);
      }
      const reportB = this.evalStore.get(runBId);
      if (!reportB) {
        throw new HttpError(404, "eval_run_not_found", `Unknown eval run: ${runBId}`);
      }
      const comparison = compareEvalRuns(reportA, reportB);
      writeJson(response, 200, comparison as unknown as Record<string, unknown>);
      return;
    }

    if (path.length >= 3 && path[0] === "v1" && path[1] === "evals" && path[2] === "runs") {
      if (method === "POST" && path.length === 3) {
        const body = await readJson(request);
        const agentId = getRequiredString(body.agent_id, "agent_id");
        const cases = body.cases;
        if (!Array.isArray(cases)) {
          throw new HttpError(400, "invalid_request", "cases must be an array of EvalCase.");
        }
        const report = await this.runEval(agentId, cases as EvalCase[], authContext);
        writeJson(response, 201, report as unknown as Record<string, unknown>);
        return;
      }

      if (method === "GET" && path.length === 3) {
        const tenantFilter = url.searchParams.get("tenant_id") ?? authContext?.tenant_id;
        const agentFilter = url.searchParams.get("agent_id");
        const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

        const reports = this.evalStore.list({
          tenant_id: tenantFilter ?? undefined,
          agent_id: agentFilter ?? undefined,
          limit,
          offset
        });
        writeJson(response, 200, { runs: reports as unknown as Record<string, unknown>[], total: reports.length });
        return;
      }

      if (method === "GET" && path.length === 4) {
        const runId = path[3] ?? "";
        const report = this.evalStore.get(runId);
        if (!report) {
          throw new HttpError(404, "eval_run_not_found", `Unknown eval run: ${runId}`);
        }
        writeJson(response, 200, report as unknown as Record<string, unknown>);
        return;
      }

      if (method === "DELETE" && path.length === 4) {
        const runId = path[3] ?? "";
        const report = this.evalStore.get(runId);
        if (!report) {
          throw new HttpError(404, "eval_run_not_found", `Unknown eval run: ${runId}`);
        }
        this.evalStore.delete(runId);
        writeJson(response, 200, { run_id: runId, deleted: true });
        return;
      }
    }

    if (method === "GET" && path.length === 3 && path[0] === "v1" && path[1] === "webhooks" && path[2] === "deliveries") {
      writeJson(response, 200, { deliveries: this.webhookDeliveryLog });
      return;
    }

    writeJson(response, 404, {
      error: "not_found",
      message: `No route matched ${method} ${url.pathname}.`
    });
  }

  private async createSession(agentId: string, payload: Record<string, unknown>, authContext?: AuthContext): Promise<ManagedSession> {
    await this.ensureMultiAgentMesh();
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new HttpError(404, "agent_not_found", `Unknown agent: ${agentId}`);
    }

    const tenantId = getRequiredString(payload.tenant_id, "tenant_id");
    if (authContext && authContext.tenant_id !== tenantId) {
      throw new HttpError(403, "tenant_mismatch", `Authenticated tenant ${authContext.tenant_id} cannot create sessions for tenant ${tenantId}.`);
    }

    const initialInput = normalizeInput(payload.initial_input, "initial_input");
    const command: CreateSessionCommand = {
      command_type: "create_session",
      agent_id: agentId,
      tenant_id: tenantId,
      user_id: getOptionalString(payload.user_id),
      session_mode: normalizeSessionMode(payload.session_mode),
      initial_input: initialInput
    };

    const handle = agent.createSession(command);
    const record: ManagedSession = {
      agent_id: agentId,
      handle
    };
    this.attachWebhookDelivery(record);
    this.sessions.set(handle.id, record);
    this.totalSessionsCreated++;

    const runImmediately = payload.run_immediately !== false;
    if (runImmediately) {
      if (isBackgroundMode(command.session_mode)) {
        this.startBackgroundRun(record, "run", async () => handle.run());
      } else {
        const result = await this.runSessionOperation(record, "run", async () => handle.run());
        record.last_run = summarizeLoopResult(result);
        this.totalCyclesExecuted += result.steps.length;
      }
    }

    return record;
  }

  private async runEval(agentId: string, cases: EvalCase[], authContext?: AuthContext): Promise<EvalRunReport> {
    await this.ensureMultiAgentMesh();
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new HttpError(404, "agent_not_found", `Unknown agent: ${agentId}`);
    }

    const tenantId = authContext?.tenant_id ?? "eval";

    const executor = createSessionExecutor((testCase) => {
      const handle = agent.createSession({
        agent_id: agentId,
        tenant_id: tenantId,
        initial_input: {
          input_id: `inp_eval_${testCase.case_id}`,
          content: testCase.input.content,
          created_at: new Date().toISOString(),
          metadata: testCase.input.metadata
        }
      });
      return handle;
    });

    const runner = new EvalRunner(executor);
    const report = await runner.run(cases);
    report.tenant_id = tenantId;
    report.agent_id = agentId;
    this.evalStore.save(report);
    return report;
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
        this.attachWebhookDelivery(record);
        this.sessions.set(sessionId, record);
        return record;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async ensureMultiAgentMesh(): Promise<void> {
    if (this.multiAgentConfigured) {
      return;
    }

    if (this.agents.size === 0) {
      this.multiAgentConfigured = true;
      return;
    }

    const shouldEnableMesh =
      this.agents.size > 1 ||
      [...this.agents.values()].some((agent) => agent.getProfile().multi_agent_config?.enabled);

    if (!shouldEnableMesh) {
      this.multiAgentConfigured = true;
      return;
    }

    this.multiAgentMesh ??= new InProcessAgentMesh();
    await this.multiAgentMesh.registerAgents(this.agents.values());
    this.multiAgentConfigured = true;
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
      active_run: Boolean(record.active_run),
      trace_count: record.handle.getTraceRecords().length,
      episode_count: record.handle.getEpisodes().length,
      pending_approval: record.handle.getPendingApproval() ?? null
    };
  }

  private attachWebhookDelivery(record: ManagedSession): void {
    if (this.webhookTargets.length === 0 || record.webhook_unsubscribe) {
      return;
    }

    for (const event of record.handle.getEvents()) {
      this.dispatchWebhookEvent(record, event);
    }

    record.webhook_unsubscribe = record.handle.subscribeToEvents((event) => {
      this.dispatchWebhookEvent(record, event);
    });
  }

  private dispatchWebhookEvent(record: ManagedSession, event: NeuroCoreEvent): void {
    const sessionMode = record.handle.getSession()?.session_mode;

    for (const target of this.webhookTargets) {
      if (
        Array.isArray(target.event_types) &&
        target.event_types.length > 0 &&
        !target.event_types.includes(event.event_type)
      ) {
        continue;
      }

      if (
        Array.isArray(target.session_modes) &&
        target.session_modes.length > 0 &&
        sessionMode &&
        !target.session_modes.includes(sessionMode)
      ) {
        continue;
      }

      void this.deliverWebhook(target, event);
    }
  }

  private async deliverWebhook(target: RuntimeWebhookTarget, event: NeuroCoreEvent): Promise<void> {
    const maxAttempts = 3;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(target.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(target.headers ?? {})
          },
          body: JSON.stringify(event)
        });

        if (res.ok || (res.status >= 400 && res.status < 500)) {
          this.recordWebhookDelivery({
            event_type: event.event_type,
            target_url: target.url,
            status: "success",
            attempts: attempt,
            timestamp: new Date().toISOString()
          });
          this.logger.debug("webhook_delivered", {
            event_type: event.event_type,
            target_url: target.url,
            attempts: attempt
          });
          return;
        }

        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.recordWebhookDelivery({
      event_type: event.event_type,
      target_url: target.url,
      status: "failed",
      attempts: maxAttempts,
      last_error: lastError,
      timestamp: new Date().toISOString()
    });
    this.logger.warn("webhook_delivery_failed", {
      event_type: event.event_type,
      target_url: target.url,
      attempts: maxAttempts,
      last_error: lastError
    });
  }

  private recordWebhookDelivery(record: WebhookDeliveryRecord): void {
    this.webhookDeliveryLog.push(record);
    if (this.webhookDeliveryLog.length > NeuroRuntimeServer.MAX_DELIVERY_LOG) {
      this.webhookDeliveryLog.shift();
    }
  }

  private startBackgroundRun(
    record: ManagedSession,
    operation: string,
    execute: () => Promise<{
      finalState: SessionState;
      outputText?: string;
      steps: Array<{ cycleId: string }>;
    }>
  ): Promise<void> {
    const release = this.beginSessionOperation(record, operation);

    const run = execute()
      .then((result) => {
        record.last_run = summarizeLoopResult(result);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const session = record.handle.getSession();
        record.last_run = {
          final_state: session?.state ?? "failed",
          output_text: message,
          step_count: 0,
          last_cycle_id: session?.current_cycle_id,
          updated_at: new Date().toISOString()
        };
      })
      .finally(() => {
        release();
        if (record.active_run === run) {
          record.active_run = undefined;
        }
      });

    record.active_run = run;
    return run;
  }

  private async runSessionOperation<T>(
    record: ManagedSession,
    operation: string,
    execute: () => Promise<T>
  ): Promise<T> {
    const release = this.beginSessionOperation(record, operation);
    try {
      return await execute();
    } finally {
      release();
    }
  }

  private beginSessionOperation(record: ManagedSession, operation: string): () => void {
    const sessionId = record.handle.id;
    const current = this.activeOperations.get(sessionId);
    if (current) {
      throw new SessionStateConflictError(
        `Session ${sessionId} already has an active ${current} operation.`
      );
    }

    this.activeOperations.set(sessionId, operation);
    return () => {
      if (this.activeOperations.get(sessionId) === operation) {
        this.activeOperations.delete(sessionId);
      }
    };
  }

  private streamSessionEvents(
    request: IncomingMessage,
    response: ServerResponse,
    record: ManagedSession
  ): void {
    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.flushHeaders?.();

    this.sseConnections.add(response);
    const lastEventIdHeader = request.headers["last-event-id"];
    const lastEventId = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;

    for (const event of eventsSinceLastEventId(record.handle.getEvents(), lastEventId)) {
      writeSseEvent(response, event);
    }

    const unsubscribe = record.handle.subscribeToEvents((event) => {
      writeSseEvent(response, event);
    });

    const cleanup = () => {
      unsubscribe();
      this.sseConnections.delete(response);
      if (!response.writableEnded) {
        response.end();
      }
    };

    request.once("close", cleanup);
    request.once("aborted", cleanup);
    response.once("close", cleanup);
  }
}

export function createRuntimeServer(options: RuntimeServerOptions = {}): NeuroRuntimeServer {
  return new NeuroRuntimeServer(options);
}

export function resolveDefaultEvalStoreSqlitePath(serverId = "runtime-server"): string {
  const runtimeDirectory = join(process.cwd(), ".neurocore", "runtime-server");
  mkdirSync(runtimeDirectory, { recursive: true });
  return join(runtimeDirectory, `${sanitizeFileSegment(serverId)}-evals.sqlite`);
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

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function buildRuntimeSaturationReport(
  sessions: Map<string, ManagedSession>,
  activeOperations: Map<string, string>,
  sseConnectionCount: number
) {
  const activeRuns = [...sessions.values()].filter((record) => Boolean(record.active_run)).length;
  const sessionStates: Record<string, number> = {};
  const sessionsPerAgent: Record<string, number> = {};

  for (const record of sessions.values()) {
    const state = record.handle.getSession()?.state ?? "unknown";
    sessionStates[state] = (sessionStates[state] ?? 0) + 1;
    sessionsPerAgent[record.agent_id] = (sessionsPerAgent[record.agent_id] ?? 0) + 1;
  }

  const sessionCount = sessions.size;
  return {
    active_session_count: sessionCount,
    active_run_count: activeRuns,
    active_operation_count: activeOperations.size,
    active_sse_connection_count: sseConnectionCount,
    active_run_ratio: sessionCount > 0 ? activeRuns / sessionCount : 0,
    active_operation_ratio: sessionCount > 0 ? activeOperations.size / sessionCount : 0,
    queue_pressure: Math.max(activeRuns, activeOperations.size, sseConnectionCount),
    sessions_per_agent: sessionsPerAgent,
    session_states: sessionStates,
    active_operations: [...activeOperations.entries()].map(([session_id, operation]) => ({
      session_id,
      operation
    }))
  };
}

function formatPrometheusMetrics(
  snapshot: import("./metrics-store.js").MetricsSnapshot,
  latency: import("./metrics-store.js").LatencyPercentiles
): string {
  const lines = [
    "# HELP neurocore_sessions_created_total Total sessions created.",
    "# TYPE neurocore_sessions_created_total counter",
    `neurocore_sessions_created_total ${snapshot.total_sessions_created}`,
    "# HELP neurocore_cycles_executed_total Total cycles executed.",
    "# TYPE neurocore_cycles_executed_total counter",
    `neurocore_cycles_executed_total ${snapshot.total_cycles_executed}`,
    "# HELP neurocore_active_sessions Current active session count.",
    "# TYPE neurocore_active_sessions gauge",
    `neurocore_active_sessions ${snapshot.active_sessions}`,
    "# HELP neurocore_eval_runs_total Total eval runs.",
    "# TYPE neurocore_eval_runs_total counter",
    `neurocore_eval_runs_total ${snapshot.total_eval_runs}`,
    "# HELP neurocore_errors_total Total observed server errors.",
    "# TYPE neurocore_errors_total counter",
    `neurocore_errors_total ${snapshot.error_count}`,
    "# HELP neurocore_eval_pass_rate Eval pass rate gauge.",
    "# TYPE neurocore_eval_pass_rate gauge",
    `neurocore_eval_pass_rate ${snapshot.eval_pass_rate}`,
    "# HELP neurocore_runtime_uptime_seconds Runtime uptime in seconds.",
    "# TYPE neurocore_runtime_uptime_seconds gauge",
    `neurocore_runtime_uptime_seconds ${snapshot.uptime_seconds}`,
    "# HELP neurocore_sse_connections Current SSE connection count.",
    "# TYPE neurocore_sse_connections gauge",
    `neurocore_sse_connections ${snapshot.active_sse_connections ?? 0}`,
    "# HELP neurocore_cycle_latency_ms Cycle latency percentiles in milliseconds.",
    "# TYPE neurocore_cycle_latency_ms gauge",
    `neurocore_cycle_latency_ms{quantile=\"0.5\"} ${latency.p50}`,
    `neurocore_cycle_latency_ms{quantile=\"0.95\"} ${latency.p95}`,
    `neurocore_cycle_latency_ms{quantile=\"0.99\"} ${latency.p99}`
  ];

  for (const [agentId, percentiles] of Object.entries(latency.by_agent)) {
    lines.push(`neurocore_cycle_latency_ms{agent_id=${JSON.stringify(agentId)},quantile=\"0.5\"} ${percentiles.p50}`);
    lines.push(`neurocore_cycle_latency_ms{agent_id=${JSON.stringify(agentId)},quantile=\"0.95\"} ${percentiles.p95}`);
    lines.push(`neurocore_cycle_latency_ms{agent_id=${JSON.stringify(agentId)},quantile=\"0.99\"} ${percentiles.p99}`);
  }

  return `${lines.join("\n")}\n`;
}

function requireRoutePermission(
  authContext: AuthContext | undefined,
  method: string,
  path: string[]
): void {
  if (!authContext) {
    return;
  }

  const permissions = authContext.permissions ?? [];
  if (permissions.length === 0 || permissions.includes("*") || permissions.includes("admin")) {
    return;
  }

  const required = requiredPermissionsForRoute(method, path);
  if (required.length === 0 || required.some((permission) => permissions.includes(permission))) {
    return;
  }

  throw new HttpError(403, "insufficient_permissions", `Missing required permission: ${required.join(" or ")}`);
}

function requiredPermissionsForRoute(method: string, path: string[]): string[] {
  if (path.length === 0 || path[0] !== "v1") {
    return [];
  }

  if (path[1] === "metrics" || path[1] === "audit-logs" || path[1] === "agents" || path[1] === "sessions" || path[1] === "approvals" || path[1] === "evals") {
    if (method === "GET") {
      return ["read"];
    }
  }

  if (path[1] === "agents" && path[3] === "sessions" && method === "POST") {
    return ["write"];
  }

  if (path[1] === "sessions" && ["POST", "DELETE"].includes(method)) {
    return ["write"];
  }

  if (path[1] === "approvals" && path[3] === "decision" && method === "POST") {
    return ["approve"];
  }

  if (path[1] === "evals" && ["POST", "DELETE"].includes(method)) {
    return ["write"];
  }

  if (path[1] === "policies" || path[1] === "api-keys" || (path[1] === "agents" && path[3] === "profile" && method === "PUT")) {
    return method === "GET" ? ["read"] : ["admin:config"];
  }

  return [];
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

function isBackgroundMode(mode: AgentSession["session_mode"] | undefined): boolean {
  return mode === "async" || mode === "stream";
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

function parsePaginationParams(url: URL): { offset: number; limit?: number } {
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limitParam = url.searchParams.get("limit");
  const limitRaw = limitParam === null ? undefined : Number.parseInt(limitParam, 10);
  return {
    offset: Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0,
    limit: typeof limitRaw === "number" && Number.isFinite(limitRaw) ? Math.max(0, limitRaw) : undefined
  };
}

function paginateItems<T>(items: T[], pagination: { offset: number; limit?: number }) {
  const offset = pagination.offset;
  const limit = pagination.limit ?? items.length;
  const sliced = limit === 0 ? [] : items.slice(offset, offset + limit);
  return {
    items: sliced,
    total: items.length,
    offset,
    limit,
    has_more: offset + sliced.length < items.length
  };
}

function writeJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/plain; charset=utf-8"
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.end(body);
}

function writeSseEvent(response: ServerResponse, event: NeuroCoreEvent): void {
  response.write(`id: ${event.event_id}\n`);
  response.write(`event: ${event.event_type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function eventsSinceLastEventId(events: NeuroCoreEvent[], lastEventId?: string): NeuroCoreEvent[] {
  if (!lastEventId) {
    return events;
  }

  const index = events.findIndex((event) => event.event_id === lastEventId);
  if (index === -1) {
    return events;
  }

  return events.slice(index + 1);
}
