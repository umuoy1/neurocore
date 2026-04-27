import { create } from "zustand";
import { apiFetch } from "../api/client";
import type { CanvasArtifact, CanvasPreview } from "../api/types";

export interface CanvasArtifactDraft {
  artifact_id: string;
  title: string;
  owner_id: string;
  permission_scope: string;
  html: string;
}

interface PersonalAssistantCanvasState {
  artifacts: CanvasArtifact[];
  selectedArtifactId: string;
  selectedArtifact: CanvasArtifact | null;
  preview: CanvasPreview | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  draft: CanvasArtifactDraft;
  setSelectedArtifactId: (artifactId: string) => void;
  setDraft: (draft: Partial<CanvasArtifactDraft>) => void;
  load: () => Promise<void>;
  inspect: (artifactId?: string) => Promise<void>;
  createArtifact: () => Promise<void>;
  updateArtifact: () => Promise<void>;
  rollbackArtifact: (versionNo: number) => Promise<void>;
  previewArtifact: (artifactId?: string) => Promise<void>;
}

type CanvasListResponse = { artifacts: CanvasArtifact[] } | { result: { artifacts: CanvasArtifact[] } };
type CanvasInspectResponse = CanvasArtifact | { artifact: CanvasArtifact };
type CanvasMutationResponse = { artifact: CanvasArtifact; preview?: CanvasPreview };
type CanvasPreviewResponse = CanvasPreview | { preview: CanvasPreview };

const initialDraft: CanvasArtifactDraft = {
  artifact_id: "",
  title: "Untitled Canvas",
  owner_id: "console",
  permission_scope: "private",
  html: "<main><h1>Canvas</h1><p>Draft artifact</p></main>"
};

export const usePersonalAssistantCanvasStore = create<PersonalAssistantCanvasState>((set, get) => ({
  artifacts: [],
  selectedArtifactId: "",
  selectedArtifact: null,
  preview: null,
  loading: false,
  mutating: false,
  error: null,
  draft: initialDraft,

  setSelectedArtifactId: (artifactId) => set({ selectedArtifactId: artifactId }),

  setDraft: (draft) => set({ draft: { ...get().draft, ...draft } }),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiFetch<CanvasListResponse>("/v1/personal-assistant/canvas");
      const artifacts = normalizeList(response);
      const selectedArtifactId = get().selectedArtifactId || artifacts[0]?.artifact_id || "";
      set({ artifacts, selectedArtifactId });
      if (selectedArtifactId) {
        await get().inspect(selectedArtifactId);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  inspect: async (artifactId) => {
    const target = artifactId || get().selectedArtifactId;
    if (!target) return;
    set({ error: null });
    try {
      const response = await apiFetch<CanvasInspectResponse>(`/v1/personal-assistant/canvas/${encodeURIComponent(target)}`);
      const artifact = normalizeInspect(response);
      set({ selectedArtifactId: artifact.artifact_id, selectedArtifact: artifact });
      await get().previewArtifact(artifact.artifact_id);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  createArtifact: async () => {
    const draft = get().draft;
    set({ mutating: true, error: null });
    try {
      const response = await apiFetch<CanvasMutationResponse>("/v1/personal-assistant/canvas", {
        method: "POST",
        body: JSON.stringify(compact({ ...draft }))
      });
      set({
        selectedArtifactId: response.artifact.artifact_id,
        selectedArtifact: response.artifact,
        preview: response.preview ?? null
      });
      await get().load();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ mutating: false });
    }
  },

  updateArtifact: async () => {
    const artifactId = get().selectedArtifactId;
    if (!artifactId) return;
    const draft = get().draft;
    set({ mutating: true, error: null });
    try {
      const response = await apiFetch<CanvasMutationResponse>(`/v1/personal-assistant/canvas/${encodeURIComponent(artifactId)}`, {
        method: "PATCH",
        body: JSON.stringify(compact({
          title: draft.title,
          html: draft.html
        }))
      });
      set({ selectedArtifact: response.artifact, preview: response.preview ?? null });
      await get().load();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ mutating: false });
    }
  },

  rollbackArtifact: async (versionNo) => {
    const artifactId = get().selectedArtifactId;
    if (!artifactId) return;
    set({ mutating: true, error: null });
    try {
      const response = await apiFetch<CanvasMutationResponse>(`/v1/personal-assistant/canvas/${encodeURIComponent(artifactId)}/rollback`, {
        method: "POST",
        body: JSON.stringify({ target_version_no: versionNo })
      });
      set({ selectedArtifact: response.artifact, preview: response.preview ?? null });
      await get().load();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ mutating: false });
    }
  },

  previewArtifact: async (artifactId) => {
    const target = artifactId || get().selectedArtifactId;
    if (!target) return;
    set({ error: null });
    try {
      const response = await apiFetch<CanvasPreviewResponse>(`/v1/personal-assistant/canvas/${encodeURIComponent(target)}/preview`);
      set({ preview: normalizePreview(response) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  }
}));

function normalizeList(response: CanvasListResponse): CanvasArtifact[] {
  if ("result" in response) return response.result.artifacts;
  return response.artifacts;
}

function normalizeInspect(response: CanvasInspectResponse): CanvasArtifact {
  if ("artifact" in response) return response.artifact;
  return response;
}

function normalizePreview(response: CanvasPreviewResponse): CanvasPreview {
  if ("preview" in response) return response.preview;
  return response;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}
