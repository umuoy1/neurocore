import { create } from "zustand";
import { apiFetch } from "../api/client";
import type {
  DataSubjectExportBundle,
  DataSubjectRecordType,
  DataSubjectRetentionReport
} from "../api/types";

interface PersonalAssistantPrivacyState {
  userId: string;
  retention: DataSubjectRetentionReport | null;
  exportBundle: DataSubjectExportBundle | null;
  loading: boolean;
  error: string | null;
  setUserId: (userId: string) => void;
  loadRetention: (userId?: string) => Promise<void>;
  exportData: (actorId: string, types?: DataSubjectRecordType[]) => Promise<void>;
  freezeData: (actorId: string, types?: DataSubjectRecordType[]) => Promise<void>;
  deleteData: (actorId: string, types?: DataSubjectRecordType[]) => Promise<void>;
}

type RetentionResponse = DataSubjectRetentionReport | { retention: DataSubjectRetentionReport };
type ExportResponse = DataSubjectExportBundle | { export: DataSubjectExportBundle };

export const usePersonalAssistantPrivacyStore = create<PersonalAssistantPrivacyState>((set, get) => ({
  userId: "",
  retention: null,
  exportBundle: null,
  loading: false,
  error: null,

  setUserId: (userId) => set({ userId }),

  loadRetention: async (userId) => {
    const targetUserId = (userId ?? get().userId).trim();
    if (!targetUserId) return;
    set({ loading: true, error: null });
    try {
      const response = await apiFetch<RetentionResponse>(`/v1/personal-assistant/privacy/users/${encodeURIComponent(targetUserId)}/retention`);
      set({ retention: normalizeRetention(response), userId: targetUserId });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  exportData: async (actorId, types) => {
    const targetUserId = get().userId.trim();
    if (!targetUserId) return;
    set({ loading: true, error: null });
    try {
      const response = await apiFetch<ExportResponse>(`/v1/personal-assistant/privacy/users/${encodeURIComponent(targetUserId)}/export`, {
        method: "POST",
        body: JSON.stringify({ actor_id: actorId, types }),
      });
      const exportBundle = normalizeExport(response);
      set({ exportBundle, retention: exportBundle.retention });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  freezeData: async (actorId, types) => {
    await mutatePrivacy(`/v1/personal-assistant/privacy/users/${encodeURIComponent(get().userId.trim())}/freeze`, actorId, types, set, get);
  },

  deleteData: async (actorId, types) => {
    await mutatePrivacy(`/v1/personal-assistant/privacy/users/${encodeURIComponent(get().userId.trim())}/delete`, actorId, types, set, get);
  },
}));

async function mutatePrivacy(
  path: string,
  actorId: string,
  types: DataSubjectRecordType[] | undefined,
  set: (partial: Partial<PersonalAssistantPrivacyState>) => void,
  get: () => PersonalAssistantPrivacyState
): Promise<void> {
  if (!get().userId.trim()) return;
  set({ loading: true, error: null });
  try {
    const response = await apiFetch<RetentionResponse>(path, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, types }),
    });
    set({ retention: normalizeRetention(response) });
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    set({ loading: false });
  }
}

function normalizeRetention(response: RetentionResponse): DataSubjectRetentionReport {
  return "retention" in response ? response.retention : response;
}

function normalizeExport(response: ExportResponse): DataSubjectExportBundle {
  return "export" in response ? response.export : response;
}
