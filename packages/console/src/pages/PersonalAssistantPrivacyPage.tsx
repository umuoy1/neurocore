import { useEffect, useMemo, useState } from "react";
import { usePersonalAssistantPrivacyStore } from "../stores/personalAssistantPrivacy.store";
import type { DataSubjectRecordType, DataSubjectRetentionReport } from "../api/types";

const DATA_TYPES: DataSubjectRecordType[] = ["memory", "trace", "tool", "artifact"];

export function PersonalAssistantPrivacyPage() {
  const {
    userId,
    retention,
    exportBundle,
    loading,
    error,
    setUserId,
    loadRetention,
    exportData,
    freezeData,
    deleteData
  } = usePersonalAssistantPrivacyStore();
  const [actorId] = useState(() => `console_${Math.random().toString(36).slice(2, 8)}`);
  const [selectedTypes, setSelectedTypes] = useState<DataSubjectRecordType[]>(DATA_TYPES);

  useEffect(() => {
    if (userId) void loadRetention(userId);
  }, []);

  const canAct = userId.trim().length > 0 && selectedTypes.length > 0 && !loading;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Assistant Privacy</h2>
          <p className="mt-1 text-xs text-zinc-500">Data subject export, deletion, freeze and retention controls for personal assistant data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="canonical user id"
            className="w-64 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            disabled={!userId.trim() || loading}
            onClick={() => void loadRetention()}
            className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Load
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">Data Types</h3>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Export" disabled={!canAct} tone="sky" onClick={() => void exportData(actorId, selectedTypes)} />
            <ActionButton label="Freeze" disabled={!canAct} tone="amber" onClick={() => void freezeData(actorId, selectedTypes)} />
            <ActionButton label="Delete" disabled={!canAct} tone="red" onClick={() => void deleteData(actorId, selectedTypes)} />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {DATA_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={selectedTypes.includes(type)}
                onChange={(event) => {
                  setSelectedTypes((current) => event.target.checked
                    ? [...new Set([...current, type])]
                    : current.filter((item) => item !== type));
                }}
              />
              <span className="capitalize">{type}</span>
            </label>
          ))}
        </div>
      </section>

      {retention ? (
        <RetentionView retention={retention} />
      ) : (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-8 text-center text-xs text-zinc-600">Load a user to inspect retention.</div>
      )}

      {exportBundle && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">Latest Export</h3>
            <span className="font-mono text-[11px] text-zinc-500">{exportBundle.export_id}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {DATA_TYPES.map((type) => (
              <div key={type} className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{type}</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-100">
                  {exportBundle.records.filter((record) => record.type === type).length}
                </div>
              </div>
            ))}
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400">
            {JSON.stringify(exportBundle.records.slice(0, 12), null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

function RetentionView({ retention }: { retention: DataSubjectRetentionReport }) {
  const totals = useMemo(() => DATA_TYPES.map((type) => ({
    type,
    ...retention.records[type]
  })), [retention]);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">Retention</h3>
        <span className="text-[11px] text-zinc-500">{formatDate(retention.created_at)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {totals.map((item) => (
          <div key={item.type} className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{item.type}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <Metric label="Active" value={item.active} tone="emerald" />
              <Metric label="Frozen" value={item.frozen} tone="amber" />
              <Metric label="Deleted" value={item.deleted} tone="red" />
            </div>
            <div className="mt-3 text-[11px] leading-relaxed text-zinc-600">{retention.policies[item.type]}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "red" }) {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-red-300";
  return (
    <div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-zinc-600">{label}</div>
    </div>
  );
}

function ActionButton({ label, disabled, tone, onClick }: { label: string; disabled: boolean; tone: "sky" | "amber" | "red"; onClick: () => void }) {
  const className = tone === "sky"
    ? "bg-sky-600/20 text-sky-300 hover:bg-sky-600/30"
    : tone === "amber"
      ? "bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"
      : "bg-red-600/20 text-red-300 hover:bg-red-600/30";
  return (
    <button disabled={disabled} onClick={onClick} className={`rounded px-3 py-1.5 text-xs disabled:opacity-50 ${className}`}>
      {label}
    </button>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
