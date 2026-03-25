process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";
import {
  loadOpenAICompatibleConfig,
  OpenAICompatibleReasoner
} from "@neurocore/sdk-node";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Payments API latency spiked after today's deploy. Diagnose the likely cause and provide an action plan.";

console.log("[demo-incident] Starting incident diagnosis demo");
console.log("[demo-incident] Prompt:", prompt);
const config = await loadOpenAICompatibleConfig();
const reasoner = new OpenAICompatibleReasoner(config);
console.log("[demo-incident] Loaded model config", {
  model: config.model,
  apiUrl: config.apiUrl,
  timeoutMs: config.timeoutMs ?? 60000
});

const getServiceMetricsTool = {
  name: "get_service_metrics",
  description: "Returns recent service health metrics for a named service.",
  sideEffectLevel: "none",
  inputSchema: {
    type: "object",
    properties: {
      service: { type: "string" }
    },
    required: ["service"]
  },
  async invoke(input) {
    return {
      summary: `payments-api metrics: p95 latency 1840ms, error rate 3.8%, saturation high`,
      payload: {
        tool: "get_service_metrics",
        data: {
          service: input.service,
          p95LatencyMs: 1840,
          errorRate: "3.8%",
          saturation: "high",
          status: "degraded"
        }
      }
    };
  }
};

const getRecentDeployTool = {
  name: "get_recent_deploy",
  description: "Returns the most recent deploy information for a service.",
  sideEffectLevel: "none",
  inputSchema: {
    type: "object",
    properties: {
      service: { type: "string" }
    },
    required: ["service"]
  },
  async invoke(input) {
    return {
      summary: `recent deploy for payments-api: version 2026.03.25-rc4 by liwei 27 minutes ago, risk high`,
      payload: {
        tool: "get_recent_deploy",
        data: {
          service: input.service,
          version: "2026.03.25-rc4",
          author: "liwei",
          minutesAgo: 27,
          riskLevel: "high",
          changedComponents: ["rate-limiter", "db-pool-config"]
        }
      }
    };
  }
};

const getRunbookTool = {
  name: "get_runbook",
  description: "Returns a remediation runbook for a known incident pattern.",
  sideEffectLevel: "none",
  inputSchema: {
    type: "object",
    properties: {
      incidentType: { type: "string" }
    },
    required: ["incidentType"]
  },
  async invoke(input) {
    return {
      summary: `runbook loaded for payments-latency-after-deploy: freeze rollout, verify pool config, rollback if latency remains above 1200ms for 10 minutes`,
      payload: {
        tool: "get_runbook",
        data: {
          incidentType: input.incidentType,
          recommendedActions: [
            "Freeze further rollout immediately",
            "Verify db-pool-config against last known good value",
            "Rollback to previous release if p95 latency stays above 1200ms for 10 minutes",
            "Open an incident bridge and assign app + database owners"
          ]
        }
      }
    };
  }
};

const agent = defineAgent({
  id: "incident-diagnosis-agent",
  role:
    "Incident diagnosis agent for production services. Available tools: get_service_metrics(service) for current health, get_recent_deploy(service) for recent rollout evidence, get_runbook(incidentType) for remediation guidance. Work iteratively in this order when needed: metrics, deploy correlation, runbook, then final diagnosis. Use recalled episodic memory from prior tool calls to decide the next step. After enough evidence is collected, return a concrete diagnosis and action plan."
})
  .useReasoner(reasoner)
  .registerTool(getServiceMetricsTool)
  .registerTool(getRecentDeployTool)
  .registerTool(getRunbookTool);

const session = agent.createSession({
  agent_id: "incident-diagnosis-agent",
  tenant_id: "local",
  initial_input: {
    input_id: `inp_${Date.now()}`,
    content: prompt,
    created_at: new Date().toISOString()
  }
});

console.log("[demo-incident] Created session", { sessionId: session.id });

const result = await session.run();
const lastStep = result.steps.at(-1);

console.log("[demo-incident] Session finished", {
  sessionId: result.sessionId,
  finalState: result.finalState,
  stepCount: result.steps.length
});

console.log(
  JSON.stringify(
    {
      scenario: "incident-diagnosis-closed-loop",
      sessionId: result.sessionId,
      finalState: result.finalState,
      stepCount: result.steps.length,
      outputText: result.outputText,
      lastDecision: lastStep?.cycle.decision ?? null,
      steps: result.steps.map((step, index) => ({
        index: index + 1,
        cycleId: step.cycleId,
        sessionState: step.sessionState,
        selectedAction: step.selectedAction
          ? {
              actionType: step.selectedAction.action_type,
              title: step.selectedAction.title,
              toolName: step.selectedAction.tool_name
            }
          : null,
        observation: step.observation
          ? {
              sourceType: step.observation.source_type,
              summary: step.observation.summary
            }
          : null
      })),
      traces: result.traces.map((trace) => ({
        traceId: trace.trace_id,
        cycleId: trace.cycle_id,
        selectedActionRef: trace.selected_action_ref,
        observationRefs: trace.observation_refs
      }))
    },
    null,
    2
  )
);
