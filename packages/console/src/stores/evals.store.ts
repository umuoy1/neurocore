import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { EvalRunReport } from "../api/types";

interface EvalsState {
  runs: EvalRunReport[];
  currentRun: EvalRunReport | null;
  loading: boolean;
  fetchRuns: () => Promise<void>;
  fetchRun: (runId: string) => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
}

export const useEvalsStore = create<EvalsState>((set, get) => ({
  runs: [],
  currentRun: null,
  loading: false,

  fetchRuns: async () => {
    set({ loading: true });
    try {
      const res = await apiFetch<{ runs: EvalRunReport[] }>("/v1/evals/runs");
      set({ runs: res.runs });
    } finally { set({ loading: false }); }
  },

  fetchRun: async (runId) => {
    const run = await apiFetch<EvalRunReport>(`/v1/evals/runs/${runId}`);
    set({ currentRun: run });
  },

  deleteRun: async (runId) => {
    await apiFetch(`/v1/evals/runs/${runId}`, { method: "DELETE" });
    set({ runs: get().runs.filter((r) => r.run_id !== runId) });
  },
}));
