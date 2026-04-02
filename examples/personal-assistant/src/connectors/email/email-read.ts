import type { Tool } from "@neurocore/protocol";
import type { EmailMessage, EmailReadProvider } from "../types.js";

export function createEmailReadTool(provider: EmailReadProvider): Tool {
  return {
    name: "email_read",
    description: "Read emails from the configured mailbox provider.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number" },
        unread_only: { type: "boolean" }
      }
    },
    outputSchema: {
      type: "object",
      properties: {
        emails: {
          type: "array",
          items: { type: "object" }
        }
      }
    },
    async invoke(input) {
      const result = await provider.read({
        query: typeof input.query === "string" ? input.query : undefined,
        max_results: typeof input.max_results === "number" ? input.max_results : undefined,
        unread_only: typeof input.unread_only === "boolean" ? input.unread_only : undefined
      });

      return {
        summary: formatEmailSummary(result.emails),
        payload: { emails: result.emails.map(serializeEmailMessage) }
      };
    }
  };
}

function serializeEmailMessage(message: EmailMessage): Record<string, string | boolean> {
  return {
    from: message.from,
    subject: message.subject,
    date: message.date,
    body_preview: message.body_preview,
    has_attachments: message.has_attachments
  };
}

function formatEmailSummary(emails: EmailMessage[]): string {
  if (emails.length === 0) {
    return "Read 0 emails.";
  }

  const lines = emails.slice(0, 5).map((email, index) =>
    `${index + 1}. from=${email.from}; subject=${email.subject}; date=${email.date}; preview=${email.body_preview}`
  );

  return `Read ${emails.length} email${emails.length === 1 ? "" : "s"}: ${lines.join(" | ")}`;
}
