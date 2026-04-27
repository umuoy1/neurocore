#!/usr/bin/env node
import { runPersonalAssistantBaseline } from "../dist/baseline/runner.js";

const args = parseArgs(process.argv.slice(2));

try {
  const result = await runPersonalAssistantBaseline({
    mode: args.mode,
    artifactDir: args.artifactDir,
    updateAccepted: args.updateAccepted,
    keepServer: args.keepServer,
    port: args.port
  });
  console.log(JSON.stringify({
    run_id: result.runId,
    mode: result.mode,
    artifact_dir: result.artifactDir,
    status: result.verdict.status,
    assertion_count: result.verdict.assertion_count,
    failed_count: result.verdict.failed_count,
    metrics: result.metrics
  }, null, 2));
  process.exitCode = result.verdict.status === "pass" ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 2;
}

function parseArgs(argv) {
  const parsed = {
    mode: process.env.PERSONAL_ASSISTANT_LIVE_BASELINE === "1" ? "live-provider" : "deterministic",
    artifactDir: undefined,
    updateAccepted: false,
    keepServer: false,
    port: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      parsed.mode = argv[++index];
      continue;
    }
    if (arg === "--artifact-dir") {
      parsed.artifactDir = argv[++index];
      continue;
    }
    if (arg === "--update-accepted") {
      parsed.updateAccepted = true;
      continue;
    }
    if (arg === "--keep-server") {
      parsed.keepServer = true;
      continue;
    }
    if (arg === "--port") {
      parsed.port = Number(argv[++index]);
      continue;
    }
    if (arg === "--live") {
      parsed.mode = "live-provider";
      continue;
    }
  }

  if (!["deterministic", "local-service", "live-provider"].includes(parsed.mode)) {
    throw new Error(`Unsupported baseline mode: ${parsed.mode}`);
  }
  if (parsed.port !== undefined && (!Number.isInteger(parsed.port) || parsed.port <= 0)) {
    throw new Error(`Invalid --port: ${parsed.port}`);
  }
  return parsed;
}
