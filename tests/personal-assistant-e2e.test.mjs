import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalAssistantAgent } from "../examples/personal-assistant/dist/app/create-personal-assistant.js";

test("personal assistant can call web_search and answer with the observation", async () => {
  const agent = createPersonalAssistantAgent({
    db_path: ".neurocore/personal-assistant-test.sqlite",
    tenant_id: "test-tenant",
    reasoner: createSearchReasoner(),
    connectors: {
      search: {
        baseUrl: "https://example.test/search",
        fetch: async () =>
          new Response(
            JSON.stringify({
              web: {
                results: [
                  {
                    title: "NeuroCore",
                    url: "https://example.test/neurocore",
                    description: "A structured agent runtime."
                  }
                ]
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          )
      },
      browser: {}
    }
  });

  const session = agent.createSession({
    agent_id: "personal-assistant",
    tenant_id: "test-tenant",
    initial_input: {
      content: "search for NeuroCore"
    }
  });

  const result = await session.run();
  assert.equal(result.finalState, "completed");
  assert.match(result.outputText ?? "", /NeuroCore/);
  assert.match(result.outputText ?? "", /structured agent runtime/i);
});

function createSearchReasoner() {
  return {
    name: "search-reasoner",
    async plan(ctx) {
      return [
        {
          proposal_id: ctx.services.generateId("prp"),
          schema_version: ctx.profile.schema_version,
          session_id: ctx.session.session_id,
          cycle_id: ctx.session.current_cycle_id ?? ctx.services.generateId("cyc"),
          module_name: "search-reasoner",
          proposal_type: "plan",
          salience_score: 0.9,
          confidence: 0.95,
          risk: 0,
          payload: { summary: "Search first, then summarize." }
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
            title: "Return search result",
            description: input.replace(/^Tool observation:\s*/, "").trim(),
            side_effect_level: "none"
          }
        ];
      }

      return [
        {
          action_id: ctx.services.generateId("act"),
          action_type: "call_tool",
          title: "Search the web",
          tool_name: "web_search",
          tool_args: {
            query: input,
            max_results: 1
          },
          side_effect_level: "none"
        }
      ];
    }
  };
}
