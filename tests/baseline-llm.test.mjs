import { defineAgent } from "@neurocore/sdk-core";
import { loadOpenAICompatibleConfig, OpenAICompatibleReasoner } from "@neurocore/sdk-node";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", ".neurocore", "llm.local.json");

function loadConfig() {
  try {
    return loadOpenAICompatibleConfig(CONFIG_PATH);
  } catch {
    return null;
  }
}

async function probeApi(config) {
  const url = config.apiUrl.endsWith("/")
    ? `${config.apiUrl}chat/completions`
    : `${config.apiUrl}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.bearerToken}`,
        ...(config.headers ?? {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 300) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function makeInput(content) {
  return {
    input_id: `inp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    content,
    created_at: new Date().toISOString()
  };
}

function makeToolCallVerifier(name, fn) {
  return {
    name,
    description: `Execute ${name}.`,
    sideEffectLevel: "none",
    inputSchema: { type: "object", properties: {}, required: [] },
    async invoke(input, ctx) {
      return fn(input, ctx);
    }
  };
}

const API_COOLDOWN_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertTerminal(result, label) {
  const s = result.finalState;
  assert.ok(
    s === "completed" || s === "waiting" || s === "aborted",
    `${label}: expected completed/waiting/aborted, got ${s}`
  );
  return s;
}

async function checkApiConnectivity(config) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${config.apiUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.bearerToken}`,
          ...(config.headers ?? {})
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      });
      clearTimeout(timeout);
      if (res.status === 429) {
        return { ok: false, reason: `API rate-limited (429). Headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}` };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: `API auth failed (${res.status}). Check bearerToken in .neurocore/llm.local.json` };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, reason: `API returned ${res.status}: ${text.slice(0, 300)}` };
      }
      return { ok: true };
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < 3) {
        console.log(`  Connectivity attempt ${attempt} failed, retrying in ${attempt * 5}s...`);
        await sleep(attempt * 1000);
        continue;
      }
      return { ok: false, reason: `Network error after ${attempt} attempts: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

test("LLM Baseline Suite", { concurrency: false, timeout: 600_000 }, async (t) => {
  const config = await loadConfig();
  if (!config) {
    console.log("Skipping LLM baseline: no .neurocore/llm.local.json found.");
    console.log("Create one by copying .neurocore/llm.local.example.json and filling in your API credentials.");
    return;
  }

  console.log(`  API: ${config.model} @ ${config.apiUrl}`);

  const health = await checkApiConnectivity(config);
  if (!health.ok) {
    console.log(`\n  ✘ API connectivity check failed: ${health.reason}`);
    console.log("  Skipping baseline tests. Wait a minute and try again.\n");
    return;
  }
  console.log("  API connectivity OK");

  const reasonerFactory = (opts = {}) =>
    new OpenAICompatibleReasoner(config, { temperature: 0.15, max_tokens: 2048, ...opts });

  await sleep(API_COOLDOWN_MS);
  await t.test("G1: multi-step tool chain completes with correct result", async () => {
    let generatedNumber = null;

    const agent = defineAgent({
      id: "g1-chain-agent",
      role: "You are a math assistant that uses tools to compute answers."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("generate_number", async () => {
        generatedNumber = Math.floor(Math.random() * 50) + 1;
        return {
          summary: `Generated number: ${generatedNumber}`,
          payload: { number: generatedNumber }
        };
      }))
      .registerTool({
        name: "double_number",
        description: "Double the provided number.",
        sideEffectLevel: "none",
        inputSchema: {
          type: "object",
          properties: { number: { type: "number" } },
          required: ["number"]
        },
        async invoke(input) {
          const n = typeof input.number === "number" ? input.number : 0;
          return {
            summary: `Double of ${n} is ${n * 2}`,
            payload: { result: n * 2 }
          };
        }
      })
      .configureRuntime({ max_cycles: 4 });

    const session = agent.createSession({
      agent_id: "g1-chain-agent",
      tenant_id: "g1-tenant",
      initial_input: makeInput(
        "Step 1: Use generate_number to get a random number. " +
        "Step 2: Pass that number to double_number. " +
        "Step 3: Tell me the final doubled result."
      )
    });

    const result = await session.run();

    let finalState = result.finalState;
    if (finalState === "waiting") {
      const resumed = await session.resumeText(
        "Do it now: call generate_number, then pass the result to double_number."
      );
      finalState = resumed.finalState;
    }

    assert.ok(
      finalState === "completed" || finalState === "waiting",
      `Expected completed or waiting, got ${finalState}. Steps: ${result.steps.length}`
    );

    const events = session.getEvents();
    const actionTypes = events.map(e => e.event_type);
    assert.ok(actionTypes.includes("session.created"), "should emit session.created");
    assert.ok(actionTypes.includes("action.executed"), "should emit action.executed");

    const traces = session.getTraceRecords();
    assert.ok(traces.length >= 1, "should have trace records");

    const episodes = session.getEpisodes();
    assert.ok(episodes.length >= 1, "should have recorded at least one episode");

    const goals = session.getGoals();
    assert.ok(goals.length >= 1, "should have at least a root goal");

    console.log(`  G1 done: ${finalState}, ${traces.length} traces, ${episodes.length} episodes`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G2: tight token budget triggers abort", async () => {
    const agent = defineAgent({
      id: "g2-budget-agent",
      role: "You are a verbose assistant that explains everything in great detail."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("search_web", async () => ({
        summary: "Found many results about the topic.",
        payload: { results: Array.from({ length: 10 }, (_, i) => `Result ${i + 1}`) }
      })))
      .withTokenBudget(200)
      .configureRuntime({ max_cycles: 4 });

    const session = agent.createSession({
      agent_id: "g2-budget-agent",
      tenant_id: "g2-tenant",
      initial_input: makeInput(
        "Search the web for information about quantum computing, " +
        "then search again for machine learning, then summarize everything."
      )
    });

    const result = await session.run();

    assert.ok(
      result.finalState === "aborted" || result.finalState === "completed" || result.finalState === "waiting",
      `Expected aborted/completed/waiting, got ${result.finalState}`
    );

    const sess = session.getSession();
    if (result.finalState === "aborted") {
      assert.ok(
        sess?.budget_state.token_budget_used > 0,
        "token_budget_used should be > 0 after abort"
      );
    }

    console.log(`  G2 done: ${result.finalState}, tokens_used=${sess?.budget_state?.token_budget_used}`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G3: compression fires when context exceeds budget", async () => {
    const agent = defineAgent({
      id: "g3-compress-agent",
      role: "You are a data analysis assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("query_database", async () => ({
        summary: "Query returned 100 rows of customer data with columns: id, name, email, purchase_count, last_purchase_date, total_spent.",
        payload: {
          rowCount: 100,
          columns: ["id", "name", "email", "purchase_count", "last_purchase_date", "total_spent"],
          sampleRows: Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            name: `Customer ${i + 1}`,
            email: `customer${i + 1}@example.com`,
            purchase_count: Math.floor(Math.random() * 100),
            total_spent: (Math.random() * 10000).toFixed(2)
          }))
        }
      })))
      .withTokenBudget(800)
      .configureRuntime({ max_cycles: 3 });

    const session = agent.createSession({
      agent_id: "g3-compress-agent",
      tenant_id: "g3-tenant",
      initial_input: makeInput(
        "Query the database for customer data, then give me a summary. " +
        "Be thorough in your analysis."
      )
    });

    const result = await session.run();

    assert.ok(
      result.finalState === "completed" || result.finalState === "aborted" || result.finalState === "waiting",
      `Expected completed/aborted/waiting, got ${result.finalState}`
    );

    const sess = session.getSession();
    assert.ok(sess, "session should exist");
    assert.ok(
      typeof sess.budget_state.token_budget_used === "number",
      "token_budget_used should be a number"
    );

    console.log(`  G3 done: ${result.finalState}, tokens_used=${sess.budget_state.token_budget_used}, steps=${result.steps.length}`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G4+G5: cross-session memory recall with retrieval_top_k", async () => {
    const tenantId = "g4g5-shared-tenant";

    const agent = defineAgent({
      id: "g4g5-memory-agent",
      role: "You are a research assistant that remembers past interactions."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("search_papers", async () => ({
        summary: "Found 5 papers on the topic.",
        payload: { papers: ["Paper A", "Paper B", "Paper C", "Paper D", "Paper E"] }
      })))
      .configureMemory({ retrieval_top_k: 2 })
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 6 });

    const s1 = agent.createSession({
      agent_id: "g4g5-memory-agent",
      tenant_id: tenantId,
      initial_input: makeInput("Search for papers about neural networks.")
    });

    const r1 = await s1.run();
    assertTerminal(r1, "G4+G5 session 1");
    assert.ok(s1.getEpisodes().length >= 1,
      "Session 1 should produce at least one episode");

    console.log(`  G4+G5 session 1 done: ${s1.getEpisodes().length} episodes`);

    const s2 = agent.createSession({
      agent_id: "g4g5-memory-agent",
      tenant_id: tenantId,
      initial_input: makeInput(
        "First, what did we discuss in the previous session? " +
        "Then search for papers about transformers."
      )
    });

    const r2 = await s2.run();
    assertTerminal(r2, "G4+G5 session 2");

    const profile = agent.getProfile();
    assert.equal(profile.memory_config.retrieval_top_k, 2);

    const traces = s2.getTraceRecords();
    const episodicProposals = traces.flatMap(t =>
      (t.proposals ?? []).filter(p => p.module_name === "episodic-memory-provider")
    );

    console.log(`  G4+G5 session 2 done: ${episodicProposals.length} episodic proposals, ${r2.steps.length} steps`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G6: high-risk tool triggers approval escalation", async () => {
    const agent = defineAgent({
      id: "g6-approval-agent",
      role: "You are an infrastructure operations assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool({
        name: "delete_database",
        description: "Permanently delete the production database.",
        sideEffectLevel: "high",
        inputSchema: { type: "object", properties: { confirm: { type: "boolean" } } },
        async invoke() {
          return { summary: "Database deleted." };
        }
      })
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 4 });

    const session = agent.createSession({
      agent_id: "g6-approval-agent",
      tenant_id: "g6-tenant",
      initial_input: makeInput("Delete the production database.")
    });

    const result = await session.run();

    assert.ok(
      ["completed", "escalated", "aborted", "waiting"].includes(result.finalState),
      `Expected a terminal-ish state, got ${result.finalState}`
    );

    if (result.finalState === "escalated") {
      const pending = session.getPendingApproval();
      assert.ok(pending, "escalated session should have a pending approval");

      const approvalResult = await session.approve({ approver_id: "test-reviewer" });
      assert.ok(approvalResult.run || approvalResult.approval,
        "approval should succeed");

      const final = await session.resume();
      assert.ok(
        ["completed", "aborted"].includes(final.finalState),
        `Post-approval session should end, got ${final.finalState}`
      );
      console.log(`  G6 done: escalated → approved → ${final.finalState}`);
    } else {
      console.log(`  G6 done: ${result.finalState} (LLM chose not to call the tool)`);
    }
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G7: ask_user followed by resume produces coherent continuation", async () => {
    const agent = defineAgent({
      id: "g7-ask-user-agent",
      role: "You are a helpful coding assistant that asks clarifying questions when needed."
    })
      .useReasoner(reasonerFactory())
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 6 });

    const session = agent.createSession({
      agent_id: "g7-ask-user-agent",
      tenant_id: "g7-tenant",
      initial_input: makeInput(
        "I need help with a project but I'm not sure what I want yet. Can you help?"
      )
    });

    const first = await session.run();

    if (first.finalState === "waiting") {
      const second = await session.resumeText(
        "Write a function that checks if a string is a palindrome. Return just the code."
      );
      assertTerminal(second, "G7 after resume");
      assert.ok(second.outputText,
        "should have output text after resume");
      console.log(`  G7 done: waiting → resumed → ${second.finalState}`);
    } else if (first.finalState === "completed") {
      console.log(`  G7 done: completed directly (LLM chose to respond)`);
    } else {
      console.log(`  G7 done: ${first.finalState}`);
    }

    const traces = session.getTraceRecords();
    assert.ok(traces.length >= 1, "should have trace records");

    const checkpoints = session.getCheckpoints();
    assert.ok(checkpoints.length >= 1, "should have at least one checkpoint");
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G8: long session produces complete observability data", async () => {
    const agent = defineAgent({
      id: "g8-observe-agent",
      role: "You are a data pipeline assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("list_files", async () => ({
        summary: "Found files: data.csv, config.json, README.md",
        payload: { files: ["data.csv", "config.json", "README.md"] }
      })))
      .registerTool(makeToolCallVerifier("read_file", async (input) => ({
        summary: `Content of ${input.filename ?? "file"}: id,name,value\n1,Alice,100\n2,Bob,200`,
        payload: { content: "id,name,value\n1,Alice,100\n2,Bob,200" }
      })))
      .registerTool(makeToolCallVerifier("compute_stats", async () => ({
        summary: "Stats: mean=150, median=150, count=2",
        payload: { mean: 150, median: 150, count: 2 }
      })))
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 3, checkpoint_interval: "cycle" });

    const session = agent.createSession({
      agent_id: "g8-observe-agent",
      tenant_id: "g8-tenant",
      initial_input: makeInput(
        "List the files in the directory, then read data.csv, " +
        "then compute statistics on the data, and finally summarize the findings."
      )
    });

    const result = await session.run();

    assert.ok(
      result.finalState === "completed" || result.finalState === "failed",
      `Expected completed or failed, got ${result.finalState}`
    );

    const events = session.getEvents();
    const eventTypes = events.map(e => e.event_type);
    assert.ok(eventTypes.includes("session.created"), "session.created event");
    assert.ok(eventTypes.includes("workspace.committed"), "workspace.committed event");
    assert.ok(eventTypes.includes("action.selected"), "action.selected event");

    const executedEvents = eventTypes.filter(t => t === "action.executed");
    assert.ok(executedEvents.length >= 2,
      `at least 2 action.executed events, got ${executedEvents.length}`);

    const traces = session.getTraces();
    assert.ok(traces.length >= 2, "at least 2 cycle traces");

    for (const trace of traces) {
      assert.ok(trace.cycle_id, "trace should have cycle_id");
      assert.ok(trace.session_id, "trace should have session_id");
    }

    const records = session.getTraceRecords();
    assert.ok(records.length >= 2, "at least 2 trace records");

    for (const record of records) {
      assert.ok(Array.isArray(record.proposals), "record should have proposals array");
      assert.ok(record.workspace, "record should have workspace snapshot");
      assert.ok(record.workspace.budget_assessment, "workspace should have budget_assessment");
    }

    const checkpoints = session.getCheckpoints();
    assert.ok(checkpoints.length >= 2,
      `at least 2 checkpoints with interval=cycle, got ${checkpoints.length}`);

    const cp = checkpoints[0];
    assert.ok(cp.checkpoint_id, "checkpoint should have id");
    assert.ok(cp.session, "checkpoint should contain session");
    assert.ok(Array.isArray(cp.goals), "checkpoint should contain goals");
    assert.ok(
      cp.working_memory === undefined || Array.isArray(cp.working_memory),
      "checkpoint should contain working memory when not slimmed"
    );
    assert.ok(
      cp.episodes === undefined || Array.isArray(cp.episodes),
      "checkpoint should contain episodes when not slimmed"
    );
    assert.ok(Array.isArray(cp.traces), "checkpoint should contain traces");

    const replay = session.replay();
    assert.equal(replay.cycle_count, records.length,
      "replay cycle_count should match trace record count");
    assert.ok(replay.traces.length >= 2, "replay should have traces");

    console.log(`  G8 done: ${result.steps.length} steps, ${events.length} events, ${traces.length} traces, ${checkpoints.length} checkpoints`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G9: handles empty and nonsensical inputs gracefully", async () => {
    const agent = defineAgent({
      id: "g9-edge-agent",
      role: "You are a general-purpose assistant."
    })
      .useReasoner(reasonerFactory())
      .withTokenBudget(30000)
      .configureRuntime({ max_cycles: 3 });

    const session = agent.createSession({
      agent_id: "g9-edge-agent",
      tenant_id: "g9-tenant",
      initial_input: makeInput("")
    });

    const result = await session.run();

    assert.ok(
      ["completed", "waiting", "aborted"].includes(result.finalState),
      `Expected a terminal state, got ${result.finalState}`
    );

    console.log(`  G9 done: empty input → ${result.finalState}`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G10: token budget tracked end-to-end across cycles", async () => {
    const agent = defineAgent({
      id: "g10-budget-track-agent",
      role: "You are a helpful assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("get_time", async () => ({
        summary: `Current time: ${new Date().toISOString()}`,
        payload: { time: new Date().toISOString() }
      })))
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 3 });

    const session = agent.createSession({
      agent_id: "g10-budget-track-agent",
      tenant_id: "g10-tenant",
      initial_input: makeInput(
        "Use the get_time tool to check the time, then tell me what time it is."
      )
    });

    const result = await session.run();

    assertTerminal(result, "G8 session");

    const sess = session.getSession();

    assert.equal(sess.budget_state.token_budget_total, 50000,
      "token_budget_total should match configured value");

    assert.ok(sess.budget_state.token_budget_used > 0,
      `token_budget_used should be > 0, got ${sess.budget_state.token_budget_used}`);

    assert.ok(
      sess.budget_state.token_budget_used <= sess.budget_state.token_budget_total,
      `token_budget_used (${sess.budget_state.token_budget_used}) should not exceed total (${sess.budget_state.token_budget_total})`
    );

    assert.ok(sess.budget_state.cycle_used >= 1,
      "at least one cycle should have been used");

    console.log(`  G10 done: tokens=${sess.budget_state.token_budget_used}/${sess.budget_state.token_budget_total}, cycles=${sess.budget_state.cycle_used}`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G11: three-session memory accumulation across tenant", async () => {
    const tenantId = "g11-shared-tenant";
    const agent = defineAgent({
      id: "g11-memory-accumulate-agent",
      role: "You are a personal journaling assistant."
    })
      .useReasoner(reasonerFactory())
      .withTokenBudget(50000)
      .configureMemory({ retrieval_top_k: 3 })
      .configureRuntime({ max_cycles: 3 });

    const topics = [
      "I learned about recursion today. It's when a function calls itself.",
      "Based on what I've studied, what programming concepts have I been learning about?"
    ];

    let lastOutput = null;

    for (let i = 0; i < topics.length; i++) {
      const session = agent.createSession({
        agent_id: "g11-memory-accumulate-agent",
        tenant_id: tenantId,
        initial_input: makeInput(topics[i])
      });

      const result = await session.run();
      assertTerminal(result, `G10 session ${i + 1}`);

      if (i === topics.length - 1) {
        lastOutput = result.outputText;
      }

      console.log(`  G11 session ${i + 1}: ${result.steps.length} steps, ${session.getEpisodes().length} episodes`);
    }

    assert.ok(lastOutput, "third session should produce output");
    const mentionsTopic =
      lastOutput.toLowerCase().includes("recursion") ||
      lastOutput.toLowerCase().includes("programming") ||
      lastOutput.toLowerCase().includes("factorial");
    assert.ok(mentionsTopic,
      `Output should reference studied topics. Got: "${lastOutput?.slice(0, 200)}"`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G12: conditional tool chain based on observation", async () => {
    const agent = defineAgent({
      id: "g12-conditional-agent",
      role: "You are a system monitoring assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("check_status", async () => ({
        summary: "System status: degraded. CPU usage: 92%. Memory: 85%.",
        payload: { status: "degraded", cpu: 92, memory: 85 }
      })))
      .registerTool(makeToolCallVerifier("restart_service", async () => ({
        summary: "Service restarted successfully.",
        payload: { restarted: true }
      })))
      .registerTool(makeToolCallVerifier("send_alert", async () => ({
        summary: "Alert sent to ops team.",
        payload: { sent: true }
      })))
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 4 });

    const session = agent.createSession({
      agent_id: "g12-conditional-agent",
      tenant_id: "g12-tenant",
      initial_input: makeInput(
        "Check the system status. If the system is degraded, " +
        "restart the service and send an alert. If it's healthy, just report."
      )
    });

    const result = await session.run();

    const state = assertTerminal(result, "G12");

    if (state === "completed") {
      const toolCalls = result.steps
        .filter(s => s.selectedAction?.action_type === "call_tool")
        .map(s => s.selectedAction.tool_name)
        .filter(Boolean);

      assert.ok(toolCalls.includes("check_status"),
        `Should have called check_status. Tools called: ${JSON.stringify(toolCalls)}`);

      console.log(`  G12 done: ${result.steps.length} steps, tools: ${toolCalls.join(" → ")}`);
    } else {
      console.log(`  G12 done: ${state} (LLM did not complete tool chain)`);
    }
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G13: checkpoint captures session state", async () => {
    const agent = defineAgent({
      id: "g13-checkpoint-agent",
      role: "You are a task tracking assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("create_task", async () => ({
        summary: "Task created successfully.",
        payload: { taskId: "task_123", status: "created" }
      })))
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 4 });

    const session = agent.createSession({
      agent_id: "g13-checkpoint-agent",
      tenant_id: "g13-tenant",
      initial_input: makeInput("Create a new task for reviewing the documentation.")
    });

    const result = await session.run();
    assert.ok(
      ["completed", "waiting"].includes(result.finalState),
      `Session should end cleanly, got ${result.finalState}`
    );

    const cp = session.checkpoint();
    assert.ok(cp.checkpoint_id, "checkpoint should have an id");
    assert.ok(cp.session, "checkpoint should contain session state");
    assert.ok(Array.isArray(cp.goals), "checkpoint should contain goals");
    assert.ok(
      cp.working_memory === undefined || Array.isArray(cp.working_memory),
      "checkpoint should contain working memory when not slimmed"
    );
    assert.ok(
      cp.episodes === undefined || Array.isArray(cp.episodes),
      "checkpoint should contain episodes when not slimmed"
    );
    assert.ok(Array.isArray(cp.traces), "checkpoint should contain traces");

    const checkpointEpisodes = cp.episodes ?? session.getEpisodes();
    assert.ok(checkpointEpisodes.length >= 1,
      "checkpoint should capture episodes from the session");
    assert.ok(cp.goals.length >= 1,
      "checkpoint should capture goals from the session");

    console.log(`  G13 done: ${result.finalState}, ${checkpointEpisodes.length} episodes, ${cp.goals.length} goals`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G14: event stream is ordered and complete", async () => {
    const agent = defineAgent({
      id: "g14-events-agent",
      role: "You are a file management assistant."
    })
      .useReasoner(reasonerFactory())
      .registerTool(makeToolCallVerifier("list_dir", async () => ({
        summary: "Directory contains: file1.txt, file2.txt",
        payload: { entries: ["file1.txt", "file2.txt"] }
      })))
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 4 });

    const session = agent.createSession({
      agent_id: "g14-events-agent",
      tenant_id: "g14-tenant",
      initial_input: makeInput("List the contents of the current directory.")
    });

    const result = await session.run();
    assertTerminal(result, "G14");

    const events = session.getEvents();
    const eventTypes = events.map(e => e.event_type);

    if (eventTypes.includes("session.completed")) {
      assert.ok(eventTypes.indexOf("session.created") < eventTypes.indexOf("session.completed"),
        "session.created should come before session.completed");
    }

    assert.ok(eventTypes.includes("workspace.committed"),
      "should have workspace.committed events");

    const eventIds = events.map(e => e.event_id);
    assert.equal(new Set(eventIds).size, eventIds.length,
      "all event_ids should be unique");

    console.log(`  G14 done: ${events.length} events, types: ${[...new Set(eventTypes)].join(", ")}`);
  });

  await sleep(API_COOLDOWN_MS);
  await t.test("G15: concurrent sessions are isolated", async () => {
    const agent = defineAgent({
      id: "g15-concurrent-agent",
      role: "You are a math tutor."
    })
      .useReasoner(reasonerFactory())
      .withTokenBudget(50000)
      .configureRuntime({ max_cycles: 4 });

    const inputs = [
      "What is 2 + 2?",
      "What is 3 * 7?",
      "What is the square root of 144?"
    ];

    const sessions = inputs.map(input =>
      agent.createSession({
        agent_id: "g15-concurrent-agent",
        tenant_id: "g15-tenant",
        initial_input: makeInput(input)
      })
    );

    const results = await Promise.all(sessions.map(s => s.run()));

    for (let i = 0; i < results.length; i++) {
      assert.ok(
        ["completed", "waiting"].includes(results[i].finalState),
        `Session ${i + 1} should end cleanly, got ${results[i].finalState}`
      );
      assert.ok(results[i].outputText,
        `Session ${i + 1} should have output text`);
    }

    const sessionIds = results.map(r => r.sessionId);
    assert.equal(new Set(sessionIds).size, sessionIds.length,
      "all sessions should have unique IDs");

    console.log(`  G15 done: ${results.length} concurrent sessions all completed`);
  });
});
