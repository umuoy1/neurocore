import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { PersonalAssistantGovernanceSnapshot } from "../api/types";

interface PersonalAssistantGovernanceState {
  snapshot: PersonalAssistantGovernanceSnapshot | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  approveApproval: (approvalId: string, actorId: string) => Promise<void>;
  rejectApproval: (approvalId: string, actorId: string) => Promise<void>;
  pauseSchedule: (scheduleId: string, actorId: string) => Promise<void>;
  resumeSchedule: (scheduleId: string, actorId: string) => Promise<void>;
  cancelBackgroundTask: (taskId: string, actorId: string) => Promise<void>;
  pauseChildAgent: (childAgentId: string, actorId: string) => Promise<void>;
  resumeChildAgent: (childAgentId: string, actorId: string) => Promise<void>;
  cancelChildAgent: (childAgentId: string, actorId: string) => Promise<void>;
}

type GovernanceResponse = PersonalAssistantGovernanceSnapshot | { snapshot: PersonalAssistantGovernanceSnapshot };

export const usePersonalAssistantGovernanceStore = create<PersonalAssistantGovernanceState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiFetch<GovernanceResponse>("/v1/personal-assistant/governance");
      set({ snapshot: normalizeSnapshot(response) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  approveApproval: async (approvalId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/approvals/${approvalId}/approve`, actorId, set, get);
  },

  rejectApproval: async (approvalId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/approvals/${approvalId}/reject`, actorId, set, get);
  },

  pauseSchedule: async (scheduleId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/schedules/${scheduleId}/pause`, actorId, set, get);
  },

  resumeSchedule: async (scheduleId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/schedules/${scheduleId}/resume`, actorId, set, get);
  },

  cancelBackgroundTask: async (taskId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/background-tasks/${taskId}/cancel`, actorId, set, get);
  },

  pauseChildAgent: async (childAgentId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/child-agents/${childAgentId}/pause`, actorId, set, get);
  },

  resumeChildAgent: async (childAgentId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/child-agents/${childAgentId}/resume`, actorId, set, get);
  },

  cancelChildAgent: async (childAgentId, actorId) => {
    await mutate(`/v1/personal-assistant/governance/child-agents/${childAgentId}/cancel`, actorId, set, get);
  },
}));

async function mutate(
  path: string,
  actorId: string,
  set: (partial: Partial<PersonalAssistantGovernanceState>) => void,
  get: () => PersonalAssistantGovernanceState
): Promise<void> {
  set({ error: null });
  try {
    const response = await apiFetch<GovernanceResponse>(path, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId }),
    });
    set({ snapshot: normalizeSnapshot(response) });
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
    await get().load();
  }
}

function normalizeSnapshot(response: GovernanceResponse): PersonalAssistantGovernanceSnapshot {
  return "snapshot" in response ? response.snapshot : response;
}
