import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { Episode, SemanticMemoryRecord, SkillDefinition, WorkingMemoryRecord } from "../api/types";

interface MemoryState {
  activeLayer: "working" | "episodic" | "semantic" | "procedural";
  workingMemory: WorkingMemoryRecord[];
  episodes: Episode[];
  semanticMemory: SemanticMemoryRecord[];
  skills: SkillDefinition[];
  searchQuery: string;
  setActiveLayer: (layer: MemoryState["activeLayer"]) => void;
  setSearchQuery: (q: string) => void;
  fetchWorkingMemory: (sessionId: string) => Promise<void>;
  fetchEpisodes: (sessionId: string) => Promise<void>;
  fetchSemanticMemory: (sessionId: string) => Promise<void>;
  fetchSkills: (sessionId: string) => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  activeLayer: "working",
  workingMemory: [],
  episodes: [],
  semanticMemory: [],
  skills: [],
  searchQuery: "",

  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  fetchWorkingMemory: async (sessionId) => {
    try {
      const res = await apiFetch<{ working_memory: WorkingMemoryRecord[] }>(`/v1/sessions/${sessionId}/memory`);
      set({ workingMemory: res.working_memory ?? [] });
    } catch { set({ workingMemory: [] }); }
  },

  fetchEpisodes: async (sessionId) => {
    try {
      const res = await apiFetch<{ episodes: Episode[] }>(`/v1/sessions/${sessionId}/episodes`);
      set({ episodes: res.episodes });
    } catch { set({ episodes: [] }); }
  },

  fetchSemanticMemory: async (sessionId) => {
    try {
      const res = await apiFetch<{ semantic_memory: SemanticMemoryRecord[] }>(`/v1/sessions/${sessionId}/memory/semantic`);
      set({ semanticMemory: res.semantic_memory ?? [] });
    } catch { set({ semanticMemory: [] }); }
  },

  fetchSkills: async (sessionId) => {
    try {
      const res = await apiFetch<{ skills: SkillDefinition[] }>(`/v1/sessions/${sessionId}/skills`);
      set({ skills: res.skills ?? [] });
    } catch { set({ skills: [] }); }
  },
}));
