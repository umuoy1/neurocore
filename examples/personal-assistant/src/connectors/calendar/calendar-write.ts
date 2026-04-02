import type { Tool } from "@neurocore/protocol";
import type { CalendarWriteProvider } from "../types.js";

export function createCalendarWriteTool(provider: CalendarWriteProvider): Tool {
  return {
    name: "calendar_write",
    description: "Create an event in the configured calendar provider.",
    sideEffectLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start_time: { type: "string" },
        end_time: { type: "string" },
        location: { type: "string" },
        attendees: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["title", "start_time", "end_time"]
    },
    outputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" }
      }
    },
    async invoke(input) {
      const result = await provider.write({
        title: typeof input.title === "string" ? input.title : "",
        start_time: typeof input.start_time === "string" ? input.start_time : "",
        end_time: typeof input.end_time === "string" ? input.end_time : "",
        location: typeof input.location === "string" ? input.location : undefined,
        attendees: Array.isArray(input.attendees)
          ? input.attendees.filter((item): item is string => typeof item === "string")
          : undefined
      });

      return {
        summary: `Created calendar event ${result.event_id}.`,
        payload: result
      };
    }
  };
}
