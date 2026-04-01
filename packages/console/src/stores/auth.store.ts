import { create } from "zustand";
interface AuthState {
  apiKey: string | null;
  tenantId: string | null;
  isAuthenticated: boolean;
  login: (apiKey: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  apiKey: null,
  tenantId: null,
  isAuthenticated: false,

  login: async (apiKey: string) => {
    const res = await fetch("/v1/healthz", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error("Invalid API key");
    const tenantId = `tenant_${apiKey.slice(-6)}`;
    set({ apiKey, tenantId, isAuthenticated: true });
    if (typeof window !== "undefined") {
      localStorage.setItem("nc_api_key", apiKey);
    }
  },

  logout: () => {
    set({ apiKey: null, tenantId: null, isAuthenticated: false });
    if (typeof window !== "undefined") {
      localStorage.removeItem("nc_api_key");
    }
  },
}));

export function initAuth() {
  const key = localStorage.getItem("nc_api_key");
  if (key) {
    useAuthStore.getState().login(key).catch(() => {
      useAuthStore.getState().logout();
    });
  }
}
