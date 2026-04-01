process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

const PORT = parseInt(process.env.PORT ?? "3100", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

const agent = defineAgent({
  id: "console-demo-agent",
  role: "Deterministic agent for console UI testing."
})
  .useReasoner({
    name: "console-demo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Process user input and respond." },
          explanation: "Console demo agent."
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
            title: "Return result",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Echo input",
          tool_name: "echo",
          tool_args: { message: input || "hello from console" },
          side_effect_level: "none"
        }
      ];
    }
  })
  .registerTool({
    name: "echo",
    description: "Returns the provided message.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"]
    },
    async invoke(input) {
      return {
        summary: `echo: ${typeof input.message === "string" ? input.message : "unknown"}`,
        payload: { message: input.message }
      };
    }
  });

const server = createRuntimeServer({
  host: HOST,
  port: PORT,
  agents: [agent]
});

const { url } = await server.listen();
console.log(`[console-backend] Server listening at ${url}`);
console.log("[console-backend] Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  console.log("\n[console-backend] Shutting down...");
  await server.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
