import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

function isDebugEnabled(): boolean {
  const value = process.env.NEUROCORE_DEBUG;
  return value === "1" || value === "true" || value === "yes" || value === "debug";
}

export function debugLog(scope: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) {
    return;
  }

  const prefix = `[neurocore][${scope}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    console.log(prefix, JSON.stringify(data));
    return;
  }

  console.log(prefix);
}

export function maskSecret(value: string): string {
  if (value.length <= 10) {
    return "***";
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

let activeLogDirectory: string | undefined;
let activeLogFilePath: string | undefined;
let logWriteQueue = Promise.resolve();

export async function appendDebugFile(
  scope: string,
  message: string,
  payload?: unknown
): Promise<void> {
  if (!isDebugEnabled()) {
    return;
  }

  const filePath = resolveDebugLogFilePath();
  const entry = [
    `=== ${new Date().toISOString()} [${scope}] ${message} ===`,
    payload === undefined
      ? ""
      : typeof payload === "string"
        ? payload
        : JSON.stringify(payload, null, 2),
    ""
  ].join("\n");

  logWriteQueue = logWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(resolve(process.cwd(), ".log"), { recursive: true });
      await appendFile(filePath, entry, "utf8");
    })
    .catch((error) => {
      console.warn(
        `[neurocore][debug] Failed to append debug log file: ${error instanceof Error ? error.message : String(error)}`
      );
    });

  await logWriteQueue;
}

function resolveDebugLogFilePath(): string {
  const directory = resolve(process.cwd(), ".log");
  if (activeLogDirectory !== directory || !activeLogFilePath) {
    activeLogDirectory = directory;
    activeLogFilePath = join(directory, `neurocore-${createLogSuffix()}.log`);
  }
  return activeLogFilePath;
}

function createLogSuffix(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}
