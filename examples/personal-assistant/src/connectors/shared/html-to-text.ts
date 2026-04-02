export interface HtmlDocumentSummary {
  title?: string;
  content: string;
  links: string[];
}

export function htmlToText(html: string, maxChars = 8_000): HtmlDocumentSummary {
  const title = extractMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.trim();
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .slice(0, 50);

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);

  return {
    title,
    content: stripped,
    links
  };
}

function extractMatch(input: string, pattern: RegExp): string | undefined {
  const match = input.match(pattern);
  return match?.[1];
}
