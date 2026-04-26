import type { Tool } from "@neurocore/protocol";
import type { WebBrowserConfig } from "../types.js";
import { fetchText } from "../shared/fetch-json.js";
import { htmlToText } from "../shared/html-to-text.js";

type FetchLikeToolName = "web_browser" | "web_fetch";

type WebPageSource = Record<string, string> & {
  source_id: string;
  title: string;
  url: string;
  citation: string;
  trust: "untrusted";
};

type BrowserTracePayload = Record<string, string | number> & {
  action: string;
  tool_name: string;
  url: string;
  fetched_at: string;
  format: string;
  content_chars: number;
  link_count: number;
};

const WEB_UNTRUSTED_REASON = "Public web page content can contain unverified or adversarial instructions.";

export function createWebBrowserTool(config: WebBrowserConfig = {}): Tool {
  return createUrlFetchTool("web_browser", "Fetch a URL and convert the page into readable text.", config);
}

export function createWebFetchTool(config: WebBrowserConfig = {}): Tool {
  return createUrlFetchTool("web_fetch", "Fetch a public URL and return cited untrusted page content.", config);
}

function createUrlFetchTool(
  toolName: FetchLikeToolName,
  description: string,
  config: WebBrowserConfig
): Tool {
  return {
    name: toolName,
    description,
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        format: { type: "string", enum: ["markdown", "text"], default: "text" }
      },
      required: ["url"]
    },
    outputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        links: {
          type: "array",
          items: { type: "string" }
        },
        source: {
          type: "object",
          properties: {
            source_id: { type: "string" },
            title: { type: "string" },
            url: { type: "string" },
            citation: { type: "string" },
            trust: { type: "string" }
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
        browser_trace: {
          type: "object",
          properties: {
            action: { type: "string" },
            tool_name: { type: "string" },
            url: { type: "string" },
            fetched_at: { type: "string" },
            format: { type: "string" },
            content_chars: { type: "number" },
            link_count: { type: "number" }
          }
        },
        untrusted_content: { type: "boolean" },
        untrusted_reason: { type: "string" }
      }
    },
    async invoke(input) {
      const url = typeof input.url === "string" ? input.url : "";
      const format = input.format === "markdown" ? "markdown" : "text";
      const html = await fetchText(url, {
        fetchImpl: config.fetch,
        timeoutMs: config.timeoutMs ?? 15_000,
        headers: {
          "user-agent": config.userAgent ?? "NeuroCore-Personal-Assistant/0.1"
        }
      });

      const document = htmlToText(html, config.maxChars ?? 8_000);
      const source: WebPageSource = {
        source_id: "src_page",
        title: document.title ?? "",
        url,
        citation: formatCitation("src_page", url),
        trust: "untrusted" as const
      };
      const browserTrace: BrowserTracePayload = {
        action: "fetch_url",
        tool_name: toolName,
        url,
        fetched_at: new Date().toISOString(),
        format,
        content_chars: document.content.length,
        link_count: document.links.length
      };
      return {
        summary: formatBrowserSummary(source.citation, url, document.title, document.content, browserTrace),
        payload: {
          title: document.title ?? "",
          content: document.content,
          links: document.links,
          source,
          sources: [source],
          citations: [source.citation],
          browser_trace: browserTrace,
          untrusted_content: true,
          untrusted_reason: WEB_UNTRUSTED_REASON
        }
      };
    }
  };
}

function formatBrowserSummary(
  citation: string,
  url: string,
  title: string | undefined,
  content: string,
  trace: { action: string; tool_name: string; content_chars: number; link_count: number }
): string {
  const excerpt = content.replace(/\s+/g, " ").trim().slice(0, 400);
  const parts = [`UNTRUSTED_WEB_CONTENT. Fetched ${citation}`, `url: ${url}`];
  if (title) {
    parts.push(`title: ${title}`);
  }
  if (excerpt) {
    parts.push(`excerpt: ${excerpt}`);
  }
  parts.push(`Trace: ${trace.action} via ${trace.tool_name}, content_chars=${trace.content_chars}, link_count=${trace.link_count}`);
  parts.push(`Sources: ${citation}`);
  return parts.join(" | ");
}

function formatCitation(sourceId: string, url: string): string {
  return `[${sourceId}] ${url || "unknown-url"}`;
}
