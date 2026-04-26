import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";
import { PersonalMcpClient } from "../examples/personal-assistant/dist/mcp/personal-mcp-client.js";

test("HTTP MCP discovery registers filtered tools into the personal assistant ToolGateway", { concurrency: false }, async () => {
  const fetchCalls = [];
  const client = new PersonalMcpClient({
    servers: [{
      id: "http",
      transport: "http",
      endpoint: "https://mcp.test/rpc",
      include_tools: ["search"],
      exclude_tools: ["blocked"]
    }],
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      fetchCalls.push(request);
      if (request.method === "tools/list") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [
              {
                name: "search",
                description: "Search remote MCP data.",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: { type: "string" }
                  }
                }
              },
              {
                name: "blocked",
                description: "Blocked tool."
              }
            ]
          }
        });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: `MCP result for ${request.params.arguments.query}`
            }
          ],
          resources: [
            {
              uri: "mcp://http/resource-1",
              text: "resource content"
            }
          ]
        }
      });
    }
  });
  const mcpTools = await client.discoverTools();
  assert.deepEqual(mcpTools.map((tool) => tool.name), ["mcp_http_search"]);

  const agent = createPersonalAssistantAgent({
    db_path: join(mkdtempSync(join(tmpdir(), "neurocore-pa-mcp-agent-")), "assistant.sqlite"),
    tenant_id: "test-tenant",
    reasoner: createMcpReasoner("mcp_http_search")
  }, {
    mcpTools
  });
  const session = agent.createSession({
    agent_id: "personal-assistant",
    tenant_id: "test-tenant",
    initial_input: {
      content: "neurocore"
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.match(result.outputText ?? "", /UNTRUSTED_MCP_CONTENT/);
  assert.match(result.outputText ?? "", /MCP result for neurocore/);

  const trace = session.getTraceRecords().find((record) =>
    record.selected_action?.tool_name === "mcp_http_search" &&
    record.observation?.status === "success"
  );
  assert.ok(trace);
  assert.equal(trace.observation.structured_payload.server_id, "http");
  assert.equal(trace.observation.structured_payload.mcp_tool_name, "search");
  assert.equal(trace.observation.structured_payload.untrusted_content, true);
  assert.equal(trace.observation.structured_payload.resources[0].trust, "untrusted");
  assert.equal(fetchCalls[0].method, "tools/list");
  assert.equal(fetchCalls[1].method, "tools/call");
});

test("stdio MCP discovery and calls produce untrusted tool results", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neurocore-pa-mcp-stdio-"));
  try {
    const serverPath = join(tempDir, "server.mjs");
    writeFileSync(serverPath, `
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(raw.trim());
  if (request.method === "tools/list") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "echo", description: "Echo input." }] } }));
    return;
  }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "echo:" + request.params.arguments.text }], resources: [{ uri: "mcp://stdio/resource" }] } }));
});
`);
    const client = new PersonalMcpClient({
      servers: [{
        id: "stdio",
        transport: "stdio",
        command: process.execPath,
        args: [serverPath]
      }]
    });
    const tools = await client.discoverTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "mcp_stdio_echo");

    const result = await tools[0].invoke({ text: "hello" }, {
      tenant_id: "test-tenant",
      session_id: "session",
      cycle_id: "cycle"
    });
    assert.match(result.summary, /UNTRUSTED_MCP_CONTENT/);
    assert.match(result.summary, /echo:hello/);
    assert.equal(result.payload?.untrusted_content, true);
    assert.equal(result.payload?.resources[0].trust, "untrusted");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createMcpReasoner(toolName) {
  return {
    name: "mcp-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "mcp-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0.1,
          payload: { summary: "Call MCP tool." }
        }
      ];
    },
    async respond(ctx) {
      const input = typeof ctx.runtime_state.current_input_content === "string"
        ? ctx.runtime_state.current_input_content
        : "";

      if (input.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return MCP result",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call MCP search",
          tool_name: toolName,
          tool_args: {
            query: input
          },
          side_effect_level: "low"
        }
      ];
    },
    async *streamText(_ctx, action) {
      yield action.description ?? action.title;
    }
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
