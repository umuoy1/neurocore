import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { AgentSession, NeuroCoreEvent, Goal, WorkingMemoryRecord } from "../api/types";

interface SessionListItem {
  session_id: string;
  agent_id: string;
  session: AgentSession;
  active_run: boolean;
}

interface SessionsState {
  sessions: SessionListItem[];
  total: number;
  filters: { state?: string; agent_id?: string };
  loading: boolean;
  currentSession: {
    session_id: string;
    session: AgentSession;
    goals: Goal[];
    workingMemory: WorkingMemoryRecord[];
    events: NeuroCoreEvent[];
    traceCount: number;
    episodeCount: number;
    activeRun: boolean;
  } | null;
  fetchSessions: (filters?: { state?: string; agent_id?: string }) => Promise<void>;
  fetchSessionDetail: (sessionId: string) => Promise<void>;
  createSession: (agentId: string, payload: Record<string, unknown>) => Promise<string>;
  cancelSession: (sessionId: string) => Promise<void>;
  sendInput: (sessionId: string, content: string) => Promise<void>;
  onSessionEvent: (event: NeuroCoreEvent) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  total: 0,
  filters: {},
  loading: false,
  currentSession: null,

  fetchSessions: async (filters) => {
    set({ loading: true, filters: filters ?? get().filters });
    try {
      const params = new URLSearchParams();
      const f = filters ?? get().filters;
      if (f.state) params.set("state", f.state);
      if (f.agent_id) params.set("agent_id", f.agent_id);
      const res = await apiFetch<{ sessions: SessionListItem[]; total: number }>(`/v1/sessions?${params}`);
      set({ sessions: res.sessions, total: res.total });
    } finally {
      set({ loading: false });
    }
  },

  fetchSessionDetail: async (sessionId: string) => {
    const data = await apiFetch<{
      session: AgentSession;
      trace_count: number;
      episode_count: number;
      active_run: boolean;
    }>(`/v1/sessions/${sessionId}`);

    const [eventsRes] = await Promise.all([
      apiFetch<{ events: NeuroCoreEvent[] }>(`/v1/sessions/${sessionId}/events`).catch(() => ({ events: [] })),
      apiFetch<{ traces: unknown[] }>(`/v1/sessions/${sessionId}/traces`).catch(() => ({ traces: [] })),
      apiFetch<{ episodes: unknown[] }>(`/v1/sessions/${sessionId}/episodes`).catch(() => ({ episodes: [] })),
    ]);

    set({
      currentSession: {
        session_id: sessionId,
        session: data.session,
        goals: [],
        workingMemory: [],
        events: eventsRes.events,
        traceCount: data.trace_count,
        episodeCount: data.episode_count,
        activeRun: data.active_run,
      },
    });
  },

  createSession: async (agentId, payload) => {
    const res = await apiFetch<{ session_id: string; session: AgentSession }>("/v1/agents/{agentId}/sessions".replace("{agentId}", agentId), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.session_id;
  },

  cancelSession: async (sessionId) => {
    await apiFetch(`/v1/sessions/${sessionId}/cancel`, { method: "POST" });
  },

  sendInput: async (sessionId, content) => {
    await apiFetch(`/v1/sessions/${sessionId}/inputs`, {
      method: "POST",
      body: JSON.stringify({ input: { content } }),
    });
  },

  onSessionEvent: (event) => {
    const { currentSession, sessions } = get();
    if (currentSession && event.session_id === currentSession.session_id) {
      set({
        currentSession: {
          ...currentSession,
          events: [...currentSession.events.slice(-99), event],
        },
      });
    }
    if (event.event_type === "session.created") {
      const idx = sessions.findIndex((s) => s.session_id === event.session_id);
      if (idx === -1) {
        set({ sessions: [event.payload as SessionListItem, ...sessions] });
      }
    }
    if (event.event_type === "session.state_changed") {
      set({
        sessions: sessions.map((s) =>
          s.session_id === event.session_id
            ? { ...s, session: event.payload as AgentSession }
            : s
        ),
      });
    }
  },
}));
