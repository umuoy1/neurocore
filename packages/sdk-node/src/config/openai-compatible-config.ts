import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { debugLog, maskSecret } from "../debug.js";

export interface OpenAICompatibleConfig {
  provider: "openai-compatible";
  model: string;
  apiUrl: string;
  bearerToken: string;
  timeoutMs?: number;
  jsonTimeoutMs?: number;
  streamTimeoutMs?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export const DEFAULT_MODEL_CONFIG_PATH = ".neurocore/llm.local.json";

export async function loadOpenAICompatibleConfig(
  filePath = DEFAULT_MODEL_CONFIG_PATH
): Promise<OpenAICompatibleConfig> {
  const resolvedPath = resolve(filePath);
  debugLog("config", "Loading model config", { filePath: resolvedPath });
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<OpenAICompatibleConfig>;

  if (parsed.provider !== "openai-compatible") {
    throw new Error(
      `Invalid model config at ${resolvedPath}: "provider" must be "openai-compatible".`
    );
  }
  if (!parsed.model) {
    throw new Error(`Invalid model config at ${resolvedPath}: "model" is required.`);
  }
  if (!parsed.apiUrl) {
    throw new Error(`Invalid model config at ${resolvedPath}: "apiUrl" is required.`);
  }
  if (!parsed.bearerToken) {
    throw new Error(`Invalid model config at ${resolvedPath}: "bearerToken" is required.`);
  }

  const config: OpenAICompatibleConfig = {
    provider: "openai-compatible",
    model: parsed.model,
    apiUrl: parsed.apiUrl,
    bearerToken: parsed.bearerToken,
    timeoutMs: parsed.timeoutMs,
    jsonTimeoutMs: parsed.jsonTimeoutMs,
    streamTimeoutMs: parsed.streamTimeoutMs,
    headers: parsed.headers,
    extraBody: isPlainRecord(parsed.extraBody) ? parsed.extraBody : undefined
  };

  debugLog("config", "Model config loaded", {
    provider: config.provider,
    model: config.model,
    apiUrl: config.apiUrl,
    bearerTokenMasked: maskSecret(config.bearerToken),
    timeoutMs: config.timeoutMs ?? 60000,
    jsonTimeoutMs: config.jsonTimeoutMs,
    streamTimeoutMs: config.streamTimeoutMs,
    headerKeys: Object.keys(config.headers ?? {}),
    extraBodyKeys: Object.keys(config.extraBody ?? {})
  });

  return config;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
