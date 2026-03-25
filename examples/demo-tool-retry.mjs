process.env.NEUROCORE_DEBUG ??= "1";

import { defineAgent } from "@neurocore/sdk-core";

console.log("[demo-tool-retry] Starting tool retry / timeout recovery demo");

const retryRecovery = await runRetryRecoveryScenario();
const timeoutFallback = await runTimeoutFallbackScenario();

console.log(
  JSON.stringify(
    {
      scenarios: [retryRecovery, timeoutFallback]
    },
    null,
    2
  )
);

async function runRetryRecoveryScenario() {
  const agent = defineAgent({
    id: "tool-retry-recovery-agent",
    role: "Demonstrates internal retry success before the next reasoning cycle."
  })
    .configureRuntime({
      max_cycles: 4,
      tool_execution: {
        max_retries: 1,
        retry_backoff_ms: 10
      }
    })
    .useReasoner(createRetryRecoveryReasoner())
    .registerTool({
      name: "flaky_echo",
      description: "Fails once, then succeeds on retry.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" }
        },
        required: ["message"]
      },
      execution: {
        max_retries: 1,
        retry_backoff_ms: 10
      },
      async invoke(input, ctx) {
        if ((ctx.attempt ?? 1) < 2) {
          throw new Error("Transient upstream error on first attempt.");
        }

        return {
          summary: `flaky_echo recovered: ${typeof input.message === "string" ? input.message : "unknown"}`,
          payload: {
            message: input.message
          }
        };
      }
    });

  const session = agent.createSession({
    agent_id: "tool-retry-recovery-agent",
    tenant_id: "local",
    initial_input: {
      input_id: `inp_${Date.now()}_retry`,
      content: "Call flaky_echo and finish when it succeeds.",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  const records = session.getTraceRecords();

  console.log("[demo-tool-retry] Retry recovery scenario finished", {
    sessionId: result.sessionId,
    finalState: result.finalState,
    outputText: result.outputText
  });

  return {
    name: "retry_recovery",
    sessionId: result.sessionId,
    finalState: result.finalState,
    outputText: result.outputText,
    steps: summarizeTraceRecords(records)
  };
}

async function runTimeoutFallbackScenario() {
  const agent = defineAgent({
    id: "tool-timeout-fallback-agent",
    role: "Demonstrates timeout, retry exhaustion, and fallback tool recovery."
  })
    .configureRuntime({
      max_cycles: 6,
      tool_execution: {
        timeout_ms: 40,
        max_retries: 1,
        retry_backoff_ms: 10,
        retry_on_timeout: true
      }
    })
    .useReasoner(createTimeoutFallbackReasoner())
    .registerTool({
      name: "primary_lookup",
      description: "Slow primary lookup that always times out in the demo.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" }
        },
        required: ["customerId"]
      },
      execution: {
        timeout_ms: 40,
        max_retries: 1,
        retry_backoff_ms: 10,
        retry_on_timeout: true
      },
      async invoke(input, ctx) {
        await abortableSleep(120, ctx.signal);
        return {
          summary: `primary_lookup: ${typeof input.customerId === "string" ? input.customerId : "unknown"}`,
          payload: {
            customerId: input.customerId,
            source: "primary"
          }
        };
      }
    })
    .registerTool({
      name: "cached_lookup",
      description: "Fast cached fallback lookup.",
      sideEffectLevel: "none",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" }
        },
        required: ["customerId"]
      },
      async invoke(input) {
        return {
          summary: `cached_lookup fallback: customer ${typeof input.customerId === "string" ? input.customerId : "unknown"} is active, plan=enterprise`,
          payload: {
            customerId: input.customerId,
            source: "cache",
            plan: "enterprise",
            status: "active"
          }
        };
      }
    });

  const session = agent.createSession({
    agent_id: "tool-timeout-fallback-agent",
    tenant_id: "local",
    initial_input: {
      input_id: `inp_${Date.now()}_fallback`,
      content: "Resolve customer c_1024 using the primary lookup, but recover if it fails.",
      created_at: new Date().toISOString()
    }
  });

  const result = await session.run();
  const records = session.getTraceRecords();

  console.log("[demo-tool-retry] Timeout fallback scenario finished", {
    sessionId: result.sessionId,
    finalState: result.finalState,
    outputText: result.outputText
  });

  return {
    name: "timeout_fallback",
    sessionId: result.sessionId,
    finalState: result.finalState,
    outputText: result.outputText,
    steps: summarizeTraceRecords(records)
  };
}

function createRetryRecoveryReasoner() {
  return {
    name: "tool-retry-recovery-reasoner",
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
          confidence: 0.95,
          risk: 0,
          payload: {
            summary: "Call flaky_echo. ToolGateway should retry once and recover inside the same action."
          },
          explanation: "Validates retry path without forcing a second tool call."
        }
      ];
    },
    async respond(ctx) {
      const currentInput = getCurrentInput(ctx);
      const metadata = getCurrentInputMetadata(ctx);

      if (
        metadata.sourceObservationStatus === "success" &&
        metadata.sourceToolName === "flaky_echo" &&
        currentInput.startsWith("Tool observation:")
      ) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Summarize retry recovery",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call flaky echo",
          description: "Use the flaky tool and rely on runtime retry.",
          tool_name: "flaky_echo",
          tool_args: {
            message: "retry path validated"
          },
          side_effect_level: "none"
        }
      ];
    }
  };
}

function createTimeoutFallbackReasoner() {
  return {
    name: "tool-timeout-fallback-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.95,
          confidence: 0.9,
          risk: 0.1,
          payload: {
            summary:
              "Attempt primary lookup first. If timeout persists after retries, fall back to cached_lookup and complete."
          },
          explanation: "Validates timeout -> retry -> failure observation -> fallback tool -> final response."
        }
      ];
    },
    async respond(ctx) {
      const currentInput = getCurrentInput(ctx);
      const metadata = getCurrentInputMetadata(ctx);

      if (
        metadata.sourceObservationStatus === "failure" &&
        metadata.sourceToolName === "primary_lookup"
      ) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "call_tool",
            title: "Use cached fallback lookup",
            description: "Primary lookup timed out. Use cached data to complete the task.",
            tool_name: "cached_lookup",
            tool_args: {
              customerId: "c_1024"
            },
            side_effect_level: "none"
          }
        ];
      }

      if (
        metadata.sourceObservationStatus === "success" &&
        metadata.sourceToolName === "cached_lookup" &&
        currentInput.startsWith("Tool observation:")
      ) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return fallback result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      if (
        metadata.sourceObservationStatus === "success" &&
        metadata.sourceToolName === "primary_lookup" &&
        currentInput.startsWith("Tool observation:")
      ) {
        return [
          {
            action_id: ctx.services.generateId("act"),
            action_type: "respond",
            title: "Return primary result",
            description: currentInput.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Call primary lookup",
          description: "Start with the primary lookup path.",
          tool_name: "primary_lookup",
          tool_args: {
            customerId: "c_1024"
          },
          side_effect_level: "none"
        }
      ];
    }
  };
}

function summarizeTraceRecords(records) {
  return records.map((record, index) => ({
    index: index + 1,
    cycleId: record.trace.cycle_id,
    selectedAction: record.selected_action
      ? {
          actionType: record.selected_action.action_type,
          title: record.selected_action.title,
          toolName: record.selected_action.tool_name ?? null
        }
      : null,
    actionExecution: record.action_execution
      ? {
          status: record.action_execution.status,
          attemptCount: record.action_execution.metrics?.attempt_count ?? null,
          retryCount: record.action_execution.metrics?.retry_count ?? null,
          timeoutMs: record.action_execution.metrics?.timeout_ms ?? null,
          errorRef: record.action_execution.error_ref ?? null
        }
      : null,
    observation: record.observation
      ? {
          status: record.observation.status,
          summary: record.observation.summary
        }
      : null
  }));
}

function getCurrentInput(ctx) {
  return typeof ctx.runtime_state.current_input_content === "string"
    ? ctx.runtime_state.current_input_content
    : "";
}

function getCurrentInputMetadata(ctx) {
  const value = ctx.runtime_state.current_input_metadata;
  if (!value || typeof value !== "object") {
    return {};
  }

  return value;
}

async function abortableSleep(ms, signal) {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Aborted by tool signal."));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
