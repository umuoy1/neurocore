#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const specDir = "docs/11_2026-04-27_personal-agent-competitive-spec";
const ledgerPath = `${specDir}/project-ledger.json`;
const requiredDocs = [
  "01_openclaw-hermes-feature-map.md",
  "02_architecture.md",
  "03_delivery-roadmap.md",
  "04_acceptance-oracle.md",
  "05_test-strategy.md",
  "06_long-run-agent-protocol.md",
  "07_progress-log.md",
  "08_failed-attempts.md"
].map((file) => `${specDir}/${file}`);
const requiredScripts = [
  "pa:plan-check",
  "pa:next-task",
  "pa:start",
  "pa:task-check",
  "pa:accept"
];
const allowedStatuses = new Set(["pending", "in_progress", "completed", "blocked", "skipped"]);

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "plan-check") {
    const ledger = loadLedger();
    validateProject(ledger);
    console.log("personal-agent plan check passed");
    return;
  }

  if (command === "next-task") {
    const ledger = loadLedger();
    validateProject(ledger);
    const task = getNextTask(ledger);
    if (!task) {
      console.log("No runnable task. Check blocked or completed ledger state.");
      return;
    }
    printTask(task);
    return;
  }

  if (command === "start") {
    const ledger = loadLedger();
    validateProject(ledger);
    const targetId = args[0] ?? getNextTask(ledger)?.id;
    const task = requireTask(ledger, targetId);
    startTask(ledger, task);
    saveLedger(ledger);
    console.log(`started task: ${task.id}`);
    return;
  }

  if (command === "task-check") {
    const ledger = loadLedger();
    validateProject(ledger);
    const taskId = args[0] ?? ledger.meta?.current_task;
    const task = requireTask(ledger, taskId);
    validateTaskReady(ledger, task);
    validateWorktreeScope(task);
    console.log(`task check passed: ${task.id}`);
    return;
  }

  if (command === "accept") {
    const ledger = loadLedger();
    validateProject(ledger);
    const taskId = args[0] ?? ledger.meta?.current_task;
    const task = requireTask(ledger, taskId);
    validateTaskReady(ledger, task);
    validateWorktreeScope(task);
    for (const testCommand of task.tests) {
      console.log(`running: ${testCommand}`);
      execSync(testCommand, { cwd: rootDir, stdio: "inherit", shell: true });
    }
    console.log(`acceptance passed: ${task.id}`);
    return;
  }

  fail(`Unknown command: ${command}`);
}

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/personal-agent-plan.mjs plan-check",
    "  node scripts/personal-agent-plan.mjs next-task",
    "  node scripts/personal-agent-plan.mjs start [task_id]",
    "  node scripts/personal-agent-plan.mjs task-check [task_id]",
    "  node scripts/personal-agent-plan.mjs accept [task_id]"
  ].join("\n"));
}

function loadLedger() {
  const absolute = path.join(rootDir, ledgerPath);
  if (!fs.existsSync(absolute)) {
    fail(`Missing ledger: ${ledgerPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`Invalid ledger JSON: ${error.message}`);
  }
}

function saveLedger(ledger) {
  fs.writeFileSync(path.join(rootDir, ledgerPath), `${JSON.stringify(ledger, null, 2)}\n`);
}

function validateProject(ledger) {
  for (const docPath of requiredDocs) {
    requireFile(docPath);
  }
  requireFile(ledgerPath);
  validatePackageScripts();
  validateAgentRules();
  validateLedgerShape(ledger);
}

function validatePackageScripts() {
  const packagePath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const scriptName of requiredScripts) {
    if (!pkg.scripts || typeof pkg.scripts[scriptName] !== "string") {
      fail(`Missing package script: ${scriptName}`);
    }
  }
}

function validateAgentRules() {
  requireFile("AGENTS.md");
  const content = fs.readFileSync(path.join(rootDir, "AGENTS.md"), "utf8");
  if (!content.includes("docs/11_2026-04-27_personal-agent-competitive-spec/06_long-run-agent-protocol.md")) {
    fail("AGENTS.md must reference the personal assistant long-run protocol");
  }
  if (!content.includes("npm run pa:accept -- <task_id>")) {
    fail("AGENTS.md must require pa:accept before marking tasks completed");
  }
  if (!content.includes("npm run pa:start -- <task_id>")) {
    fail("AGENTS.md must require pa:start before starting pending tasks");
  }
  if (!content.includes("每个 ledger task 验收后由 agent 自己创建 task commit")) {
    fail("AGENTS.md must require task commits after acceptance");
  }
}

function validateLedgerShape(ledger) {
  if (ledger.schema_version !== "1.0.0") {
    fail("ledger.schema_version must be 1.0.0");
  }
  if (!ledger.meta || typeof ledger.meta.current_task !== "string") {
    fail("ledger.meta.current_task is required");
  }
  if (!Array.isArray(ledger.phases) || ledger.phases.length === 0) {
    fail("ledger.phases must be a non-empty array");
  }
  if (!Array.isArray(ledger.tasks) || ledger.tasks.length === 0) {
    fail("ledger.tasks must be a non-empty array");
  }

  const phaseIds = new Set();
  for (const phase of ledger.phases) {
    if (!phase.id || phaseIds.has(phase.id)) {
      fail(`Invalid or duplicate phase id: ${phase.id}`);
    }
    phaseIds.add(phase.id);
    if (!Array.isArray(phase.exit_criteria) || phase.exit_criteria.length === 0) {
      fail(`Phase ${phase.id} must define exit_criteria`);
    }
  }

  const taskIds = new Set();
  for (const task of ledger.tasks) {
    if (!task.id || taskIds.has(task.id)) {
      fail(`Invalid or duplicate task id: ${task.id}`);
    }
    taskIds.add(task.id);
    if (!phaseIds.has(task.phase)) {
      fail(`Task ${task.id} references unknown phase: ${task.phase}`);
    }
    if (!allowedStatuses.has(task.status)) {
      fail(`Task ${task.id} has invalid status: ${task.status}`);
    }
    requireStringArray(task, "depends_on", { allowEmpty: true });
    requireStringArray(task, "design_refs");
    requireStringArray(task, "acceptance");
    requireStringArray(task, "tests");
    requireStringArray(task, "write_paths");
    for (const ref of task.design_refs) {
      requireFile(ref.split("#")[0]);
    }
  }

  for (const task of ledger.tasks) {
    for (const dependency of task.depends_on) {
      if (!taskIds.has(dependency)) {
        fail(`Task ${task.id} references unknown dependency: ${dependency}`);
      }
    }
  }

  requireTask(ledger, ledger.meta.current_task);
  const inProgressTasks = ledger.tasks.filter((task) => task.status === "in_progress");
  if (inProgressTasks.length > 1) {
    fail(`Only one task can be in_progress: ${inProgressTasks.map((task) => task.id).join(", ")}`);
  }
  if (inProgressTasks.length === 1 && inProgressTasks[0].id !== ledger.meta.current_task) {
    fail(`meta.current_task must match in_progress task ${inProgressTasks[0].id}`);
  }
}

function requireStringArray(task, key, options = {}) {
  if (!Array.isArray(task[key]) || (!options.allowEmpty && task[key].length === 0) || task[key].some((value) => typeof value !== "string" || value.length === 0)) {
    fail(`Task ${task.id} must define non-empty string array: ${key}`);
  }
}

function getNextTask(ledger) {
  const inProgress = ledger.tasks.find((task) => task.status === "in_progress");
  if (inProgress) {
    return inProgress;
  }
  const completed = new Set(ledger.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  return ledger.tasks.find((task) =>
    task.status === "pending" &&
    task.depends_on.every((dependency) => completed.has(dependency))
  );
}

function startTask(ledger, task) {
  const inProgress = ledger.tasks.find((candidate) => candidate.status === "in_progress");
  if (inProgress) {
    if (inProgress.id === task.id) {
      return;
    }
    fail(`Cannot start ${task.id}; ${inProgress.id} is already in_progress`);
  }
  if (task.status !== "pending") {
    fail(`Task ${task.id} must be pending to start; current status is ${task.status}`);
  }
  const completed = new Set(ledger.tasks.filter((candidate) => candidate.status === "completed").map((candidate) => candidate.id));
  for (const dependency of task.depends_on) {
    if (!completed.has(dependency)) {
      fail(`Task ${task.id} dependency is not completed: ${dependency}`);
    }
  }
  task.status = "in_progress";
  task.started_at = new Date().toISOString();
  ledger.meta.current_task = task.id;
  ledger.meta.phase = task.phase;
  ledger.meta.updated_at = new Date().toISOString();
}

function requireTask(ledger, taskId) {
  if (!taskId) {
    fail("Task id is required");
  }
  const task = ledger.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    fail(`Unknown task: ${taskId}`);
  }
  return task;
}

function validateTaskReady(ledger, task) {
  if (task.id !== ledger.meta.current_task) {
    fail(`Task ${task.id} is not current_task (${ledger.meta.current_task})`);
  }
  if (task.status !== "in_progress") {
    fail(`Task ${task.id} must be in_progress before task-check/accept; current status is ${task.status}`);
  }
  const completed = new Set(ledger.tasks.filter((candidate) => candidate.status === "completed").map((candidate) => candidate.id));
  for (const dependency of task.depends_on) {
    if (!completed.has(dependency)) {
      fail(`Task ${task.id} dependency is not completed: ${dependency}`);
    }
  }
}

function validateWorktreeScope(task) {
  const changedFiles = getChangedFiles();
  if (changedFiles.length === 0) {
    return;
  }
  const disallowed = changedFiles.filter((file) => !isAllowedPath(file, task.write_paths));
  if (disallowed.length > 0) {
    fail([
      `Task ${task.id} has changed files outside write_paths:`,
      ...disallowed.map((file) => `  - ${file}`)
    ].join("\n"));
  }
}

function getChangedFiles() {
  const output = execSync("git status --short -uall", { cwd: rootDir, encoding: "utf8" }).trimEnd();
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.slice(3).trim())
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file)
    .filter(Boolean)
    .sort();
}

function isAllowedPath(file, allowedPaths) {
  const normalized = normalizePath(file);
  return allowedPaths.some((allowedPath) => {
    const allowed = normalizePath(allowedPath);
    return normalized === allowed || normalized.startsWith(allowed.endsWith("/") ? allowed : `${allowed}/`);
  });
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(rootDir, relativePath))) {
    fail(`Missing file: ${relativePath}`);
  }
}

function printTask(task) {
  console.log(JSON.stringify({
    id: task.id,
    phase: task.phase,
    title: task.title,
    status: task.status,
    depends_on: task.depends_on,
    acceptance: task.acceptance,
    tests: task.tests,
    write_paths: task.write_paths
  }, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
