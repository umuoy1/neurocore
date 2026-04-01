import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { useMemoryStore } from "../stores/memory.store";
import { useSessionsStore } from "../stores/sessions.store";
import type { WorkingMemoryRecord, Episode } from "../api/types";

type Layer = "working" | "episodic" | "semantic" | "procedural";

export function MemoryInspectorPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { activeLayer, setActiveLayer, searchQuery, setSearchQuery, workingMemory, episodes, fetchWorkingMemory, fetchEpisodes } = useMemoryStore();
  const { fetchSessionDetail } = useSessionsStore();
  const [outcomeFilter, setOutcomeFilter] = useState<string>("");

  useEffect(() => {
    if (!sessionId) return;
    fetchSessionDetail(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (activeLayer === "working") fetchWorkingMemory(sessionId);
    if (activeLayer === "episodic") fetchEpisodes(sessionId);
  }, [activeLayer, sessionId]);

  const layers: { key: Layer; label: string }[] = [
    { key: "working", label: "Working" },
    { key: "episodic", label: "Episodic" },
    { key: "semantic", label: "Semantic" },
    { key: "procedural", label: "Procedural" },
  ];

  const filteredWorking = searchQuery
    ? workingMemory.filter((m) => m.summary.toLowerCase().includes(searchQuery.toLowerCase()))
    : workingMemory;

  const filteredEpisodes = episodes
    .filter((e) => !outcomeFilter || e.outcome === outcomeFilter)
    .filter((e) => !searchQuery || e.trigger_summary?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/sessions/${sessionId}`} className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Back to Session
        </Link>
        <h2 className="text-lg font-semibold text-zinc-200">Memory Inspector</h2>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {layers.map((l) => (
            <button
              key={l.key}
              onClick={() => setActiveLayer(l.key)}
              className={`px-3 py-1.5 rounded text-xs ${activeLayer === l.key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search memory..."
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 flex-1 max-w-xs"
        />
      </div>

      {activeLayer === "working" && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">{filteredWorking.length} entries</div>
          {filteredWorking.length === 0 ? (
            <div className="text-zinc-600 text-xs py-4 text-center">No working memory records</div>
          ) : (
            filteredWorking.map((m) => <WorkingCard key={m.memory_id} record={m} />)
          )}
        </div>
      )}

      {activeLayer === "episodic" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-xs text-zinc-500">{filteredEpisodes.length} episodes</div>
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-xs text-zinc-300"
            >
              <option value="">All Outcomes</option>
              <option value="success">Success</option>
              <option value="partial">Partial</option>
              <option value="failure">Failure</option>
            </select>
          </div>
          {filteredEpisodes.length === 0 ? (
            <div className="text-zinc-600 text-xs py-4 text-center">No episodes</div>
          ) : (
            filteredEpisodes.map((ep) => <EpisodeCard key={ep.episode_id} episode={ep} />)
          )}
        </div>
      )}

      {activeLayer === "semantic" && (
        <div className="text-zinc-600 text-xs py-8 text-center">
          Semantic memory view requires backend endpoint (GET /v1/sessions/:id/memory/semantic)
        </div>
      )}

      {activeLayer === "procedural" && (
        <div className="text-zinc-600 text-xs py-8 text-center">
          Procedural memory view requires backend endpoint (GET /v1/sessions/:id/skills)
        </div>
      )}
    </div>
  );
}

function WorkingCard({ record }: { record: WorkingMemoryRecord }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-300 flex-1 truncate">{record.summary}</span>
        <span className="text-[10px] text-zinc-500 font-mono ml-2">{record.memory_id.slice(0, 10)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${record.relevance * 100}%` }} />
        </div>
        <span className="text-[10px] text-zinc-500 w-8 text-right">{record.relevance.toFixed(2)}</span>
      </div>
    </div>
  );
}

function EpisodeCard({ episode }: { episode: Episode }) {
  const [expanded, setExpanded] = useState(false);

  const outcomeColor = episode.outcome === "success"
    ? "bg-emerald-500/10 text-emerald-400"
    : episode.outcome === "failure"
    ? "bg-red-500/10 text-red-400"
    : "bg-amber-500/10 text-amber-400";

  const valenceIcon = episode.valence === "positive" ? "↑" : episode.valence === "negative" ? "↓" : "→";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-300 flex-1 truncate">{episode.trigger_summary}</span>
        <div className="flex items-center gap-2 ml-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${outcomeColor}`}>{episode.outcome}</span>
          <span className="text-xs text-zinc-500">{valenceIcon}</span>
        </div>
      </div>
      {episode.selected_strategy && (
        <div className="text-[11px] text-zinc-500">Strategy: {episode.selected_strategy}</div>
      )}
      {episode.outcome_summary && (
        <div className="text-[11px] text-zinc-400 mt-0.5">{episode.outcome_summary}</div>
      )}
      {episode.lessons && episode.lessons.length > 0 && (
        <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-blue-400 mt-1">
          {expanded ? "Hide" : "Show"} {episode.lessons.length} lessons
        </button>
      )}
      {expanded && episode.lessons && (
        <ul className="mt-1 space-y-0.5 pl-2 border-l border-zinc-800">
          {episode.lessons.map((l, i) => (
            <li key={i} className="text-[11px] text-zinc-400">{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
