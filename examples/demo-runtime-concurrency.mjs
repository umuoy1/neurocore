process.env.NEUROCORE_DEBUG ??= "1";

import { createRuntimeServer } from "@neurocore/runtime-server";
import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-runtime-concurrency] Starting concurrency protection demo");

const agent = defineAgent({
  id: "runtime-concurrency-demo-agent",
  role: "Deterministic agent used to verify hosted runtime concurrency guards."
})
  .useReasoner({
    name: "runtime-concurrency-demo-reasoner",
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
          risk: 0.9,
          payload: {
            summary: "Require approval for a high-risk tool, then perform a slow follow-up step before responding."
          },
          explanation: "Concurrency protection verification."
        }
      ];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (currentInput.includes("slow_finalize:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return final concurrency result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      if (currentInput.includes("dangerous_echo:")) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Run slow finalize step",
            tool_name: "slow_finalize",
            tool_args: {
              message: "resume path completed",
              delayMs: 250
            },
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Run high-risk approval step",
          description: "High-risk tool requiring approval.",
          tool_name: "dangerous_echo",
          tool_args: {
            message: "approval path completed",
            delayMs: 250
          },
          side_effect_level: "high"
        }
      ];
    }
  })
  .registerTool({
    name: "dangerous_echo",
    description: "Delayed high-risk tool for approval-path verification.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        delayMs: { type: "number" }
      },
      required: ["message", "delayMs"]
    },
    async invoke(input) {
      await delay(typeof input.delayMs === "number" ? input.delayMs : 200);
      return {
        summary: `dangerous_echo: ${typeof input.message === "string" ? input.message : "unknown"}`,
        payload: {
          message: input.message
        }
      };
    }
  })
  .registerTool({
    name: "slow_finalize",
    description: "Delayed low-risk tool for resume-path verification.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        delayMs: { type: "number" }
      },
      required: ["message", "delayMs"]
    },
    async invoke(input) {
      await delay(typeof input.delayMs === "number" ? input.delayMs : 200);
      return {
        summary: `slow_finalize: ${typeof input.message === "string" ? input.message : "unknown"}`,
        payload: {
          message: input.message
        }
      };
    }
  });

const server = createRuntimeServer({
  agents: [agent]
});

const { url } = await server.listen();
console.log("[demo-runtime-concurrency] Runtime server listening", { url });

try {
  const created = await postJson(`${url}/v1/agents/runtime-concurrency-demo-agent/sessions`, {
    tenant_id: "local",
    initial_input: {
      content: "Run the protected high-risk operation and then finish the workflow."
    }
  });

  const sessionId = created.body.session?.session_id;
  const approvalId = created.body.pending_approval?.approval_id;
  if (created.status !== 201 || !sessionId) {
    throw new Error(`Expected session creation to succeed, received status ${created.status}.`);
  }
  if (!approvalId) {
    throw new Error("Expected the initial run to produce a pending approval.");
  }

  const [approvalFirst, approvalSecond] = await Promise.all([
    postJson(`${url}/v1/approvals/${approvalId}/decision`, {
      approver_id: "ops-reviewer",
      decision: "approved",
      comment: "Approve the protected action."
    }),
    postJson(`${url}/v1/approvals/${approvalId}/decision`, {
      approver_id: "ops-reviewer",
      decision: "approved",
      comment: "Approve the protected action."
    })
  ]);

  const [resumeFirst, resumeSecond] = await Promise.all([
    postJson(`${url}/v1/sessions/${sessionId}/resume`, {}),
    postJson(`${url}/v1/sessions/${sessionId}/resume`, {})
  ]);

  assertConflictPair([approvalFirst.status, approvalSecond.status], "approval");
  assertConflictPair([resumeFirst.status, resumeSecond.status], "resume");

  console.log(
    JSON.stringify(
      {
        sessionId,
        approval: {
          statuses: [approvalFirst.status, approvalSecond.status],
          states: [approvalFirst.body.session?.state ?? null, approvalSecond.body.session?.state ?? null],
          errors: [approvalFirst.body.error ?? null, approvalSecond.body.error ?? null]
        },
        resume: {
          statuses: [resumeFirst.status, resumeSecond.status],
          finalStates: [resumeFirst.body.session?.state ?? null, resumeSecond.body.session?.state ?? null],
          errors: [resumeFirst.body.error ?? null, resumeSecond.body.error ?? null]
        }
      },
      null,
      2
    )
  );
} finally {
  await server.close();
}

async function postJson(target, body) {
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertConflictPair(statuses, label) {
  const sorted = [...statuses].sort((left, right) => left - right);
  if (sorted[0] !== 200 || sorted[1] !== 409) {
    throw new Error(`Expected ${label} statuses to be [200, 409], received ${statuses.join(", ")}.`);
  }
}
