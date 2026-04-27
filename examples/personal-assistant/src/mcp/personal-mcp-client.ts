import { spawn } from "node:child_process";
import type { JsonObject, JsonValue, Tool } from "@neurocore/protocol";

export type McpTransportKind = "http" | "stdio";

export interface PersonalMcpServerConfig {
  id: string;
  transport: McpTransportKind;
  endpoint?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  include_tools?: string[];
  exclude_tools?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  timeout_ms?: number;
}

export interface PersonalMcpClientOptions {
  servers: PersonalMcpServerConfig[];
  fetch?: typeof fetch;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const UNTRUSTED_MCP_REASON = "MCP server output can contain untrusted tool, resource or prompt content.";

type StrictJsonObject = Record<string, JsonValue>;

export type PersonalMcpAuditEventType =
  | "server_registered"
  | "server_updated"
  | "server_enabled"
  | "server_disabled"
  | "tools_refreshed"
  | "tool_enabled"
  | "tool_disabled"
  | "tool_invoked"
  | "tool_blocked";

export interface PersonalMcpAuditEvent {
  audit_id: string;
  event_type: PersonalMcpAuditEventType;
  server_id?: string;
  tool_name?: string;
  actor_id?: string;
  metadata: Record<string, JsonValue>;
  created_at: string;
}

export interface PersonalMcpServerSummary {
  id: string;
  transport: McpTransportKind;
  enabled: boolean;
  endpoint?: string;
  command?: string;
  args?: string[];
  include_tools: string[];
  exclude_tools: string[];
  header_names: string[];
  env_names: string[];
  timeout_ms?: number;
}

export interface PersonalMcpToolState {
  tool_name: string;
  server_id: string;
  enabled: boolean;
  mcp_tool_name: string;
}

export interface PersonalMcpGovernanceRegistryOptions {
  servers: PersonalMcpServerConfig[];
  fetch?: typeof fetch;
  now?: () => string;
  generateId?: (prefix: string) => string;
}

export class PersonalMcpClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: PersonalMcpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  public async discoverTools(): Promise<Tool[]> {
    const discovered: Tool[] = [];
    for (const server of this.options.servers.filter((candidate) => candidate.enabled !== false)) {
      const tools = await this.listServerTools(server);
      for (const tool of tools.filter((candidate) => isToolAllowed(server, candidate.name))) {
        discovered.push(this.toNeuroCoreTool(server, tool));
      }
    }
    return discovered;
  }

  private async listServerTools(server: PersonalMcpServerConfig): Promise<McpToolDescriptor[]> {
    const response = await this.request(server, "tools/list", {});
    const result = asRecord(response.result);
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools
      .filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === "object" && !Array.isArray(tool))
      .map((tool) => ({
        name: typeof tool.name === "string" ? tool.name : "",
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: asRecord(tool.inputSchema) ?? asRecord(tool.input_schema)
      }))
      .filter((tool) => tool.name.length > 0);
  }

  private toNeuroCoreTool(server: PersonalMcpServerConfig, descriptor: McpToolDescriptor): Tool {
    const toolName = `mcp_${sanitizeName(server.id)}_${sanitizeName(descriptor.name)}`;
    return {
      name: toolName,
      description: descriptor.description ?? `MCP tool ${descriptor.name} from ${server.id}`,
      sideEffectLevel: "low",
      inputSchema: descriptor.inputSchema ?? {
        type: "object",
        properties: {}
      },
      outputSchema: {
        type: "object",
        properties: {
          server_id: { type: "string" },
          mcp_tool_name: { type: "string" },
          untrusted_content: { type: "boolean" },
          result: { type: "object" }
        }
      },
      invoke: async (input) => {
        const response = await this.request(server, "tools/call", {
          name: descriptor.name,
          arguments: input
        });
        const result = normalizeMcpResult(response.result);
        const payload: JsonObject = {
          server_id: server.id,
          mcp_tool_name: descriptor.name,
          result,
          resources: normalizeResources(result),
          untrusted_content: true,
          untrusted_reason: UNTRUSTED_MCP_REASON,
          prompt_injection_detected: containsPromptInjection(result)
        };
        return {
          summary: `UNTRUSTED_MCP_CONTENT. MCP tool ${descriptor.name} from ${server.id} returned ${summarizeMcpResult(result)}.`,
          payload
        };
      }
    };
  }

  private async request(server: PersonalMcpServerConfig, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const request = {
      jsonrpc: "2.0",
      id: `${server.id}:${method}:${Date.now()}`,
      method,
      params
    };
    if (server.transport === "http") {
      return this.requestHttp(server, request);
    }
    return this.requestStdio(server, request);
  }

  private async requestHttp(server: PersonalMcpServerConfig, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!server.endpoint) {
      throw new Error(`MCP server ${server.id} requires endpoint for HTTP transport.`);
    }
    const response = await this.fetchImpl(server.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...filterSecretRecord(server.headers ?? {})
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(server.timeout_ms ?? 10_000)
    });
    if (!response.ok) {
      throw new Error(`MCP server ${server.id} HTTP request failed with status ${response.status}.`);
    }
    return await response.json() as Record<string, unknown>;
  }

  private async requestStdio(server: PersonalMcpServerConfig, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!server.command) {
      throw new Error(`MCP server ${server.id} requires command for stdio transport.`);
    }

    return await new Promise((resolve, reject) => {
      const child = spawn(server.command ?? "", server.args ?? [], {
        env: {
          PATH: process.env.PATH ?? "",
          ...filterSecretRecord(server.env ?? {})
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`MCP server ${server.id} stdio request timed out.`));
      }, server.timeout_ms ?? 10_000);

      child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => errorChunks.push(Buffer.from(chunk)));
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`MCP server ${server.id} exited with ${code}: ${Buffer.concat(errorChunks).toString("utf8")}`));
          return;
        }
        try {
          const line = Buffer.concat(chunks).toString("utf8").trim().split(/\r?\n/).filter(Boolean).at(-1);
          resolve(JSON.parse(line ?? "{}") as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}

export class PersonalMcpGovernanceRegistry {
  private readonly servers = new Map<string, PersonalMcpServerConfig>();
  private readonly auditEvents: PersonalMcpAuditEvent[] = [];
  private readonly toolStates = new Map<string, PersonalMcpToolState>();
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => string;
  private readonly generateId: (prefix: string) => string;

  public constructor(options: PersonalMcpGovernanceRegistryOptions) {
    this.fetchImpl = options.fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? ((prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    for (const server of options.servers) {
      this.upsertServer(server, "system");
    }
  }

  public listServers(): PersonalMcpServerSummary[] {
    return [...this.servers.values()].map(summarizeServer);
  }

  public listToolStates(): PersonalMcpToolState[] {
    return [...this.toolStates.values()].map((state) => ({ ...state })).sort((left, right) => left.tool_name.localeCompare(right.tool_name));
  }

  public upsertServer(server: PersonalMcpServerConfig, actorId?: string): PersonalMcpServerSummary {
    const current = this.servers.get(server.id);
    const next: PersonalMcpServerConfig = {
      ...current,
      ...server,
      enabled: server.enabled ?? current?.enabled ?? true,
      include_tools: server.include_tools ?? current?.include_tools,
      exclude_tools: server.exclude_tools ?? current?.exclude_tools,
      headers: server.headers ?? current?.headers,
      env: server.env ?? current?.env
    };
    this.servers.set(server.id, next);
    this.recordAudit(current ? "server_updated" : "server_registered", {
      server_id: server.id,
      actor_id: actorId,
      metadata: toJsonRecord(summarizeServer(next) as unknown as Record<string, unknown>)
    });
    return summarizeServer(next);
  }

  public setServerEnabled(serverId: string, enabled: boolean, actorId?: string): PersonalMcpServerSummary {
    const server = this.requireServer(serverId);
    const next = { ...server, enabled };
    this.servers.set(serverId, next);
    this.recordAudit(enabled ? "server_enabled" : "server_disabled", {
      server_id: serverId,
      actor_id: actorId,
      metadata: { enabled }
    });
    return summarizeServer(next);
  }

  public setToolEnabled(toolName: string, enabled: boolean, actorId?: string): PersonalMcpToolState {
    const current = this.toolStates.get(toolName);
    if (!current) {
      throw new Error(`MCP tool ${toolName} is not known. Refresh tools before changing tool state.`);
    }
    const next = { ...current, enabled };
    this.toolStates.set(toolName, next);
    this.recordAudit(enabled ? "tool_enabled" : "tool_disabled", {
      server_id: next.server_id,
      tool_name: toolName,
      actor_id: actorId,
      metadata: { enabled }
    });
    return { ...next };
  }

  public async refreshTools(actorId?: string): Promise<Tool[]> {
    const activeServers = [...this.servers.values()].filter((server) => server.enabled !== false);
    const client = new PersonalMcpClient({
      servers: activeServers.map((server) => ({ ...server })),
      fetch: this.fetchImpl
    });
    const tools = await client.discoverTools();
    const previous = new Map(this.toolStates);
    const wrapped = tools.map((tool) => {
      const server = activeServers.find((candidate) => tool.name.startsWith(`mcp_${sanitizeName(candidate.id)}_`));
      const serverId = server?.id ?? "unknown";
      const mcpToolName = server ? tool.name.slice(`mcp_${sanitizeName(server.id)}_`.length) : tool.name;
      const existing = previous.get(tool.name);
      const state: PersonalMcpToolState = {
        tool_name: tool.name,
        server_id: serverId,
        enabled: existing?.enabled ?? true,
        mcp_tool_name: mcpToolName
      };
      this.toolStates.set(tool.name, state);
      return this.wrapTool(tool);
    });
    for (const [toolName, state] of previous) {
      if (!tools.some((tool) => tool.name === toolName)) {
        this.toolStates.delete(state.tool_name);
      }
    }
    this.recordAudit("tools_refreshed", {
      actor_id: actorId,
      metadata: {
        server_count: activeServers.length,
        tool_count: wrapped.length,
        tool_names: wrapped.map((tool) => tool.name)
      }
    });
    return wrapped;
  }

  public listAuditEvents(input: { limit?: number; server_id?: string; tool_name?: string } = {}): PersonalMcpAuditEvent[] {
    return this.auditEvents
      .filter((event) => !input.server_id || event.server_id === input.server_id)
      .filter((event) => !input.tool_name || event.tool_name === input.tool_name)
      .slice(-(input.limit ?? 100))
      .map((event) => ({
        ...event,
        metadata: { ...event.metadata }
      }))
      .reverse();
  }

  private wrapTool(tool: Tool): Tool {
    return {
      ...tool,
      invoke: async (input, ctx) => {
        const state = this.toolStates.get(tool.name);
        if (!state || !state.enabled || this.servers.get(state.server_id)?.enabled === false) {
          this.recordAudit("tool_blocked", {
            server_id: state?.server_id,
            tool_name: tool.name,
            metadata: {
              reason: "mcp_tool_disabled"
            }
          });
          throw new Error(`MCP tool ${tool.name} is disabled.`);
        }
        const result = await tool.invoke(input, ctx);
        this.recordAudit("tool_invoked", {
          server_id: state.server_id,
          tool_name: tool.name,
          metadata: {
            untrusted_content: true,
            prompt_injection_detected: result.payload?.prompt_injection_detected === true
          }
        });
        return {
          ...result,
          payload: {
            ...(result.payload ?? {}),
            mcp_governed: true
          }
        };
      }
    };
  }

  private requireServer(serverId: string): PersonalMcpServerConfig {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }
    return server;
  }

  private recordAudit(
    eventType: PersonalMcpAuditEventType,
    input: {
      server_id?: string;
      tool_name?: string;
      actor_id?: string;
      metadata?: Record<string, JsonValue>;
    }
  ): PersonalMcpAuditEvent {
    const event: PersonalMcpAuditEvent = {
      audit_id: this.generateId("mcp_audit"),
      event_type: eventType,
      server_id: input.server_id,
      tool_name: input.tool_name,
      actor_id: input.actor_id,
      metadata: input.metadata ?? {},
      created_at: this.now()
    };
    this.auditEvents.push(event);
    return event;
  }
}

export function createPersonalMcpGovernanceTools(registry: PersonalMcpGovernanceRegistry): Tool[] {
  return [
    {
      name: "mcp_server_list",
      description: "List governed MCP servers with redacted headers and environment names.",
      sideEffectLevel: "none",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return {
          summary: `Listed ${registry.listServers().length} MCP servers.`,
          payload: {
            servers: registry.listServers() as unknown as JsonValue,
            tools: registry.listToolStates() as unknown as JsonValue
          }
        };
      }
    },
    {
      name: "mcp_server_refresh",
      description: "Refresh governed MCP tool discovery using include/exclude and enabled policies.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          actor_id: { type: "string" }
        }
      },
      async invoke(input) {
        const tools = await registry.refreshTools(readOptionalString(input.actor_id));
        return {
          summary: `Refreshed ${tools.length} MCP tools.`,
          payload: {
            tools: registry.listToolStates() as unknown as JsonValue
          }
        };
      }
    },
    {
      name: "mcp_server_enable",
      description: "Enable a governed MCP server.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          server_id: { type: "string" },
          actor_id: { type: "string" }
        },
        required: ["server_id"]
      },
      async invoke(input) {
        const server = registry.setServerEnabled(readRequiredString(input.server_id, "server_id"), true, readOptionalString(input.actor_id));
        return { summary: `MCP server ${server.id} enabled.`, payload: { server: server as unknown as JsonValue } };
      }
    },
    {
      name: "mcp_server_disable",
      description: "Disable a governed MCP server.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          server_id: { type: "string" },
          actor_id: { type: "string" }
        },
        required: ["server_id"]
      },
      async invoke(input) {
        const server = registry.setServerEnabled(readRequiredString(input.server_id, "server_id"), false, readOptionalString(input.actor_id));
        return { summary: `MCP server ${server.id} disabled.`, payload: { server: server as unknown as JsonValue } };
      }
    },
    {
      name: "mcp_tool_enable",
      description: "Enable a governed MCP tool after discovery.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string" },
          actor_id: { type: "string" }
        },
        required: ["tool_name"]
      },
      async invoke(input) {
        const tool = registry.setToolEnabled(readRequiredString(input.tool_name, "tool_name"), true, readOptionalString(input.actor_id));
        return { summary: `MCP tool ${tool.tool_name} enabled.`, payload: { tool: tool as unknown as JsonValue } };
      }
    },
    {
      name: "mcp_tool_disable",
      description: "Disable a governed MCP tool after discovery.",
      sideEffectLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string" },
          actor_id: { type: "string" }
        },
        required: ["tool_name"]
      },
      async invoke(input) {
        const tool = registry.setToolEnabled(readRequiredString(input.tool_name, "tool_name"), false, readOptionalString(input.actor_id));
        return { summary: `MCP tool ${tool.tool_name} disabled.`, payload: { tool: tool as unknown as JsonValue } };
      }
    },
    {
      name: "mcp_audit_list",
      description: "List governed MCP audit events.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          server_id: { type: "string" },
          tool_name: { type: "string" },
          limit: { type: "number" }
        }
      },
      async invoke(input) {
        const events = registry.listAuditEvents({
          server_id: readOptionalString(input.server_id),
          tool_name: readOptionalString(input.tool_name),
          limit: readOptionalNumber(input.limit)
        });
        return { summary: `Listed ${events.length} MCP audit events.`, payload: { events: events as unknown as JsonValue } };
      }
    }
  ];
}

function isToolAllowed(server: PersonalMcpServerConfig, toolName: string): boolean {
  const included = !server.include_tools || server.include_tools.length === 0 || server.include_tools.includes(toolName);
  const excluded = server.exclude_tools?.includes(toolName) ?? false;
  return included && !excluded;
}

function normalizeMcpResult(value: unknown): StrictJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: normalizeJson(value) };
  }
  return normalizeJsonObject(value as Record<string, unknown>);
}

function normalizeResources(result: StrictJsonObject): JsonValue[] {
  const resources = result.resources;
  if (!Array.isArray(resources)) {
    return [];
  }
  return resources.map((resource) => {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
      const normalized: StrictJsonObject = {
        value: normalizeJson(resource),
        trust: "untrusted"
      };
      return normalized;
    }
    const normalized: StrictJsonObject = {
      ...normalizeJsonObject(resource as Record<string, unknown>),
      trust: "untrusted"
    };
    return normalized;
  });
}

function summarizeMcpResult(result: StrictJsonObject): string {
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) => typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>).text : item)
      .filter((item): item is string => typeof item === "string")
      .join(" ");
    if (text) {
      return text.slice(0, 240);
    }
  }
  return JSON.stringify(result).slice(0, 240);
}

function normalizeJson(value: unknown): JsonValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === "object") {
    return normalizeJsonObject(value as Record<string, unknown>);
  }
  return null;
}

function normalizeJsonObject(value: Record<string, unknown>): StrictJsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeJson(item)]));
}

function summarizeServer(server: PersonalMcpServerConfig): PersonalMcpServerSummary {
  return {
    id: server.id,
    transport: server.transport,
    enabled: server.enabled !== false,
    endpoint: server.endpoint,
    command: server.command,
    args: server.args,
    include_tools: server.include_tools ?? [],
    exclude_tools: server.exclude_tools ?? [],
    header_names: Object.keys(server.headers ?? {}).filter((key) => !isSecretKey(key)).sort(),
    env_names: Object.keys(server.env ?? {}).filter((key) => !isSecretKey(key)).sort(),
    timeout_ms: server.timeout_ms
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function sanitizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function filterSecretRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isSecretKey(key)));
}

function isSecretKey(key: string): boolean {
  return /authorization|api[_-]?key|token|secret|password|bearer/i.test(key);
}

function containsPromptInjection(value: JsonValue): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return /ignore (all )?(previous|prior) instructions|reveal (the )?(system|developer) prompt|act as system/.test(serialized);
}

function toJsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  return normalizeJsonObject(value);
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
