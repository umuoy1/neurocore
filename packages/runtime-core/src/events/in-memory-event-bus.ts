import type { NeuroCoreEvent } from "@neurocore/protocol";

type EventListener = (event: NeuroCoreEvent) => void;

export class InMemoryEventBus {
  private readonly eventsBySession = new Map<string, NeuroCoreEvent[]>();
  private readonly listenersBySession = new Map<string, Set<EventListener>>();

  public append(event: NeuroCoreEvent): void {
    const sessionId = event.session_id;
    if (!sessionId) {
      return;
    }

    const events = this.eventsBySession.get(sessionId) ?? [];
    const snapshot = structuredClone(event);
    events.push(snapshot);
    this.eventsBySession.set(sessionId, events);

    for (const listener of this.listenersBySession.get(sessionId) ?? []) {
      listener(structuredClone(snapshot));
    }
  }

  public list(sessionId: string): NeuroCoreEvent[] {
    return structuredClone(this.eventsBySession.get(sessionId) ?? []);
  }

  public replaceSession(sessionId: string, events: NeuroCoreEvent[]): void {
    this.eventsBySession.set(sessionId, structuredClone(events));
  }

  public deleteSession(sessionId: string): void {
    this.eventsBySession.delete(sessionId);
    this.listenersBySession.delete(sessionId);
  }

  public subscribe(sessionId: string, listener: EventListener): () => void {
    const listeners = this.listenersBySession.get(sessionId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listenersBySession.set(sessionId, listeners);

    return () => {
      const current = this.listenersBySession.get(sessionId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listenersBySession.delete(sessionId);
      }
    };
  }
}
