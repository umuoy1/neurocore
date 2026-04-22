import assert from "node:assert/strict";
import test from "node:test";
import { EvalRunner } from "@neurocore/eval-core";

test("EvalRunner executes cases with configured parallelism", async () => {
  let active = 0;
  let maxActive = 0;
  const runner = new EvalRunner({
    async execute(testCase) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
      return {
        session_id: `ses_${testCase.case_id}`,
        final_state: "completed",
        step_count: 1,
        output_text: testCase.input.content,
        tool_sequence: [],
        executed_tool_sequence: [],
        replay: {
          session_id: `ses_${testCase.case_id}`,
          cycle_count: 1,
          traces: [],
          final_output: testCase.input.content
        }
      };
    }
  });

  const report = await runner.run([
    {
      case_id: "a",
      description: "a",
      input: { content: "a" },
      expectations: { final_state: "completed" }
    },
    {
      case_id: "b",
      description: "b",
      input: { content: "b" },
      expectations: { final_state: "completed" }
    },
    {
      case_id: "c",
      description: "c",
      input: { content: "c" },
      expectations: { final_state: "completed" }
    }
  ], { parallelism: 2 });

  assert.equal(report.case_count, 3);
  assert.equal(report.pass_count, 3);
  assert.ok(maxActive >= 2);
});
