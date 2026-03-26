process.env.NEUROCORE_DEBUG ??= "1";

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineAgent } from "@neurocore/sdk-core";
import { FileRuntimeStateStore } from "@neurocore/runtime-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-recovery] Starting durable runtime recovery demo");

const stateDir = mkdtempSync(join(tmpdir(), "neurocore-runtime-"));
const agent = defineAgent({
  id: "runtime-recovery-demo-agent",
  role: "Deterministic high-risk agent used to verify runtime recovery."
})
  .useReasoner({
    name: "runtime-recovery-demo-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 1,
          confidence: 0.98,
          risk: 1,
          payload: {
            summary: "Request approval for the risky change, then execute and summarize."
          },
          explanation: "Durable runtime recovery path."
        }
      ];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (currentInput.startsWith("Tool observation:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return post-approval summary",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Apply production cleanup",
          description: "High-risk production cleanup action.",
          tool_name: "delete_production_accounts",
          tool_args: {
            tenant: "prod"
          },
          side_effect_level: "high"
        }
      ];
    }
  })
  .useRuntimeStateStore(() => new FileRuntimeStateStore({ directory: stateDir }))
  .registerTool({
    name: "delete_production_accounts",
    description: "Deletes inactive accounts from production.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string" }
      },
      required: ["tenant"]
    },
    async invoke(input) {
      return {
        summary: `deleted inactive accounts from ${typeof input.tenant === "string" ? input.tenant : "unknown"}`,
        payload: {
          tenant: input.tenant
        }
      };
    }
  });

let server = createRuntimeServer({
  agents: [agent]
});

try {
  const firstServer = await server.listen();
  const created = await postJson(`${firstServer.url}/v1/agents/runtime-recovery-demo-agent/sessions`, {
    tenant_id: "local",
    initial_input: {
      content: "Delete all inactive enterprise accounts from production and summarize the result."
    }
  });

  const sessionId = created.session.session_id;
  const approvalId = created.pending_approval?.approval_id;
  if (!approvalId) {
    throw new Error("Expected the first run to stop at a pending approval.");
  }

  await server.close();

  server = createRuntimeServer({
    agents: [agent]
  });
  const secondServer = await server.listen();

  const recovered = await getJson(`${secondServer.url}/v1/sessions/${sessionId}`);
  const approved = await postJson(`${secondServer.url}/v1/approvals/${approvalId}/decision`, {
    approver_id: "durable-runtime-demo",
    decision: "approved",
    comment: "Recovered after server restart."
  });
  const resumed = await postJson(`${secondServer.url}/v1/sessions/${sessionId}/resume`, {});

  console.log(
    JSON.stringify(
      {
        stateDir,
        create: {
          sessionId,
          state: created.session.state,
          pendingApprovalId: approvalId
        },
        recovered: {
          state: recovered.session.state,
          pendingApprovalId: recovered.pending_approval?.approval_id ?? null
        },
        approved: {
          approvalStatus: approved.approval.status,
          sessionState: approved.session.state,
          outputText: approved.last_run?.output_text ?? null
        },
        resumed: {
          finalState: resumed.session.state,
          outputText: resumed.last_run?.output_text ?? null,
          traceCount: resumed.trace_count
        }
      },
      null,
      2
    )
  );
} finally {
  await server.close().catch(() => undefined);
  rmSync(stateDir, { recursive: true, force: true });
}

async function getJson(target) {
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`GET ${target} failed with status ${response.status}`);
  }
  return response.json();
}

async function postJson(target, body) {
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`POST ${target} failed with status ${response.status}`);
  }

  return response.json();
}
