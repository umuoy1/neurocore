import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import type { WorldEntity, WorldRelation } from "../api/types";

export function WorldModelViewerPage() {
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [relations, setRelations] = useState<WorldRelation[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [sessionId, setSessionId] = useState("");

  const loadWorldState = async (sid: string) => {
    try {
      const res = await apiFetch<{ entities: WorldEntity[]; relations: WorldRelation[] }>(`/v1/sessions/${sid}/world-state`);
      setEntities(res.entities ?? []);
      setRelations(res.relations ?? []);
    } catch {
      setEntities([]);
      setRelations([]);
    }
  };

  useEffect(() => {
    if (sessionId) loadWorldState(sessionId);
  }, [sessionId]);

  const filtered = typeFilter
    ? entities.filter((e) => e.entity_type === typeFilter)
    : entities;

  const entityTypes = [...new Set(entities.map((e) => e.entity_type))];
  const selected = entities.find((e) => e.entity_id === selectedEntity);
  const relatedRelations = selectedEntity
    ? relations.filter((r) => r.source_entity_id === selectedEntity || r.target_entity_id === selectedEntity)
    : [];

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-zinc-200">World Model Viewer</h2>

      <div className="flex items-center gap-3">
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="Enter session ID to load world state..."
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 flex-1 max-w-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300"
        >
          <option value="">All Types</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {entities.length === 0 && sessionId ? (
        <div className="text-zinc-600 text-xs py-8 text-center">
          No world state data for this session (endpoint: GET /v1/sessions/:id/world-state)
        </div>
      ) : entities.length === 0 ? (
        <div className="text-zinc-600 text-xs py-8 text-center">Enter a session ID to view world state</div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
              Entities ({filtered.length}) & Relations ({relations.length})
            </h3>
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {filtered.map((e) => {
                const hasRelations = relations.some((r) => r.source_entity_id === e.entity_id || r.target_entity_id === e.entity_id);
                const confColor = e.confidence > 0.8 ? "bg-emerald-500" : e.confidence > 0.5 ? "bg-amber-500" : "bg-red-500";
                return (
                  <div
                    key={e.entity_id}
                    onClick={() => setSelectedEntity(e.entity_id)}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs ${
                      selectedEntity === e.entity_id ? "bg-zinc-800" : "hover:bg-zinc-800/50"
                    }`}
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${confColor}`} />
                    <span className="text-zinc-300 flex-1 truncate">{e.entity_id.slice(0, 16)}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400">{e.entity_type}</span>
                    {hasRelations && <span className="text-[10px] text-blue-400">→</span>}
                    <span className="text-[10px] text-zinc-600">{e.confidence.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            {selected ? (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Entity Detail</h3>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-zinc-500">ID</span>
                      <div className="text-zinc-300 font-mono">{selected.entity_id}</div>
                    </div>
                    <div>
                      <span className="text-zinc-500">Type</span>
                      <div className="text-zinc-300">{selected.entity_type}</div>
                    </div>
                    <div>
                      <span className="text-zinc-500">Confidence</span>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${selected.confidence * 100}%` }} />
                        </div>
                        <span className="text-zinc-400">{selected.confidence.toFixed(2)}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-zinc-500">Last Observed</span>
                      <div className="text-zinc-300">{new Date(selected.last_observed).toLocaleString()}</div>
                    </div>
                    {Object.keys(selected.properties).length > 0 && (
                      <div>
                        <span className="text-zinc-500">Properties</span>
                        <pre className="text-[10px] text-zinc-400 mt-0.5 bg-zinc-950 rounded p-2 overflow-x-auto">
                          {JSON.stringify(selected.properties, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>

                {relatedRelations.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Relations</h3>
                    <div className="space-y-1">
                      {relatedRelations.map((r) => (
                        <div key={r.relation_id} className="text-[11px] text-zinc-400">
                          <span className="text-zinc-300">{r.source_entity_id.slice(0, 8)}</span>
                          <span className="mx-1 text-zinc-500">—{r.relation_type}→</span>
                          <span className="text-zinc-300">{r.target_entity_id.slice(0, 8)}</span>
                          <span className="ml-2 text-zinc-600">{r.strength.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-zinc-600 text-xs text-center">
                Select an entity to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
