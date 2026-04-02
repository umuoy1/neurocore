import type { Tool } from "@neurocore/protocol";
import type { EmailSendProvider } from "../types.js";

export function createEmailSendTool(provider: EmailSendProvider): Tool {
  return {
    name: "email_send",
    description: "Send an email through the configured mailbox provider.",
    sideEffectLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" }
        },
        subject: { type: "string" },
        body: { type: "string" },
        cc: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["to", "subject", "body"]
    },
    outputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string" },
        sent_at: { type: "string" }
      }
    },
    async invoke(input) {
      const result = await provider.send({
        to: Array.isArray(input.to) ? input.to.filter((item): item is string => typeof item === "string") : [],
        subject: typeof input.subject === "string" ? input.subject : "",
        body: typeof input.body === "string" ? input.body : "",
        cc: Array.isArray(input.cc) ? input.cc.filter((item): item is string => typeof item === "string") : undefined
      });

      return {
        summary: `Email sent with id ${result.message_id}.`,
        payload: result
      };
    }
  };
}
