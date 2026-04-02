import { withTimeout } from "./timeout.js";

export interface FetchJsonOptions {
  fetchImpl?: typeof fetch;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {}
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const task = fetchImpl(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: controller.signal
  });

  const response = await withTimeout(task, options.timeoutMs ?? 15_000, () => controller.abort());
  if (!response.ok) {
    throw new Error(`fetch_json_failed:${response.status}:${url}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchText(
  url: string,
  options: FetchJsonOptions = {}
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const task = fetchImpl(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: controller.signal
  });

  const response = await withTimeout(task, options.timeoutMs ?? 15_000, () => controller.abort());
  if (!response.ok) {
    throw new Error(`fetch_text_failed:${response.status}:${url}`);
  }

  return response.text();
}
