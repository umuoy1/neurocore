const BASE_URL = "";

function getApiKey(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem("nc_api_key");
}

function normalizePath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = getApiKey();
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (apiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const res = await fetch(`${BASE_URL}${normalizePath(path)}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "unknown", body.message ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}
