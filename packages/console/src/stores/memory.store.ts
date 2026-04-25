import { create } from "zustand";
import { apiFetch } from "../api/client";
import type {
  Episode,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  SemanticMemoryRecord,
  SkillDefinition,
  WorkingMemoryRecord
} from "../api/types";

interface MemoryState {
  activeLayer: "observability" | "working" | "episodic" | "semantic" | "procedural";
  workingMemory: WorkingMemoryRecord[];
  episodes: Episode[];
  semanticMemory: SemanticMemoryRecord[];
  skills: SkillDefinition[];
  retrievalPlans: MemoryRetrievalPlan[];
  recallBundles: MemoryRecallBundle[];
  latestRetrievalPlan: MemoryRetrievalPlan | null;
  latestRecallBundle: MemoryRecallBundle | null;
  memoryWarnings: MemoryWarning[];
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
  retrievalPlans: [],
  recallBundles: [],
  latestRetrievalPlan: null,
  latestRecallBundle: null,
  memoryWarnings: [],
  searchQuery: "",

  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  fetchWorkingMemory: async (sessionId) => {
    try {
      const res = await apiFetch<{
        working_memory: WorkingMemoryRecord[];
        retrieval_plans?: MemoryRetrievalPlan[];
        recall_bundles?: MemoryRecallBundle[];
        latest_retrieval_plan?: MemoryRetrievalPlan | null;
        latest_recall_bundle?: MemoryRecallBundle | null;
        memory_warnings?: MemoryWarning[];
      }>(`/v1/sessions/${sessionId}/memory`);
      set({
        workingMemory: res.working_memory ?? [],
        retrievalPlans: res.retrieval_plans ?? [],
        recallBundles: res.recall_bundles ?? [],
        latestRetrievalPlan: res.latest_retrieval_plan ?? null,
        latestRecallBundle: res.latest_recall_bundle ?? null,
        memoryWarnings: res.memory_warnings ?? []
      });
    } catch {
      set({
        workingMemory: [],
        retrievalPlans: [],
        recallBundles: [],
        latestRetrievalPlan: null,
        latestRecallBundle: null,
        memoryWarnings: []
      });
    }
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
