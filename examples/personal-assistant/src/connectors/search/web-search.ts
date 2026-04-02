import type { Tool } from "@neurocore/protocol";
import type { WebSearchConfig } from "../types.js";
import { fetchJson } from "../shared/fetch-json.js";

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}

export function createWebSearchTool(config: WebSearchConfig): Tool {
  return {
    name: "web_search",
    description: "Search the public web for recent information.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", default: config.maxResults ?? 5 }
      },
      required: ["query"]
    },
    outputSchema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" }
            }
          }
        }
      }
    },
    async invoke(input) {
      const query = typeof input.query === "string" ? input.query : "";
      const maxResults = typeof input.max_results === "number"
        ? input.max_results
        : (config.maxResults ?? 5);

      const baseUrl = config.baseUrl ?? "https://api.search.brave.com/res/v1/web/search";
      const params = new URLSearchParams({
        q: query,
        count: String(maxResults)
      });
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers["X-Subscription-Token"] = config.apiKey;
      }

      const response = await fetchJson<BraveSearchResponse>(`${baseUrl}?${params.toString()}`, {
        fetchImpl: config.fetch,
        headers,
        timeoutMs: config.timeoutMs ?? 10_000
      });

      const results = (response.web?.results ?? []).map((entry) => ({
        title: entry.title ?? "",
        url: entry.url ?? "",
        snippet: entry.description ?? ""
      }));

      return {
        summary: formatSearchSummary(query, results),
        payload: { results }
      };
    }
  };
}

function formatSearchSummary(
  query: string,
  results: Array<{ title: string; url: string; snippet: string }>
): string {
  if (results.length === 0) {
    return `Web search for "${query}" returned no results.`;
  }

  const lines = results.slice(0, 5).map((result, index) => {
    const segments = [`${index + 1}. ${result.title || "Untitled result"}`];
    if (result.snippet) {
      segments.push(result.snippet);
    }
    if (result.url) {
      segments.push(result.url);
    }
    return segments.join(" | ");
  });

  return `Web search for "${query}" returned ${results.length} result${results.length === 1 ? "" : "s"}: ${lines.join(" ; ")}`;
}
