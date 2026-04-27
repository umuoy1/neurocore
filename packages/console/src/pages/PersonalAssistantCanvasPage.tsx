import { useEffect } from "react";
import { usePersonalAssistantCanvasStore } from "../stores/personalAssistantCanvas.store";

export function PersonalAssistantCanvasPage() {
  const {
    artifacts,
    selectedArtifactId,
    selectedArtifact,
    preview,
    draft,
    loading,
    mutating,
    error,
    setSelectedArtifactId,
    setDraft,
    load,
    inspect,
    createArtifact,
    updateArtifact,
    rollbackArtifact
  } = usePersonalAssistantCanvasStore();

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="grid min-h-full gap-5 p-6 xl:grid-cols-[360px_1fr]">
      <aside className="space-y-4">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Assistant Canvas</h2>
              <p className="mt-1 text-xs text-zinc-500">Versioned HTML artifacts with CSP preview and rollback.</p>
            </div>
            <button
              disabled={loading}
              onClick={() => void load()}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Reload
            </button>
          </div>
          {error && <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="max-h-72 space-y-2 overflow-auto">
            {artifacts.map((artifact) => (
              <button
                key={artifact.artifact_id}
                onClick={() => {
                  setSelectedArtifactId(artifact.artifact_id);
                  void inspect(artifact.artifact_id);
                }}
                className={`w-full rounded border px-3 py-2 text-left text-xs ${
                  selectedArtifactId === artifact.artifact_id
                    ? "border-sky-500/60 bg-sky-500/10 text-sky-200"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700"
                }`}
              >
                <div className="font-medium">{artifact.title}</div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">{artifact.artifact_id}</div>
                <div className="mt-1 text-[10px] text-zinc-600">v{artifact.versions.length} · {artifact.permission_scope}</div>
              </button>
            ))}
            {artifacts.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">No canvas artifacts.</div>}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Create Or Update</h3>
          <div className="space-y-2">
            <input
              value={draft.artifact_id}
              onChange={(event) => setDraft({ artifact_id: event.target.value })}
              placeholder="optional artifact id"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
            <input
              value={draft.title}
              onChange={(event) => setDraft({ title: event.target.value })}
              placeholder="title"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={draft.owner_id}
                onChange={(event) => setDraft({ owner_id: event.target.value })}
                placeholder="owner"
                className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
              <input
                value={draft.permission_scope}
                onChange={(event) => setDraft({ permission_scope: event.target.value })}
                placeholder="scope"
                className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
            <textarea
              value={draft.html}
              onChange={(event) => setDraft({ html: event.target.value })}
              rows={10}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200"
            />
            <div className="flex gap-2">
              <button disabled={mutating || !draft.title || !draft.html || !draft.owner_id} onClick={() => void createArtifact()} className="rounded bg-sky-600/20 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-600/30 disabled:opacity-50">
                Create
              </button>
              <button disabled={mutating || !selectedArtifactId || !draft.html} onClick={() => void updateArtifact()} className="rounded bg-emerald-600/20 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50">
                Update
              </button>
            </div>
          </div>
        </section>
      </aside>

      <main className="space-y-4">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">{preview?.title ?? selectedArtifact?.title ?? "Preview"}</h3>
              <p className="mt-1 font-mono text-[11px] text-zinc-500">{preview?.artifact_id ?? "no artifact selected"}</p>
            </div>
            {preview && (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
                CSP: {preview.content_security_policy}
              </div>
            )}
          </div>
          {preview ? (
            <iframe
              title={preview.title}
              srcDoc={preview.html}
              sandbox={preview.iframe_sandbox}
              className="h-[520px] w-full rounded border border-zinc-800 bg-white"
            />
          ) : (
            <div className="flex h-[520px] items-center justify-center rounded border border-dashed border-zinc-800 text-xs text-zinc-600">Select or create a canvas artifact.</div>
          )}
        </section>

        {selectedArtifact && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">Versions</h3>
              <span className="text-[11px] text-zinc-600">{selectedArtifact.versions.length} versions</span>
            </div>
            <div className="space-y-2">
              {[...selectedArtifact.versions].reverse().map((version) => (
                <div key={version.version_id} className="rounded border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs text-zinc-300">v{version.version_no} · {version.version_id}</div>
                    <button
                      disabled={mutating || version.version_id === selectedArtifact.current_version_id}
                      onClick={() => void rollbackArtifact(version.version_no)}
                      className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Rollback
                    </button>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-zinc-950 text-[11px] text-zinc-500">{version.diff || "No diff"}</pre>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
