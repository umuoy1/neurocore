import type { Tool } from "@neurocore/protocol";
import type { CalendarEvent, CalendarReadProvider } from "../types.js";

export function createCalendarReadTool(provider: CalendarReadProvider): Tool {
  return {
    name: "calendar_read",
    description: "Read events from the configured calendar provider.",
    sideEffectLevel: "none",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" },
        max_results: { type: "number" }
      }
    },
    outputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: { type: "object" }
        }
      }
    },
    async invoke(input) {
      const result = await provider.read({
        start_date: typeof input.start_date === "string" ? input.start_date : undefined,
        end_date: typeof input.end_date === "string" ? input.end_date : undefined,
        max_results: typeof input.max_results === "number" ? input.max_results : undefined
      });

      return {
        summary: formatCalendarSummary(result.events),
        payload: { events: result.events.map(serializeCalendarEvent) }
      };
    }
  };
}

function serializeCalendarEvent(event: CalendarEvent): Record<string, string | string[]> {
  return {
    event_id: event.event_id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
    ...(event.location ? { location: event.location } : {}),
    ...(event.attendees ? { attendees: event.attendees } : {})
  };
}

function formatCalendarSummary(events: CalendarEvent[]): string {
  if (events.length === 0) {
    return "Read 0 calendar events.";
  }

  const lines = events.slice(0, 5).map((event, index) => {
    const parts = [
      `${index + 1}. ${event.title}`,
      `${event.start_time} -> ${event.end_time}`
    ];
    if (event.location) {
      parts.push(`location=${event.location}`);
    }
    return parts.join("; ");
  });

  return `Read ${events.length} calendar event${events.length === 1 ? "" : "s"}: ${lines.join(" | ")}`;
}
