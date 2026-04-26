import { spawn } from "node:child_process";
import type { JsonObject, JsonValue, Tool } from "@neurocore/protocol";

export type McpTransportKind = "http" | "stdio";

export interface PersonalMcpServerConfig {
  id: string;
  transport: McpTransportKind;
  endpoint?: string;
  command?: string;
  args?: string[];
  include_tools?: string[];
  exclude_tools?: string[];
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

export class PersonalMcpClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: PersonalMcpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  public async discoverTools(): Promise<Tool[]> {
    const discovered: Tool[] = [];
    for (const server of this.options.servers) {
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
          untrusted_reason: UNTRUSTED_MCP_REASON
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
        "content-type": "application/json; charset=utf-8"
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function sanitizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}
