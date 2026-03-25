process.env.NEUROCORE_DEBUG ??= "1";

import { connectRemoteAgent, defineAgent } from "@neurocore/sdk-core";
import { createRuntimeServer } from "@neurocore/runtime-server";

console.log("[demo-runtime-parity] Starting Milestone 4 parity demo");

const command = {
  agent_id: "milestone4-parity-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: "Open a production maintenance window for the database migration and then confirm the result.",
    created_at: new Date().toISOString()
  }
};

const agent = defineAgent({
  id: "milestone4-parity-agent",
  role:
    "Operations agent that must request approval before executing high side-effect production tools, then continue from the resulting tool observation."
})
  .useReasoner({
    name: "milestone4-parity-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.92,
          confidence: 0.96,
          risk: 0.8,
          payload: {
            summary: "Request approval for the production change, execute the tool after approval, then summarize the outcome."
          },
          explanation: "This flow exercises approval gating and post-approval continuation."
        }
      ];
    },
    async respond(ctx) {
      const currentInput =
        typeof ctx.runtime_state.current_input_content === "string"
          ? ctx.runtime_state.current_input_content
          : "";

      if (currentInput.startsWith("Tool observation:")) {
        const summary = currentInput.replace(/^Tool observation:\s*/, "").trim();
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Confirm approved maintenance window",
            description: `Maintenance window confirmed: ${summary}`,
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Create production maintenance window",
          description: "Create an approved production maintenance window for the migration.",
          tool_name: "create_maintenance_window",
          tool_args: {
            tenant: "production",
            changeType: "db_migration",
            durationMinutes: 30
          },
          preconditions: ["Human approval obtained"],
          side_effect_level: "high"
        }
      ];
    }
  })
  .registerTool({
    name: "create_maintenance_window",
    description: "Creates a maintenance window for a production change.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string" },
        changeType: { type: "string" },
        durationMinutes: { type: "number" }
      },
      required: ["tenant", "changeType", "durationMinutes"]
    },
    async invoke(input) {
      return {
        summary: `created maintenance window for ${input.tenant} (${input.changeType}) lasting ${input.durationMinutes} minutes`,
        payload: {
          tenant: input.tenant,
          changeType: input.changeType,
          durationMinutes: input.durationMinutes
        }
      };
    }
  });

const localSession = agent.createSession(command);
const localEscalation = await localSession.run();
const localPendingApproval = localSession.getPendingApproval();
if (!localPendingApproval) {
  throw new Error("Local run did not produce a pending approval request.");
}

const localApproval = await localSession.approve({
  approver_id: "ops-reviewer",
  comment: "Approved for parity demo."
});
const localFinal = await localSession.resume();

const server = createRuntimeServer({
  agents: [agent]
});

const { url } = await server.listen();
console.log("[demo-runtime-parity] Runtime server listening", { url });

try {
  const remoteAgent = connectRemoteAgent({
    agentId: "milestone4-parity-agent",
    baseUrl: url
  });
  const remoteSession = await remoteAgent.createSession(command);

  const remoteEscalation = await remoteSession.run();
  const remotePendingApproval = remoteSession.getPendingApproval();
  if (!remotePendingApproval) {
    throw new Error("Remote run did not produce a pending approval request.");
  }

  const remoteApproval = await remoteSession.approve({
    approver_id: "ops-reviewer",
    comment: "Approved for parity demo."
  });
  const remotePostApprovalState = remoteSession.getSession().state;
  const remoteFinal = await remoteSession.resume();

  const localTraces = localSession.getTraceRecords();
  const remoteTraces = await remoteSession.getTraceRecords();

  console.log(
    JSON.stringify(
      {
        scenario: "milestone4-local-vs-remote",
        local: {
          escalationState: localEscalation.finalState,
          approvalId: localPendingApproval.approval_id,
          approvalStatus: localApproval.approval.status,
          postApprovalState: localApproval.run?.finalState ?? localSession.getSession()?.state ?? null,
          finalState: localFinal.finalState,
          finalOutput: localFinal.outputText ?? null,
          traceCount: localTraces.length,
          episodeCount: localSession.getEpisodes().length
        },
        remote: {
          escalationState: remoteEscalation.session.state,
          approvalId: remotePendingApproval.approval_id,
          approvalStatus: remoteApproval.approval.status,
          postApprovalState: remotePostApprovalState,
          finalState: remoteFinal.session.state,
          finalOutput: remoteFinal.last_run?.output_text ?? null,
          traceCount: remoteTraces.length,
          episodeCount: remoteSession.getEpisodeCount()
        },
        parity: {
          finalStateMatch: localFinal.finalState === remoteFinal.session.state,
          finalOutputMatch: (localFinal.outputText ?? null) === (remoteFinal.last_run?.output_text ?? null),
          traceCountMatch: localTraces.length === remoteTraces.length
        }
      },
      null,
      2
    )
  );
} finally {
  await server.close();
}
