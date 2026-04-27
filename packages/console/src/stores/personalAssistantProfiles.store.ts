import { create } from "zustand";
import { apiFetch } from "../api/client";
import type {
  PersonalAssistantProfile,
  PersonalAssistantProfileBinding,
  PersonalAssistantProfileInspect,
  PersonalAssistantProfileIsolationViolation,
  PersonalAssistantProfileList
} from "../api/types";

export interface PersonalAssistantProfileDraft {
  profile_id: string;
  display_name: string;
  memory_scope: string;
  tool_scope: string;
  policy_scope: string;
  default_workspace_id: string;
}

export interface PersonalAssistantProfileRouteDraft {
  actor_id: string;
  user_id: string;
  platform: string;
  chat_id: string;
  channel_kind: string;
  workspace_id: string;
}

interface PersonalAssistantProfilesState {
  profiles: PersonalAssistantProfile[];
  selectedProfileId: string;
  selectedProfile: PersonalAssistantProfile | null;
  bindings: PersonalAssistantProfileBinding[];
  isolation: PersonalAssistantProfileIsolationViolation[];
  loading: boolean;
  mutating: boolean;
  error: string | null;
  draft: PersonalAssistantProfileDraft;
  routeDraft: PersonalAssistantProfileRouteDraft;
  setSelectedProfileId: (profileId: string) => void;
  setDraft: (draft: Partial<PersonalAssistantProfileDraft>) => void;
  setRouteDraft: (draft: Partial<PersonalAssistantProfileRouteDraft>) => void;
  load: () => Promise<void>;
  inspect: (profileId?: string) => Promise<void>;
  createProfile: () => Promise<void>;
  switchProfile: (profileId?: string) => Promise<void>;
}

type ProfileListResponse = PersonalAssistantProfileList | { result: PersonalAssistantProfileList };
type ProfileInspectResponse = PersonalAssistantProfileInspect | { result: PersonalAssistantProfileInspect };
type ProfileCreateResponse = PersonalAssistantProfile | { profile: PersonalAssistantProfile };
type ProfileSwitchResponse = PersonalAssistantProfileBinding | { binding: PersonalAssistantProfileBinding };

const initialDraft: PersonalAssistantProfileDraft = {
  profile_id: "",
  display_name: "",
  memory_scope: "",
  tool_scope: "",
  policy_scope: "",
  default_workspace_id: ""
};

const initialRouteDraft: PersonalAssistantProfileRouteDraft = {
  actor_id: "console",
  user_id: "",
  platform: "web",
  chat_id: "",
  channel_kind: "web_chat",
  workspace_id: ""
};

export const usePersonalAssistantProfilesStore = create<PersonalAssistantProfilesState>((set, get) => ({
  profiles: [],
  selectedProfileId: "",
  selectedProfile: null,
  bindings: [],
  isolation: [],
  loading: false,
  mutating: false,
  error: null,
  draft: initialDraft,
  routeDraft: initialRouteDraft,

  setSelectedProfileId: (profileId) => set({ selectedProfileId: profileId }),

  setDraft: (draft) => set({ draft: { ...get().draft, ...draft } }),

  setRouteDraft: (draft) => set({ routeDraft: { ...get().routeDraft, ...draft } }),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiFetch<ProfileListResponse>("/v1/personal-assistant/profiles");
      const result = normalizeProfileList(response);
      const selectedProfileId = get().selectedProfileId || result.profiles[0]?.profile_id || "";
      set({
        profiles: result.profiles,
        isolation: result.isolation,
        selectedProfileId
      });
      if (selectedProfileId) {
        await get().inspect(selectedProfileId);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  inspect: async (profileId) => {
    const targetProfileId = profileId || get().selectedProfileId;
    if (!targetProfileId) return;
    set({ error: null });
    try {
      const response = await apiFetch<ProfileInspectResponse>(`/v1/personal-assistant/profiles/${encodeURIComponent(targetProfileId)}`);
      const result = normalizeProfileInspect(response);
      set({
        selectedProfileId: result.profile.profile_id,
        selectedProfile: result.profile,
        bindings: result.bindings,
        isolation: result.isolation
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  createProfile: async () => {
    const draft = get().draft;
    if (!draft.profile_id.trim()) return;
    set({ mutating: true, error: null });
    try {
      const response = await apiFetch<ProfileCreateResponse>("/v1/personal-assistant/profiles", {
        method: "POST",
        body: JSON.stringify(compact({
          profile_id: draft.profile_id,
          actor_id: get().routeDraft.actor_id || "console",
          display_name: draft.display_name,
          memory_scope: draft.memory_scope,
          tool_scope: draft.tool_scope,
          policy_scope: draft.policy_scope,
          default_workspace_id: draft.default_workspace_id
        })),
      });
      const profile = normalizeProfileCreate(response);
      set({ selectedProfileId: profile.profile_id, draft: initialDraft });
      await get().load();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ mutating: false });
    }
  },

  switchProfile: async (profileId) => {
    const targetProfileId = profileId || get().selectedProfileId;
    const routeDraft = get().routeDraft;
    if (!targetProfileId || !routeDraft.user_id.trim()) return;
    set({ mutating: true, error: null });
    try {
      await apiFetch<ProfileSwitchResponse>(`/v1/personal-assistant/profiles/${encodeURIComponent(targetProfileId)}/switch`, {
        method: "POST",
        body: JSON.stringify(compact({
          profile_id: targetProfileId,
          actor_id: routeDraft.actor_id || "console",
          user_id: routeDraft.user_id,
          platform: routeDraft.platform,
          chat_id: routeDraft.chat_id,
          channel_kind: routeDraft.channel_kind,
          workspace_id: routeDraft.workspace_id
        })),
      });
      await get().inspect(targetProfileId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ mutating: false });
    }
  },
}));

function normalizeProfileList(response: ProfileListResponse): PersonalAssistantProfileList {
  return "result" in response ? response.result : response;
}

function normalizeProfileInspect(response: ProfileInspectResponse): PersonalAssistantProfileInspect {
  return "result" in response ? response.result : response;
}

function normalizeProfileCreate(response: ProfileCreateResponse): PersonalAssistantProfile {
  return "profile" in response ? response.profile : response;
}

function compact(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value.trim().length > 0));
}
