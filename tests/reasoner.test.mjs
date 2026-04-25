import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadOpenAICompatibleConfig, OpenAICompatibleReasoner } from "@neurocore/sdk-node";

test("tool catalog side effect level overrides model-provided tool action level", async () => {
  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token"
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [
                  {
                    action_type: "call_tool",
                    title: "Run pwd",
                    description: "Execute pwd",
                    tool_name: "run_command",
                    tool_args: {
                      command: "pwd"
                    },
                    side_effect_level: "low"
                  }
                ]
              })
            }
          }
        ]
      };
    }
  });

  try {
    const actions = await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: ["run_command"],
        metadata: {
          tool_catalog: [
            {
              name: "run_command",
              sideEffectLevel: "high"
            }
          ]
        }
      },
      goals: [],
      runtime_state: {
        current_input_content: "Run pwd"
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    assert.equal(actions.length, 1);
    assert.equal(actions[0].tool_name, "run_command");
    assert.equal(actions[0].side_effect_level, "high");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respond retries with a larger token budget after incomplete JSON", async () => {
  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token"
  }, {
    max_tokens: 512
  });

  const requestBodies = [];
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")));

    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            choices: [
              {
                finish_reason: "length",
                message: {
                  content:
                    '{"actions":[{"action_type":"ask_user","title":"Project analysis","description":"This is a truncated response'
                }
              }
            ]
          };
        }
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      action_type: "ask_user",
                      title: "Project analysis",
                      description: "NeuroCore is an agent runtime and SDK monorepo."
                    }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const actions = await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: ["read_file"],
        metadata: {}
      },
      goals: [],
      runtime_state: {
        current_input_content: "Analyze this project."
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    assert.equal(callCount, 2);
    assert.equal(requestBodies[0].max_tokens, 512);
    assert.equal(requestBodies[1].max_tokens, 4096);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action_type, "ask_user");
    assert.equal(actions[0].description, "NeuroCore is an agent runtime and SDK monorepo.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadOpenAICompatibleConfig only loads connection settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neurocore-config-"));
  const configPath = join(directory, "llm.local.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: "openai-compatible",
      model: "test-model",
      apiUrl: "https://example.com/v1",
      bearerToken: "test-token",
      timeoutMs: 1234,
      extraBody: {
        enable_thinking: false
      },
      temperature: 0.1,
      max_tokens: 2048
    }),
    "utf8"
  );

  const config = await loadOpenAICompatibleConfig(configPath);
  assert.equal(config.model, "test-model");
  assert.equal(config.apiUrl, "https://example.com/v1");
  assert.equal(config.bearerToken, "test-token");
  assert.equal(config.timeoutMs, 1234);
  assert.deepEqual(config.extraBody, { enable_thinking: false });
  assert.equal("temperature" in config, false);
  assert.equal("max_tokens" in config, false);
});

test("respond sends configured temperature and max tokens", async () => {
  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token"
  }, {
    temperature: 0.65,
    max_tokens: 31999
  });

  const requestBodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      action_type: "ask_user",
                      title: "Reply",
                      description: "Done."
                    }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const actions = await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: [],
        metadata: {}
      },
      goals: [],
      runtime_state: {
        current_input_content: "Reply."
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    assert.equal(actions.length, 1);
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].temperature, 0.65);
    assert.equal(requestBodies[0].max_tokens, 31999);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respond still supports legacy maxOutputTokens", async () => {
  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token"
  }, {
    maxOutputTokens: 1234
  });

  const requestBodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      action_type: "ask_user",
                      title: "Reply",
                      description: "Done."
                    }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: [],
        metadata: {}
      },
      goals: [],
      runtime_state: {
        current_input_content: "Reply."
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    assert.equal(requestBodies[0].max_tokens, 1234);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respond forwards provider extra body without overriding core payload", async () => {
  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token",
    extraBody: {
      enable_thinking: false,
      model: "ignored-model"
    }
  });

  const requestBodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  actions: [
                    {
                      action_type: "ask_user",
                      title: "Reply",
                      description: "Done."
                    }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: [],
        metadata: {}
      },
      goals: [],
      runtime_state: {
        current_input_content: "Reply."
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    assert.equal(requestBodies[0].enable_thinking, false);
    assert.equal(requestBodies[0].model, "test-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respond surfaces provider quota failures instead of reporting a parse error", async () => {
  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token"
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    async text() {
      return '{"message":"Allocated quota exceeded"}';
    }
  });

  try {
    const actions = await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: [],
        metadata: {}
      },
      goals: [],
      runtime_state: {
        current_input_content: "Analyze this project."
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    assert.equal(actions.length, 1);
    assert.equal(actions[0].action_type, "ask_user");
    assert.match(actions[0].description, /quota|rate limit/i);
    assert.doesNotMatch(actions[0].description, /parsed into a valid action/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("debug mode writes full model input and output to a .log file", async () => {
  const previousDebug = process.env.NEUROCORE_DEBUG;
  const previousCwd = process.cwd();
  const workspace = await mkdtemp(join(tmpdir(), "neurocore-debug-log-"));
  process.env.NEUROCORE_DEBUG = "1";
  process.chdir(workspace);

  const reasoner = new OpenAICompatibleReasoner({
    provider: "openai-compatible",
    model: "test-model",
    apiUrl: "https://example.com/v1",
    bearerToken: "test-token"
  }, {
    temperature: 0.33,
    max_tokens: 3210
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async text() {
      return JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                actions: [
                  {
                    action_type: "ask_user",
                    title: "Reply",
                    description: "Full response body"
                  }
                ]
              })
            }
          }
        ]
      });
    }
  });

  try {
    await reasoner.respond({
      tenant_id: "local",
      session: {
        session_id: "ses_test",
        current_cycle_id: "cyc_test"
      },
      profile: {
        schema_version: "0.1.0",
        role: "Test runtime",
        tool_refs: [],
        metadata: {}
      },
      goals: [],
      runtime_state: {
        current_input_content: "Reply with debug log"
      },
      services: {
        now: () => new Date().toISOString(),
        generateId: (prefix) => `${prefix}_test`
      }
    });

    const files = await readdir(join(workspace, ".log"));
    assert.equal(files.length, 1);

    const logContent = await readFile(join(workspace, ".log", files[0]), "utf8");
    assert.match(logContent, /model-request/);
    assert.match(logContent, /model-response/);
    assert.match(logContent, /Reply with debug log/);
    assert.match(logContent, /"max_tokens": 3210/);
    assert.match(logContent, /"temperature": 0.33/);
    assert.match(logContent, /Full response body/);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
    restoreEnv("NEUROCORE_DEBUG", previousDebug);
  }
});

function restoreEnv(name, value) {
  if (value == null) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
