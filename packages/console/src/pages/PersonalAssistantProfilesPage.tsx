import { useEffect } from "react";
import { usePersonalAssistantProfilesStore } from "../stores/personalAssistantProfiles.store";
import type {
  PersonalAssistantProfile,
  PersonalAssistantProfileBinding,
  PersonalAssistantProfileIsolationViolation
} from "../api/types";

export function PersonalAssistantProfilesPage() {
  const {
    profiles,
    selectedProfileId,
    selectedProfile,
    bindings,
    isolation,
    loading,
    mutating,
    error,
    draft,
    routeDraft,
    setSelectedProfileId,
    setDraft,
    setRouteDraft,
    load,
    inspect,
    createProfile,
    switchProfile
  } = usePersonalAssistantProfilesStore();

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIsolation = selectedProfileId
    ? isolation.filter((item) => item.left_profile_id === selectedProfileId || item.right_profile_id === selectedProfileId)
    : isolation;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Assistant Profiles</h2>
          <p className="mt-1 text-xs text-zinc-500">Create, inspect and switch personal assistant profiles with isolated memory, tools, channels and policy scopes.</p>
        </div>
        <button
          onClick={() => void load()}
          className="w-fit rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(260px,360px)_1fr]">
        <section className="space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">Profiles</h3>
              <IsolationBadge violations={isolation} />
            </div>
            <div className="space-y-2">
              {profiles.map((profile) => (
                <button
                  key={profile.profile_id}
                  onClick={() => {
                    setSelectedProfileId(profile.profile_id);
                    void inspect(profile.profile_id);
                  }}
                  className={`w-full rounded border p-3 text-left text-xs transition-colors ${
                    selectedProfileId === profile.profile_id
                      ? "border-sky-500/60 bg-sky-500/10 text-sky-100"
                      : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{profile.display_name || profile.profile_id}</span>
                    <span className="font-mono text-[10px] text-zinc-500">{profile.profile_id}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                    <span>{profile.memory_scope}</span>
                    <span>{profile.tool_scope}</span>
                    <span>{profile.policy_scope}</span>
                  </div>
                </button>
              ))}
              {profiles.length === 0 && (
                <div className="rounded border border-zinc-800 bg-zinc-950/60 p-6 text-center text-xs text-zinc-600">
                  No profiles loaded
                </div>
              )}
            </div>
          </div>

          <form
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createProfile();
            }}
          >
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Create Profile</h3>
            <div className="space-y-2">
              <TextInput label="Profile ID" value={draft.profile_id} onChange={(value) => setDraft({ profile_id: value })} required />
              <TextInput label="Display Name" value={draft.display_name} onChange={(value) => setDraft({ display_name: value })} />
              <TextInput label="Memory Scope" value={draft.memory_scope} onChange={(value) => setDraft({ memory_scope: value })} placeholder="memory:work" />
              <TextInput label="Tool Scope" value={draft.tool_scope} onChange={(value) => setDraft({ tool_scope: value })} placeholder="tools:work" />
              <TextInput label="Policy Scope" value={draft.policy_scope} onChange={(value) => setDraft({ policy_scope: value })} placeholder="policy:work" />
              <TextInput label="Workspace" value={draft.default_workspace_id} onChange={(value) => setDraft({ default_workspace_id: value })} />
            </div>
            <button
              type="submit"
              disabled={!draft.profile_id.trim() || mutating}
              className="mt-3 w-full rounded bg-sky-600 px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              Create Or Update
            </button>
          </form>
        </section>

        <section className="space-y-5">
          {selectedProfile ? (
            <ProfileDetail profile={selectedProfile} isolation={selectedIsolation} />
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-xs text-zinc-600">
              Select a profile to inspect scopes and bindings.
            </div>
          )}

          <form
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void switchProfile();
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">Switch Route</h3>
              <span className="font-mono text-[11px] text-zinc-500">{selectedProfileId || "no profile"}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <TextInput label="Actor ID" value={routeDraft.actor_id} onChange={(value) => setRouteDraft({ actor_id: value })} />
              <TextInput label="User ID" value={routeDraft.user_id} onChange={(value) => setRouteDraft({ user_id: value })} required />
              <TextInput label="Platform" value={routeDraft.platform} onChange={(value) => setRouteDraft({ platform: value })} />
              <TextInput label="Chat ID" value={routeDraft.chat_id} onChange={(value) => setRouteDraft({ chat_id: value })} />
              <TextInput label="Channel Kind" value={routeDraft.channel_kind} onChange={(value) => setRouteDraft({ channel_kind: value })} />
              <TextInput label="Workspace" value={routeDraft.workspace_id} onChange={(value) => setRouteDraft({ workspace_id: value })} />
            </div>
            <button
              type="submit"
              disabled={!selectedProfileId || !routeDraft.user_id.trim() || mutating}
              className="mt-3 rounded bg-emerald-600 px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              Switch Profile
            </button>
          </form>

          <BindingsView bindings={bindings} />
        </section>
      </div>
    </div>
  );
}

function ProfileDetail({ profile, isolation }: { profile: PersonalAssistantProfile; isolation: PersonalAssistantProfileIsolationViolation[] }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{profile.display_name || profile.profile_id}</h3>
          <p className="mt-1 font-mono text-[11px] text-zinc-500">{profile.profile_id}</p>
        </div>
        <IsolationBadge violations={isolation} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ScopeCard label="Memory" value={profile.memory_scope} />
        <ScopeCard label="Tools" value={profile.tool_scope} />
        <ScopeCard label="Policy" value={profile.policy_scope} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <ScopeRow label="Agent" value={profile.agent_id} />
        <ScopeRow label="Tenant" value={profile.tenant_id} />
        <ScopeRow label="Workspace" value={profile.default_workspace_id || "-"} />
      </div>
      {isolation.length > 0 && (
        <div className="mt-4 space-y-2">
          {isolation.map((item) => (
            <div key={`${item.left_profile_id}:${item.right_profile_id}:${item.scope}:${item.value}`} className="rounded border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
              {item.scope} conflict: {item.left_profile_id} / {item.right_profile_id} share {item.value}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BindingsView({ bindings }: { bindings: PersonalAssistantProfileBinding[] }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Channel Bindings</h3>
      <div className="space-y-2">
        {bindings.map((binding) => (
          <div key={binding.binding_id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-zinc-300">{binding.binding_id}</span>
              <span className={binding.active ? "text-emerald-300" : "text-zinc-600"}>{binding.active ? "active" : "inactive"}</span>
            </div>
            <div className="mt-2 grid gap-2 text-zinc-500 md:grid-cols-4">
              <span>User: {binding.user_id || "-"}</span>
              <span>Platform: {binding.platform || "-"}</span>
              <span>Chat: {binding.chat_id || "-"}</span>
              <span>Workspace: {binding.workspace_id || "-"}</span>
            </div>
          </div>
        ))}
        {bindings.length === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-950/60 p-6 text-center text-xs text-zinc-600">
            No bindings for this profile
          </div>
        )}
      </div>
    </section>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-700"
      />
    </label>
  );
}

function ScopeCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-2 break-all font-mono text-xs text-zinc-200">{value}</div>
    </div>
  );
}

function ScopeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 break-all text-zinc-300">{value}</div>
    </div>
  );
}

function IsolationBadge({ violations }: { violations: PersonalAssistantProfileIsolationViolation[] }) {
  return violations.length === 0 ? (
    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">Zero Leakage</span>
  ) : (
    <span className="rounded-full bg-red-500/10 px-2 py-1 text-[11px] text-red-300">{violations.length} Leak(s)</span>
  );
}
