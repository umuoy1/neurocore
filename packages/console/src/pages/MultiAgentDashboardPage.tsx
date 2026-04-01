import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import type { AgentDescriptor } from "../api/types";

export function MultiAgentDashboardPage() {
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ agents: AgentDescriptor[] }>("/v1/agents").then((res) => {
      setAgents(res.agents ?? []);
    }).catch(() => {});
    const id = setInterval(() => {
      apiFetch<{ agents: AgentDescriptor[] }>("/v1/agents").then((res) => setAgents(res.agents ?? [])).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, []);

  const agent = agents.find((a) => a.agent_id === selectedAgent);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-zinc-200">Multi-Agent Dashboard</h2>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Agent Registry</h3>
          {agents.length === 0 ? (
            <div className="text-zinc-600 text-xs py-4 text-center">No agents registered</div>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {agents.map((a) => {
                const loadPct = a.max_capacity > 0 ? (a.current_load / a.max_capacity) * 100 : 0;
                const loadColor = loadPct < 70 ? "bg-emerald-500" : loadPct < 90 ? "bg-amber-500" : "bg-red-500";
                const statusColor = a.status === "active" ? "bg-emerald-500" : a.status === "busy" ? "bg-amber-500" : "bg-zinc-500";
                return (
                  <button
                    key={a.agent_id}
                    onClick={() => setSelectedAgent(a.agent_id)}
                    className={`w-full text-left p-2 rounded text-xs ${
                      selectedAgent === a.agent_id ? "bg-zinc-800" : "hover:bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} />
                        <span className="text-zinc-300 font-medium">{a.name}</span>
                      </div>
                      <span className="text-[10px] text-zinc-500">{a.instance_id.slice(0, 8)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full ${loadColor} rounded-full`} style={{ width: `${loadPct}%` }} />
                      </div>
                      <span className="text-[10px] text-zinc-500">{a.current_load}/{a.max_capacity}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="col-span-2 space-y-4">
          {agent ? (
            <>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">{agent.name}</h3>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-zinc-500">Agent ID</span>
                    <div className="text-zinc-300 font-mono mt-0.5">{agent.agent_id}</div>
                  </div>
                  <div>
                    <span className="text-zinc-500">Instance</span>
                    <div className="text-zinc-300 font-mono mt-0.5">{agent.instance_id}</div>
                  </div>
                  <div>
                    <span className="text-zinc-500">Status</span>
                    <div className="text-zinc-300 mt-0.5">{agent.status}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Capabilities</h3>
                <div className="grid grid-cols-2 gap-2">
                  {agent.capabilities.map((cap) => (
                    <div key={cap.name} className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-300 flex-1">{cap.name}</span>
                      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${cap.proficiency * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-zinc-500 w-6 text-right">{(cap.proficiency * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-xs">
              Select an agent to view details
            </div>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Delegations</h3>
            <div className="text-zinc-600 text-xs py-4 text-center">
              Delegation tracking requires backend endpoint (GET /v1/delegations)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
