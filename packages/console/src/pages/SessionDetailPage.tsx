import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useSessionsStore } from "../stores/sessions.store";
import { useWebSocket } from "../hooks/useWebSocket";
import type { NeuroCoreEvent } from "../api/types";

const WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/v1/ws`;

const STATE_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  completed: "bg-emerald-500",
  waiting: "bg-amber-500",
  failed: "bg-red-500",
  suspended: "bg-zinc-500",
  escalated: "bg-orange-500",
  hydrated: "bg-violet-500",
  created: "bg-zinc-400",
  aborted: "bg-red-400",
};

const GOAL_COLORS: Record<string, string> = {
  active: "text-blue-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
  pending: "text-zinc-400",
  blocked: "text-orange-400",
  waiting_input: "text-amber-400",
};

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { currentSession, fetchSessionDetail, cancelSession, sendInput, onSessionEvent } = useSessionsStore();
  const { connected, subscribe } = useWebSocket(WS_URL);
  const [liveEvents, setLiveEvents] = useState<NeuroCoreEvent[]>([]);
  const [inputText, setInputText] = useState("");
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetchSessionDetail(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !connected) return;
    const unsub = subscribe(`session:${sessionId}`, (msg) => {
      const ev = msg.payload as NeuroCoreEvent;
      if (ev) {
        onSessionEvent(ev);
        setLiveEvents((prev) => [...prev.slice(-49), ev]);
      }
    });
    return unsub;
  }, [sessionId, connected, subscribe]);

  if (!currentSession || !sessionId) {
    return <div className="p-6 text-zinc-500">Loading session...</div>;
  }

  const { session, events, goals, workingMemory } = currentSession;

  const handleCancel = async () => {
    if (confirm("Cancel this session?")) {
      await cancelSession(sessionId);
      fetchSessionDetail(sessionId);
    }
  };

  const handleSendInput = async () => {
    if (!inputText.trim()) return;
    await sendInput(sessionId, inputText.trim());
    setInputText("");
    setShowInput(false);
  };

  const allEvents = [...events, ...liveEvents].slice(-100);
  const runtimeActivity = allEvents
    .filter((event) => event.event_type === "runtime.status" || event.event_type === "runtime.output")
    .slice(-12)
    .reverse();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/sessions")} className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← Back
          </button>
          <h2 className="text-lg font-semibold text-zinc-200 font-mono">{sessionId.slice(0, 16)}</h2>
          <span className={`inline-block h-2 w-2 rounded-full ${STATE_COLORS[session.state] ?? "bg-zinc-500"}`} />
          <span className="text-xs text-zinc-400">{session.state}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowInput(!showInput)}
            className="px-3 py-1 rounded text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
          >
            Send Input
          </button>
          {(session.state === "running" || session.state === "waiting") && (
            <button
              onClick={handleCancel}
              className="px-3 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {showInput && (
        <div className="flex gap-2">
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendInput()}
            placeholder="Type input message..."
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600"
            autoFocus
          />
          <button onClick={handleSendInput} className="px-3 py-1.5 rounded text-xs bg-blue-600 text-white">
            Send
          </button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3 space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Info</h3>
            <InfoRow label="Agent" value={session.agent_id} />
            <InfoRow label="Tenant" value={session.tenant_id} />
            <InfoRow label="Mode" value={session.session_mode} />
            {session.current_cycle_id && <InfoRow label="Cycle" value={session.current_cycle_id.slice(0, 12)} mono />}
            <InfoRow label="Traces" value={String(currentSession.traceCount)} />
            <InfoRow label="Episodes" value={String(currentSession.episodeCount)} />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Budget</h3>
            <BudgetBar label="Cycles" used={currentSession.traceCount} total={100} />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Policy</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">WS:</span>
              <span className={connected ? "text-emerald-400" : "text-red-400"}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
        </div>

        <div className="col-span-4 space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Goals</h3>
            {goals.length === 0 ? (
              <div className="text-zinc-600 text-xs py-2">No goals loaded</div>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {goals.map((g) => (
                  <div key={g.goal_id} className="flex items-center gap-2">
                    <span className={`text-xs ${GOAL_COLORS[g.status] ?? "text-zinc-400"}`}>●</span>
                    <span className="text-xs text-zinc-300 truncate flex-1">{g.title}</span>
                    {g.progress != null && (
                      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${g.progress}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Working Memory</h3>
            {workingMemory.length === 0 ? (
              <div className="text-zinc-600 text-xs py-2">No working memory</div>
            ) : (
              <div className="space-y-1 max-h-[160px] overflow-y-auto">
                {workingMemory.map((m) => (
                  <div key={m.memory_id} className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500 font-mono w-8">{m.relevance.toFixed(2)}</span>
                    <span className="text-zinc-300 truncate">{m.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-5 space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Runtime Activity</h3>
            <div className="max-h-[220px] overflow-y-auto space-y-2">
              {runtimeActivity.length === 0 ? (
                <div className="text-zinc-600 text-xs py-3">No runtime activity yet</div>
              ) : (
                runtimeActivity.map((ev) => {
                  const phase = getRuntimePhase(ev);
                  const state = getRuntimeState(ev);
                  const detail = summarizeRuntimeDetail(ev);
                  const facts = extractRuntimeFacts(ev);
                  return (
                    <div key={ev.event_id} className="rounded border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="text-zinc-300 uppercase tracking-wide">{phase}</span>
                        <span className={stateTone(state)}>{state}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-200 break-words">{detail}</div>
                      {facts.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {facts.map((fact) => (
                            <span key={fact.key} className="rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300">
                              {fact.key}:{fact.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Events (live)</h3>
            <div className="max-h-[340px] overflow-y-auto">
              {allEvents.length === 0 ? (
                <div className="text-zinc-600 text-xs py-4 text-center">Waiting for events...</div>
              ) : (
                <div className="space-y-0.5">
                  {allEvents.map((ev) => (
                    <div key={ev.event_id} className="flex items-center gap-2 text-[11px] py-0.5 hover:bg-zinc-800/30 rounded px-1">
                      <span className="text-zinc-600 font-mono w-16 shrink-0">
                        {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="text-zinc-300 w-36 shrink-0 truncate">{ev.event_type}</span>
                      <span className="text-zinc-500 truncate">{summarizeEvent(ev)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Link
          to={`/sessions/${sessionId}/traces`}
          className="px-3 py-1.5 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          Traces
        </Link>
        <Link
          to={`/sessions/${sessionId}/goals`}
          className="px-3 py-1.5 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          Goals
        </Link>
        <Link
          to={`/sessions/${sessionId}/memory`}
          className="px-3 py-1.5 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        >
          Memory
        </Link>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className={`text-zinc-300 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function BudgetBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = Math.min((used / total) * 100, 100);
  const color = pct < 70 ? "bg-emerald-500" : pct < 90 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-400">{used}/{total}</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function summarizeEvent(ev: NeuroCoreEvent): string {
  const p = (ev.payload ?? {}) as unknown as Record<string, unknown>;
  const eventType = ev.event_type as string;
  if (eventType === "session.state_changed") return `→ ${p.state ?? ""}`;
  if (eventType === "cycle.started") return `cycle ${String(p.cycle_id ?? "").slice(0, 8)}`;
  if (eventType === "cycle.completed") return `cycle ${String(p.cycle_id ?? "").slice(0, 8)} done`;
  if (eventType === "action.executed") return `${p.action_type ?? ""} ${p.status ?? ""}`;
  if (eventType === "goal.status_changed") return `${p.title ?? ""} → ${p.status ?? ""}`;
  if (eventType === "runtime.status") return `${p.phase ?? "runtime"} ${p.summary ?? ""}`;
  if (eventType === "runtime.output") return `${p.action_type ?? "output"} ${String(p.text ?? "").slice(0, 48)}`;
  return String(p.summary ?? p.message ?? "").slice(0, 50);
}

function getRuntimePhase(ev: NeuroCoreEvent): string {
  const payload = (ev.payload ?? {}) as unknown as Record<string, unknown>;
  if (ev.event_type === "runtime.output") {
    return String(payload.action_type ?? "output");
  }
  return String(payload.phase ?? "runtime");
}

function getRuntimeState(ev: NeuroCoreEvent): string {
  const payload = (ev.payload ?? {}) as unknown as Record<string, unknown>;
  return String(payload.state ?? "delta");
}

function summarizeRuntimeDetail(ev: NeuroCoreEvent): string {
  const payload = (ev.payload ?? {}) as unknown as Record<string, unknown>;
  if (ev.event_type === "runtime.output") {
    return String(payload.text ?? "");
  }
  return String(payload.summary ?? payload.detail ?? "");
}

function extractRuntimeFacts(ev: NeuroCoreEvent): Array<{ key: string; value: string }> {
  const payload = (ev.payload ?? {}) as unknown as Record<string, unknown>;
  const facts: Array<{ key: string; value: string }> = [];

  for (const key of ["cycle_id", "action_id", "action_type", "status"]) {
    const value = payload[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    facts.push({ key, value: String(value).slice(0, 20) });
  }

  const data = payload.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of ["tool_name", "proposal_count", "action_count", "digest_count", "skill_match_count"]) {
      if (facts.length >= 6) {
        break;
      }
      const value = (data as Record<string, unknown>)[key];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      facts.push({ key, value: String(value).slice(0, 20) });
    }
  }

  return facts;
}

function stateTone(state: string): string {
  if (state === "completed") {
    return "text-emerald-400";
  }
  if (state === "failed") {
    return "text-red-400";
  }
  if (state === "started" || state === "in_progress") {
    return "text-amber-400";
  }
  return "text-zinc-400";
}
