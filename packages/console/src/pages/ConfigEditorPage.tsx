import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";

interface AgentProfileSummary {
  agent_id: string;
  name: string;
  description?: string;
  updated_at?: string;
}

interface PolicyTemplate {
  policy_id: string;
  name: string;
  description?: string;
  level?: string;
  updated_at?: string;
}

export function ConfigEditorPage() {
  const [tab, setTab] = useState<"profiles" | "policies" | "keys">("profiles");
  const [profiles, setProfiles] = useState<AgentProfileSummary[]>([]);
  const [policies, setPolicies] = useState<PolicyTemplate[]>([]);
  const [profileJson, setProfileJson] = useState<string>("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ key_id: string; name: string; created_at: string; last_used_at?: string }[]>([]);

  useEffect(() => {
    apiFetch<{ profiles: AgentProfileSummary[] }>("/v1/agents").then((res) => {
      const list = res.profiles ?? [];
      setProfiles(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch<{ policies: PolicyTemplate[] }>("/v1/policies").then((res) => {
      setPolicies(res.policies ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch<{ keys: { key_id: string; name: string; created_at: string; last_used_at?: string }[] }>("/v1/api-keys").then((res) => {
      setKeys(res.keys ?? []);
    }).catch(() => {});
  }, []);

  const loadProfile = async (agentId: string) => {
    try {
      const res = await apiFetch<Record<string, unknown>>(`/v1/agents/${agentId}/profile`);
      setProfileJson(JSON.stringify(res, null, 2));
      setSelectedProfileId(agentId);
    } catch { setProfileJson("{}"); }
  };

  const saveProfile = async () => {
    if (!selectedProfileId) return;
    try {
      await apiFetch(`/v1/agents/${selectedProfileId}/profile`, {
        method: "PUT",
        body: profileJson,
      });
    } catch {}
  };

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-zinc-200">Configuration</h2>

      <div className="flex gap-1">
        {(["profiles", "policies", "keys"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded text-xs capitalize ${tab === t ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {t === "profiles" ? "Agent Profiles" : t === "policies" ? "Policy Templates" : "API Keys"}
          </button>
        ))}
      </div>

      {tab === "profiles" && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 max-h-[600px] overflow-y-auto">
            {profiles.length === 0 ? (
              <div className="text-zinc-600 text-xs py-4 text-center">No agents</div>
            ) : profiles.map((p) => (
              <button
                key={p.agent_id}
                onClick={() => loadProfile(p.agent_id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 ${
                  selectedProfileId === p.agent_id ? "bg-zinc-800 text-zinc-200" : "text-zinc-400 hover:bg-zinc-800/50"
                }`}
              >
                <div className="font-medium">{p.name || p.agent_id}</div>
                <div className="text-[10px] text-zinc-600">{p.agent_id.slice(0, 12)}</div>
              </button>
            ))}
          </div>
          <div className="col-span-9 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            {selectedProfileId ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-400">Profile: {selectedProfileId}</span>
                  <button onClick={saveProfile} className="px-3 py-1 rounded text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">
                    Save
                  </button>
                </div>
                <textarea
                  value={profileJson}
                  onChange={(e) => setProfileJson(e.target.value)}
                  className="w-full h-[500px] bg-zinc-950 border border-zinc-800 rounded p-3 font-mono text-xs text-zinc-300 resize-none"
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="text-zinc-600 text-xs py-8 text-center">Select an agent to edit its profile</div>
            )}
          </div>
        </div>
      )}

      {tab === "policies" && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-900/50 text-zinc-500 text-left">
                <th className="py-2 px-3 font-medium">Policy ID</th>
                <th className="py-2 px-3 font-medium">Name</th>
                <th className="py-2 px-3 font-medium">Level</th>
                <th className="py-2 px-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-zinc-600">No policies</td></tr>
              ) : policies.map((p) => (
                <tr key={p.policy_id} className="border-t border-zinc-800/50">
                  <td className="py-2 px-3 font-mono text-zinc-400">{p.policy_id.slice(0, 12)}</td>
                  <td className="py-2 px-3 text-zinc-300">{p.name}</td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      p.level === "block" ? "bg-red-500/10 text-red-400" :
                      p.level === "warn" ? "bg-amber-500/10 text-amber-400" :
                      "bg-blue-500/10 text-blue-400"
                    }`}>{p.level ?? "info"}</span>
                  </td>
                  <td className="py-2 px-3 text-zinc-500">{p.description ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "keys" && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-900/50 text-zinc-500 text-left">
                <th className="py-2 px-3 font-medium">Key ID</th>
                <th className="py-2 px-3 font-medium">Name</th>
                <th className="py-2 px-3 font-medium">Created</th>
                <th className="py-2 px-3 font-medium">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-zinc-600">No API keys</td></tr>
              ) : keys.map((k) => (
                <tr key={k.key_id} className="border-t border-zinc-800/50">
                  <td className="py-2 px-3 font-mono text-zinc-400">{k.key_id.slice(0, 12)}</td>
                  <td className="py-2 px-3 text-zinc-300">{k.name}</td>
                  <td className="py-2 px-3 text-zinc-500">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="py-2 px-3 text-zinc-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
