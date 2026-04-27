import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryCredentialVault,
  filterSecretEnv,
  redactCredentialSecrets
} from "../examples/personal-assistant/dist/security/credential-vault.js";
import { createWebSearchTool } from "../examples/personal-assistant/dist/connectors/search/web-search.js";
import { LocalSandboxProvider, SandboxManager } from "../examples/personal-assistant/dist/sandbox/sandbox-provider.js";

test("credential vault leases secrets only to authorized scopes and records audit", () => {
  const vault = new InMemoryCredentialVault();
  const ref = vault.registerSecret({
    ref: "personal-assistant://tool/web_search/api-key",
    value: "search-secret-token",
    scopes: ["tool:web_search"]
  });

  const lease = vault.leaseSecret(ref, "tool:web_search", { reason: "test" });

  assert.equal(lease.value, "search-secret-token");
  assert.throws(() => vault.leaseSecret(ref, "tool:email_send"), /not authorized/);
  assert.deepEqual(vault.listAuditEvents().map((event) => event.event_type), [
    "secret.registered",
    "secret.leased",
    "secret.denied"
  ]);
});

test("web search tool leases its API key from the credential vault", async () => {
  const vault = new InMemoryCredentialVault();
  vault.registerSecret({
    ref: "personal-assistant://tool/web_search/api-key",
    value: "search-secret-token",
    scopes: ["tool:web_search"]
  });
  let observedToken;
  const tool = createWebSearchTool({
    apiKeyRef: "personal-assistant://tool/web_search/api-key",
    credentialVault: vault,
    credentialScope: "tool:web_search",
    baseUrl: "https://search.example.test",
    fetch: async (_url, init) => {
      observedToken = init?.headers?.["X-Subscription-Token"];
      return new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await tool.invoke({ query: "hello", max_results: 1 }, {});

  assert.equal(observedToken, "search-secret-token");
  assert.ok(vault.listAuditEvents().some((event) => event.event_type === "secret.leased"));
});

test("sandbox strips secret-like environment variables by default", async () => {
  let observedEnv;
  const runner = {
    async run(input) {
      observedEnv = input.env;
      return {
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        timed_out: false
      };
    }
  };
  const manager = new SandboxManager([
    new LocalSandboxProvider({ runner })
  ], "local");

  await manager.execute({
    command: "env",
    env: {
      OPENAI_API_KEY: "should-not-enter-sandbox",
      SAFE_VALUE: "visible"
    }
  });

  assert.equal(observedEnv.OPENAI_API_KEY, undefined);
  assert.equal(observedEnv.SAFE_VALUE, "visible");
  assert.deepEqual(filterSecretEnv({ TOKEN: "no", NORMAL: "yes" }), { NORMAL: "yes" });
});

test("credential redactor removes known secrets, bearer tokens and secret-key values from artifacts", () => {
  const redacted = redactCredentialSecrets({
    headers: {
      authorization: "Bearer live-secret-token-123456",
      safe: "ok"
    },
    content: "use search-secret-token and sk-liveabcdef123456",
    nested: {
      apiKey: "search-secret-token"
    }
  }, ["search-secret-token"]);
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /search-secret-token/);
  assert.doesNotMatch(serialized, /live-secret-token/);
  assert.doesNotMatch(serialized, /sk-liveabcdef123456/);
  assert.match(serialized, /\[redacted\]/);
});
