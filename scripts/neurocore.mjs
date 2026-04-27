#!/usr/bin/env node
import { runPersonalAssistantCli } from "../examples/personal-assistant/scripts/assistant.mjs";

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === "assistant") {
    process.exitCode = await runPersonalAssistantCli(rest);
  } else if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log([
      "Usage:",
      "  neurocore assistant <setup|start|stop|status|install-daemon|serve>"
    ].join("\n"));
    process.exitCode = 0;
  } else {
    throw new Error(`Unknown neurocore command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
