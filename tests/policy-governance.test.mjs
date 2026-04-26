import assert from "node:assert/strict";
import test from "node:test";
import { ToolGateway } from "@neurocore/runtime-core";
import { defineAgent } from "@neurocore/sdk-core";

function ts() {
  return new Date().toISOString();
}

test("approval policy resolves allowed approvers by tenant and risk precedence", async () => {
  const agent = defineAgent({
    id: "approval-precedence-agent",
    role: "Approval precedence test agent."
  })
    .useReasoner({
      name: "approval-precedence-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Call risky tool." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Run risky op",
          tool_name: "risky_op",
          tool_args: {},
          side_effect_level: "high"
        }];
      },
      async *streamText() {
        yield "done";
      }
    })
    .registerTool({
      name: "risky_op",
      description: "A risky operation.",
      sideEffectLevel: "high",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "done", payload: {} };
      }
    });

  agent.configureApprovalPolicy({
    allowed_approvers: ["global-approver"],
    allowed_approvers_by_tenant: {
      "tenant-a": ["tenant-approver"]
    },
    allowed_approvers_by_risk: {
      high: ["risk-approver"]
    },
    allowed_approvers_by_tenant_and_risk: {
      "tenant-a": {
        high: ["tenant-risk-approver"]
      }
    }
  });

  const session = agent.createSession({
    tenant_id: "tenant-a",
    initial_input: { content: "run risky op", created_at: ts() }
  });
  await session.run();
  const approval = session.getPendingApproval();
  assert.ok(approval);

  await assert.rejects(
    () => session.approve({ approver_id: "tenant-approver" }),
    /allowed approvers list/i
  );

  const approved = await session.approve({ approver_id: "tenant-risk-approver" });
  assert.equal(approved.approval.status, "approved");
});

test("configurePolicy can require approval by tenant and risk level", async () => {
  const agent = defineAgent({
    id: "tenant-risk-policy-agent",
    role: "Tenant and risk policy test agent."
  })
    .useReasoner({
      name: "tenant-risk-policy-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Call low-side-effect tool." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Run notify",
          tool_name: "notify",
          tool_args: {},
          side_effect_level: "low"
        }];
      },
      async *streamText() {
        yield "done";
      }
    })
    .registerTool({
      name: "notify",
      description: "A low side-effect tool.",
      sideEffectLevel: "low",
      inputSchema: { type: "object", properties: {} },
      async invoke() {
        return { summary: "notified", payload: {} };
      }
    })
    .configurePolicy({
      tenantPolicies: {
        "tenant-strict": {
          requiredApprovalRiskLevels: ["low"]
        }
      }
    });

  const strictSession = agent.createSession({
    tenant_id: "tenant-strict",
    initial_input: { content: "run notify", created_at: ts() }
  });
  const strictResult = await strictSession.runOnce();
  assert.equal(strictResult.sessionState, "escalated");
  assert.ok(strictSession.getPendingApproval());

  const normalSession = agent.createSession({
    tenant_id: "tenant-normal",
    initial_input: { content: "run notify", created_at: ts() }
  });
  const normalResult = await normalSession.runOnce();
  assert.equal(normalResult.sessionState, "waiting");
  assert.equal(normalResult.actionExecution?.status, "succeeded");
  assert.equal(normalSession.getPendingApproval(), undefined);
});

test("default policy requires approval for shell messaging and webhook tool names", async () => {
  for (const toolName of ["shell", "send_message", "webhook_post"]) {
    const agent = defineAgent({
      id: `default-risk-${toolName.replace(/_/g, "-")}`,
      role: "Default high-risk tool policy test agent."
    })
      .useReasoner(createToolCallReasoner(toolName))
      .registerTool({
        name: toolName,
        description: `${toolName} test tool.`,
        sideEffectLevel: "low",
        inputSchema: { type: "object", properties: {} },
        async invoke() {
          return { summary: "should not execute without approval", payload: {} };
        }
      })
      .configurePolicy({});

    const session = agent.createSession({
      tenant_id: "tenant-default-risk",
      initial_input: { content: `run ${toolName}`, created_at: ts() }
    });
    const result = await session.runOnce();
    const approval = session.getPendingApproval();

    assert.equal(result.sessionState, "escalated", `${toolName} should escalate`);
    assert.ok(approval, `${toolName} should create a pending approval`);
    assert.equal(approval.action.tool_name, toolName);
    assert.match(approval.review_reason ?? "", /requires human approval|approval/i);
  }
});

test("ToolGateway enforces per-tenant and per-tool rate limits", async () => {
  const gateway = new ToolGateway();
  gateway.register({
    name: "echo",
    description: "Echo tool",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" }
      },
      required: ["message"]
    },
    async invoke(input) {
      return { summary: String(input.message), payload: { message: input.message } };
    }
  });

  const action = {
    action_id: "act_echo",
    action_type: "call_tool",
    title: "Echo",
    tool_name: "echo",
    tool_args: { message: "hello" },
    side_effect_level: "none"
  };

  const options = {
    defaultExecution: {
      rate_limits: {
        per_tenant: { window_ms: 60_000, max_calls: 2 },
        per_tool: {
          echo: { window_ms: 60_000, max_calls: 3 }
        }
      }
    }
  };

  const first = await gateway.execute(action, {
    tenant_id: "tenant-1",
    session_id: "ses_1",
    cycle_id: "cyc_1"
  }, options);
  const second = await gateway.execute(action, {
    tenant_id: "tenant-1",
    session_id: "ses_1",
    cycle_id: "cyc_2"
  }, options);
  const third = await gateway.execute(action, {
    tenant_id: "tenant-1",
    session_id: "ses_1",
    cycle_id: "cyc_3"
  }, options);
  const fourth = await gateway.execute(action, {
    tenant_id: "tenant-2",
    session_id: "ses_2",
    cycle_id: "cyc_4"
  }, options);
  const fifth = await gateway.execute(action, {
    tenant_id: "tenant-3",
    session_id: "ses_3",
    cycle_id: "cyc_5"
  }, options);

  assert.equal(first.execution.status, "succeeded");
  assert.equal(second.execution.status, "succeeded");
  assert.equal(third.execution.status, "failed");
  assert.match(third.observation.summary, /rate limit exceeded/i);
  assert.equal(fourth.execution.status, "succeeded");
  assert.equal(fifth.execution.status, "failed");
  assert.match(fifth.observation.summary, /rate limit exceeded/i);
});

function createToolCallReasoner(toolName) {
  return {
    name: `${toolName}-reasoner`,
    async plan(ctx) {
      return [{
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
        module_name: this.name,
        proposal_type: "plan",
        salience_score: 0.9,
        confidence: 0.95,
        risk: 0,
        payload: { summary: `Call ${toolName}.` }
      }];
    },
    async respond(ctx) {
      return [{
        action_id: ctx.services.generateId("act"),
        action_type: "call_tool",
        title: `Run ${toolName}`,
        tool_name: toolName,
        tool_args: {},
        side_effect_level: "low"
      }];
    },
    async *streamText() {
      yield "done";
    }
  };
}

test("policy provider can block input before reasoner execution", async () => {
  let respondCalls = 0;
  const agent = defineAgent({
    id: "input-filter-agent",
    role: "Input filter test agent."
  })
    .useReasoner({
      name: "input-filter-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          payload: { summary: "Respond normally." }
        }];
      },
      async respond(ctx) {
        respondCalls += 1;
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: "should not run",
          side_effect_level: "none"
        }];
      },
      async *streamText() {
        yield "blocked";
      }
    })
    .registerPolicyProvider({
      name: "input-screen",
      async evaluateInput(_ctx, input) {
        if (typeof input.content === "string" && input.content.includes("blocked phrase")) {
          return [{
            decision_id: "pol_input_block",
            policy_name: "input-screen",
            level: "block",
            severity: 30,
            target_type: "input",
            reason: "Blocked phrase detected."
          }];
        }
        return [];
      },
      async evaluateAction() {
        return [];
      }
    });

  const session = agent.createSession({
    tenant_id: "tenant-input-filter",
    initial_input: { content: "blocked phrase", created_at: ts() }
  });
  const result = await session.run();

  assert.equal(result.finalState, "aborted");
  assert.equal(respondCalls, 0);
});

test("policy provider can replace blocked output with safe response", async () => {
  const agent = defineAgent({
    id: "output-filter-agent",
    role: "Output filter test agent."
  })
    .useReasoner({
      name: "output-filter-reasoner",
      async plan(ctx) {
        return [{
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: this.name,
          proposal_type: "plan",
          salience_score: 0.8,
          payload: { summary: "Respond with filtered content." }
        }];
      },
      async respond(ctx) {
        return [{
          action_id: ctx.services.generateId("act"),
          action_type: "respond",
          title: "Respond",
          description: "unsafe content",
          side_effect_level: "none"
        }];
      },
      async *streamText() {
        yield "unsafe ";
        yield "content";
      }
    })
    .registerPolicyProvider({
      name: "output-screen",
      async evaluateAction() {
        return [];
      },
      async evaluateOutput(_ctx, output) {
        if (output.text.includes("unsafe")) {
          return [{
            decision_id: "pol_output_block",
            policy_name: "output-screen",
            level: "block",
            severity: 30,
            target_type: "output",
            reason: "Unsafe output detected.",
            recommendation: "I can't provide that response."
          }];
        }
        return [];
      }
    });

  const session = agent.createSession({
    tenant_id: "tenant-output-filter",
    initial_input: { content: "say the unsafe thing", created_at: ts() }
  });
  const result = await session.run();

  assert.equal(result.finalState, "completed");
  assert.equal(result.outputText, "I can't provide that response.");
  const outputEvents = session.getEvents().filter((event) => event.event_type === "runtime.output");
  assert.equal(outputEvents.at(-1)?.payload.mode, "buffered");
});
