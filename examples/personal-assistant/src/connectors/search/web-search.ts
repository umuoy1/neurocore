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

type WebSearchResult = Record<string, string> & {
  source_id: string;
  title: string;
  url: string;
  snippet: string;
  source_type: "web_search_result";
  trust: "untrusted";
  citation: string;
};

type WebSearchSource = Record<string, string> & {
  source_id: string;
  title: string;
  url: string;
  citation: string;
  trust: "untrusted";
};

const WEB_UNTRUSTED_REASON = "Public web search results can contain unverified or adversarial content.";

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
              snippet: { type: "string" },
              source_id: { type: "string" },
              source_type: { type: "string" },
              trust: { type: "string" },
              citation: { type: "string" }
            }
          }
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source_id: { type: "string" },
              title: { type: "string" },
              url: { type: "string" },
              citation: { type: "string" },
              trust: { type: "string" }
            }
          }
        },
        citations: {
          type: "array",
          items: { type: "string" }
        },
        untrusted_content: { type: "boolean" },
        untrusted_reason: { type: "string" }
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
      const apiKey = resolveApiKey(config);
      if (apiKey) {
        headers["X-Subscription-Token"] = apiKey;
      }

      const response = await fetchJson<BraveSearchResponse>(`${baseUrl}?${params.toString()}`, {
        fetchImpl: config.fetch,
        headers,
        timeoutMs: config.timeoutMs ?? 10_000
      });

      const results: WebSearchResult[] = (response.web?.results ?? []).map((entry, index) => {
        const sourceId = `src_${index + 1}`;
        const url = entry.url ?? "";
        return {
          source_id: sourceId,
          title: entry.title ?? "",
          url,
          snippet: entry.description ?? "",
          source_type: "web_search_result",
          trust: "untrusted",
          citation: formatCitation(sourceId, url)
        };
      });
      const sources: WebSearchSource[] = results.map((result) => ({
        source_id: result.source_id,
        title: result.title,
        url: result.url,
        citation: result.citation,
        trust: result.trust
      }));
      const citations = sources.map((source) => source.citation);

      return {
        summary: formatSearchSummary(query, results),
        payload: {
          results,
          sources,
          citations,
          untrusted_content: true,
          untrusted_reason: WEB_UNTRUSTED_REASON
        }
      };
    }
  };
}

function resolveApiKey(config: WebSearchConfig): string | undefined {
  if (config.apiKeyRef && config.credentialVault) {
    return config.credentialVault.leaseSecret(
      config.apiKeyRef,
      config.credentialScope ?? "tool:web_search",
      { reason: "web_search" }
    ).value;
  }
  return config.apiKey;
}

function formatSearchSummary(
  query: string,
  results: WebSearchResult[]
): string {
  if (results.length === 0) {
    return `UNTRUSTED_WEB_CONTENT. Web search for "${query}" returned no results.`;
  }

  const lines = results.slice(0, 5).map((result, index) => {
    const segments = [`${index + 1}. ${result.citation} ${result.title || "Untitled result"}`];
    if (result.snippet) {
      segments.push(result.snippet);
    }
    if (result.url) {
      segments.push(result.url);
    }
    return segments.join(" | ");
  });
  const citations = results.slice(0, 5).map((result) => result.citation).join(", ");

  return `UNTRUSTED_WEB_CONTENT. Web search for "${query}" returned ${results.length} result${results.length === 1 ? "" : "s"}: ${lines.join(" ; ")}. Sources: ${citations}`;
}

function formatCitation(sourceId: string, url: string): string {
  return `[${sourceId}] ${url || "unknown-url"}`;
}
