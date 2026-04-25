import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { useMemoryStore } from "../stores/memory.store";
import { useSessionsStore } from "../stores/sessions.store";
import type {
  Episode,
  MemoryRecallBundle,
  MemoryRetrievalPlan,
  MemoryWarning,
  SemanticMemoryRecord,
  SkillDefinition,
  WorkingMemoryRecord
} from "../api/types";

type Layer = "observability" | "working" | "episodic" | "semantic" | "procedural";

export function MemoryInspectorPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const {
    activeLayer,
    setActiveLayer,
    searchQuery,
    setSearchQuery,
    workingMemory,
    episodes,
    semanticMemory,
    skills,
    retrievalPlans,
    recallBundles,
    latestRetrievalPlan,
    latestRecallBundle,
    memoryWarnings,
    fetchWorkingMemory,
    fetchEpisodes,
    fetchSemanticMemory,
    fetchSkills
  } = useMemoryStore();
  const { fetchSessionDetail } = useSessionsStore();
  const [outcomeFilter, setOutcomeFilter] = useState<string>("");

  useEffect(() => {
    if (!sessionId) return;
    fetchSessionDetail(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (activeLayer === "observability") fetchWorkingMemory(sessionId);
    if (activeLayer === "working") fetchWorkingMemory(sessionId);
    if (activeLayer === "episodic") fetchEpisodes(sessionId);
    if (activeLayer === "semantic") fetchSemanticMemory(sessionId);
    if (activeLayer === "procedural") fetchSkills(sessionId);
  }, [activeLayer, sessionId]);

  const layers: { key: Layer; label: string }[] = [
    { key: "observability", label: "Observability" },
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
  const filteredSemantic = semanticMemory.filter((record) =>
    !searchQuery || record.summary.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredSkills = skills.filter((skill) =>
    !searchQuery || `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      {activeLayer === "observability" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <RetrievalPlanCard plan={latestRetrievalPlan} planCount={retrievalPlans.length} />
          <RecallBundleCard bundle={latestRecallBundle} bundleCount={recallBundles.length} />
          <WarningPanel warnings={memoryWarnings} />
        </div>
      )}

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
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">{filteredSemantic.length} patterns</div>
          {filteredSemantic.length === 0 ? (
            <div className="text-zinc-600 text-xs py-8 text-center">No semantic patterns</div>
          ) : filteredSemantic.map((record) => (
            <SemanticCard key={record.memory_id} record={record} />
          ))}
        </div>
      )}

      {activeLayer === "procedural" && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">{filteredSkills.length} skills</div>
          {filteredSkills.length === 0 ? (
            <div className="text-zinc-600 text-xs py-8 text-center">No procedural skills</div>
          ) : filteredSkills.map((skill) => (
            <SkillCard key={skill.skill_id} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}

function RetrievalPlanCard({ plan, planCount }: { plan: MemoryRetrievalPlan | null; planCount: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">Retrieval Plan</div>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{planCount} cycles</span>
      </div>
      {!plan ? (
        <div className="text-xs text-zinc-600">No retrieval plan recorded.</div>
      ) : (
        <div className="space-y-2">
          <div className="font-mono text-[11px] text-zinc-500">{plan.plan_id}</div>
          <div className="flex flex-wrap gap-1">
            {plan.requested_layers.map((layer) => (
              <span key={layer} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">{layer}</span>
            ))}
          </div>
          <div className="text-[11px] text-zinc-400">stage: {plan.stage_order.join(" -> ")}</div>
          <div className="text-[11px] text-zinc-500">evidence budget: {plan.evidence_budget ?? "n/a"}</div>
          {plan.rationale && <div className="text-[11px] text-zinc-500">{plan.rationale}</div>}
        </div>
      )}
    </div>
  );
}

function RecallBundleCard({ bundle, bundleCount }: { bundle: MemoryRecallBundle | null; bundleCount: number }) {
  const counts = bundle ? [
    ["digests", bundle.digests.length],
    ["proposals", bundle.proposals.length],
    ["episodes", bundle.episodic_episodes?.length ?? 0],
    ["cards", bundle.semantic_cards?.length ?? 0],
    ["skills", bundle.skill_specs?.length ?? 0],
    ["warnings", bundle.warnings?.length ?? 0]
  ] : [];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">Recall Bundle</div>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{bundleCount} bundles</span>
      </div>
      {!bundle ? (
        <div className="text-xs text-zinc-600">No recall bundle recorded.</div>
      ) : (
        <div className="space-y-2">
          <div className="font-mono text-[11px] text-zinc-500">{bundle.bundle_id}</div>
          <div className="grid grid-cols-3 gap-2">
            {counts.map(([label, value]) => (
              <div key={label} className="rounded border border-zinc-800 bg-zinc-950 p-2">
                <div className="text-sm text-zinc-200">{value}</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-zinc-500">plan: {bundle.plan_id}</div>
        </div>
      )}
    </div>
  );
}

function WarningPanel({ warnings }: { warnings: MemoryWarning[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 lg:col-span-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-zinc-400">Governance Warnings</div>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{warnings.length} warnings</span>
      </div>
      {warnings.length === 0 ? (
        <div className="text-xs text-zinc-600">No memory warnings.</div>
      ) : (
        <div className="space-y-1">
          {warnings.map((warning) => (
            <div key={warning.warning_id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${warning.severity === "block" ? "bg-red-500/10 text-red-400" : warning.severity === "warn" ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>{warning.severity}</span>
              <span className="text-[11px] text-zinc-300">{warning.kind}</span>
              <span className="flex-1 truncate text-[11px] text-zinc-500">{warning.message}</span>
              {warning.object_id && <span className="font-mono text-[10px] text-zinc-600">{warning.object_id}</span>}
            </div>
          ))}
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

function SemanticCard({ record }: { record: SemanticMemoryRecord }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-300">{record.summary}</div>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${record.valence === "negative" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
          {record.valence}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">
        occurrences: {record.occurrence_count} · sessions: {record.session_ids.length}
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillDefinition }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-300">{skill.name}</div>
          <div className="text-[11px] text-zinc-500">{skill.kind} · {skill.version}</div>
        </div>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{skill.status ?? "active"}</span>
      </div>
      {skill.description && <div className="mt-1 text-[11px] text-zinc-500">{skill.description}</div>}
    </div>
  );
}
