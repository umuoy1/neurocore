import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { WorkingMemoryRecord, Episode } from "../api/types";

interface MemoryState {
  activeLayer: "working" | "episodic" | "semantic" | "procedural";
  workingMemory: WorkingMemoryRecord[];
  episodes: Episode[];
  searchQuery: string;
  setActiveLayer: (layer: MemoryState["activeLayer"]) => void;
  setSearchQuery: (q: string) => void;
  fetchWorkingMemory: (sessionId: string) => Promise<void>;
  fetchEpisodes: (sessionId: string) => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  activeLayer: "working",
  workingMemory: [],
  episodes: [],
  searchQuery: "",

  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  fetchWorkingMemory: async (sessionId) => {
    try {
      const res = await apiFetch<{ working_memory: WorkingMemoryRecord[] }>(`/v1/sessions/${sessionId}`);
      set({ workingMemory: res.working_memory ?? [] });
    } catch { set({ workingMemory: [] }); }
  },

  fetchEpisodes: async (sessionId) => {
    try {
      const res = await apiFetch<{ episodes: Episode[] }>(`/v1/sessions/${sessionId}/episodes`);
      set({ episodes: res.episodes });
    } catch { set({ episodes: [] }); }
  },
}));
