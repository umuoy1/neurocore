import type { Tool } from "@neurocore/protocol";
import type { WebBrowserConfig } from "../types.js";
import { fetchText } from "../shared/fetch-json.js";
import { htmlToText } from "../shared/html-to-text.js";

export function createWebBrowserTool(config: WebBrowserConfig = {}): Tool {
  return {
    name: "web_browser",
    description: "Fetch a URL and convert the page into readable text.",
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
        }
      }
    },
    async invoke(input) {
      const url = typeof input.url === "string" ? input.url : "";
      const html = await fetchText(url, {
        fetchImpl: config.fetch,
        timeoutMs: config.timeoutMs ?? 15_000,
        headers: {
          "user-agent": config.userAgent ?? "NeuroCore-Personal-Assistant/0.1"
        }
      });

      const document = htmlToText(html, config.maxChars ?? 8_000);
      return {
        summary: formatBrowserSummary(url, document.title, document.content),
        payload: {
          title: document.title ?? "",
          content: document.content,
          links: document.links
        }
      };
    }
  };
}

function formatBrowserSummary(url: string, title: string | undefined, content: string): string {
  const excerpt = content.replace(/\s+/g, " ").trim().slice(0, 400);
  const parts = [`Fetched ${url}`];
  if (title) {
    parts.push(`title: ${title}`);
  }
  if (excerpt) {
    parts.push(`excerpt: ${excerpt}`);
  }
  return parts.join(" | ");
}
