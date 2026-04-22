import { create } from "zustand";
import { apiFetch } from "../api/client";

interface AuthProfile {
  tenant_id: string;
  api_key_id: string;
  permissions: string[];
  role?: string | null;
}

interface AuthState {
  apiKey: string | null;
  tenantId: string | null;
  apiKeyId: string | null;
  permissions: string[];
  role: string | null;
  isAuthenticated: boolean;
  initializing: boolean;
  login: (apiKey: string) => Promise<void>;
  bootstrap: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  apiKey: null,
  tenantId: null,
  apiKeyId: null,
  permissions: [],
  role: null,
  isAuthenticated: false,
  initializing: false,

  login: async (apiKey: string) => {
    set({ initializing: true });
    const res = await fetch("/v1/auth/me", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      set({ initializing: false });
      throw new Error("Invalid API key");
    }
    const body = await res.json() as AuthProfile;
    set({
      apiKey,
      tenantId: body.tenant_id,
      apiKeyId: body.api_key_id,
      permissions: body.permissions ?? [],
      role: body.role ?? null,
      isAuthenticated: true,
      initializing: false
    });
    if (typeof window !== "undefined") {
      localStorage.setItem("nc_api_key", apiKey);
    }
  },

  bootstrap: async () => {
    if (typeof window === "undefined") {
      return;
    }
    const key = localStorage.getItem("nc_api_key");
    if (!key) {
      set({ initializing: false });
      return;
    }
    set({ initializing: true });
    try {
      const profile = await apiFetch<AuthProfile>("/v1/auth/me", {
        headers: {
          authorization: `Bearer ${key}`
        }
      });
      set({
        apiKey: key,
        tenantId: profile.tenant_id,
        apiKeyId: profile.api_key_id,
        permissions: profile.permissions ?? [],
        role: profile.role ?? null,
        isAuthenticated: true,
        initializing: false
      });
    } catch {
      localStorage.removeItem("nc_api_key");
      set({
        apiKey: null,
        tenantId: null,
        apiKeyId: null,
        permissions: [],
        role: null,
        isAuthenticated: false,
        initializing: false
      });
    }
  },

  logout: () => {
    set({
      apiKey: null,
      tenantId: null,
      apiKeyId: null,
      permissions: [],
      role: null,
      isAuthenticated: false,
      initializing: false
    });
    if (typeof window !== "undefined") {
      localStorage.removeItem("nc_api_key");
    }
  },
}));

export function initAuth() {
  void useAuthStore.getState().bootstrap();
}
