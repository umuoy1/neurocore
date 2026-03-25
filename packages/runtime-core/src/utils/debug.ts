function isDebugEnabled(): boolean {
  const value =
    typeof process !== "undefined" && process.env ? process.env.NEUROCORE_DEBUG : undefined;
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

