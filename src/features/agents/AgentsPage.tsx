import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import type { AgentProfile, AgentProfileInput } from "@misty/contracts";
import { personalAgentsApi, type AgentMemory } from "@/api/agents/native";
import { assistantApi } from "@/api/assistant/api";
import type { FrontierModel } from "@/api/assistant/api-core";
import { useAuth } from "@/features/auth";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore } from "@/features/workspace";
import { openMisty } from "@/features/misty/handoff";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { MistyDashboard } from "./components/MistyDashboard";
import { McpConnectionsSheet } from "./mcp/McpConnectionsSheet";

const field =
  "w-full rounded-md border border-charcoal-border bg-charcoal-bg px-3 py-2 text-sm text-cream outline-none focus-visible:ring-2 focus-visible:ring-cream-muted";
const button =
  "rounded-md border border-charcoal-border px-3 py-2 text-sm enabled:hover:bg-charcoal-active focus-visible:ring-2 focus-visible:ring-cream-muted disabled:bg-charcoal-bg disabled:border-charcoal-border disabled:text-cream-muted disabled:cursor-not-allowed disabled:opacity-100";
const emptyProfile: AgentProfileInput = {
  name: "",
  role: "",
  description: "",
  instructions: "",
  icon: "sparkles",
  avatar: {},
  model_mode: "automatic",
  model_id: "",
  reasoning_effort: "",
  enabled: true,
};

export default function NativeAgentsPage({ spaceId: requestedSpaceId }: { spaceId?: string } = {}) {
  const { user } = useAuth();
  const scope = useWorkspaceStore((s) => s.activeScopeKey);
  const spaces = useSpacesStore((s) => s.spaces);
  const [assignedSpaceId, setAssignedSpaceId] = useState(
    () => requestedSpaceId || (scope.startsWith("space:") ? scope.slice(6) : ""),
  );
  const space = spaces.find((item) => item.id === assignedSpaceId) ?? preferredDefaultSpace(spaces);
  const spaceId = space?.id ?? "";
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [params] = useSearchParams();
  const [activity, setActivity] = useState(
    () => params.get("view") === "automations" || params.has("run"),
  );
  const [connections, setConnections] = useState(false);
  const [editorStatus, setEditorStatus] = useState({ dirty: false, busy: false });
  const [pendingSpaceId, setPendingSpaceId] = useState<string>();
  useEffect(() => {
    void load(user?.id ?? "");
    setSelected(undefined);
  }, [user?.id, load]);
  const profile = agents.find((a) => a.id === selected);
  return (
    <main className="flex h-full min-h-0 flex-col bg-charcoal-bg text-cream">
      <header className="flex flex-wrap items-center gap-3 border-b border-charcoal-border p-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-sm text-cream-muted">Your personal agents, across all your Spaces.</p>
        </div>
        <button className={button} onClick={() => setActivity(!activity)}>
          {activity ? "Your agents" : "Activity"}
        </button>
        <button
          className={button}
          onClick={() => {
            setSelected("new");
            setActivity(false);
          }}
        >
          <Plus size={16} className="mr-1 inline" />
          Create agent
        </button>
      </header>
      <label className="flex shrink-0 items-center gap-3 border-b border-charcoal-border px-4 py-3 text-xs text-cream-muted">
        Work context
        <select
          aria-label="Agent work Space"
          className="min-w-0 max-w-64 rounded border border-charcoal-border bg-charcoal-bg px-2 py-1 text-sm text-cream focus-visible:border-cream-muted"
          value={spaceId}
          disabled={editorStatus.busy}
          onChange={(event) => {
            if (editorStatus.dirty && !activity) setPendingSpaceId(event.target.value);
            else setAssignedSpaceId(event.target.value);
          }}
        >
          {!spaces.length && <option value="">Choose a Space</option>}
          {spaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {pendingSpaceId && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-charcoal-border px-4 py-3 text-sm"
        >
          <p className="mr-auto">
            You have unsaved changes. Keep editing to save them, or discard them to switch Spaces.
          </p>
          <button className={button} onClick={() => setPendingSpaceId(undefined)}>
            Keep editing
          </button>
          <button
            className={button}
            onClick={() => {
              setAssignedSpaceId(pendingSpaceId);
              setPendingSpaceId(undefined);
              setEditorStatus({ dirty: false, busy: false });
            }}
          >
            Discard and switch
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="p-4 text-sm">
          {error}{" "}
          <button className="underline" onClick={() => void load(user?.id ?? "")}>
            Retry
          </button>
        </div>
      )}
      {activity ? (
        <MistyDashboard
          spaceId={spaceId}
          agentId={profile?.id}
          onManageConnections={() => setConnections(true)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row">
          <aside
            className="shrink-0 border-b border-charcoal-border p-3 md:w-60 md:overflow-auto md:border-b-0 md:border-r"
            aria-label="Your agents"
          >
            {loading && !agents.length ? (
              <p role="status" className="p-3 text-sm text-cream-muted">
                Loading agents…
              </p>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelected(agent.id)}
                  aria-pressed={selected === agent.id}
                  className={`mb-1 flex w-full gap-3 rounded-md p-3 text-left enabled:hover:bg-charcoal-active focus-visible:ring-2 focus-visible:ring-cream-muted ${selected === agent.id ? "bg-charcoal-active" : ""}`}
                >
                  <span className="mt-0.5 shrink-0" aria-hidden="true">
                    {typeof agent.avatar?.emoji === "string" ? (
                      agent.avatar.emoji
                    ) : (
                      <Sparkles size={18} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{agent.name}</span>
                    <span className="block truncate text-xs text-cream-muted">
                      {agent.role || "Personal agent"}
                      {agent.enabled ? "" : " · Disabled"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </aside>
          <section
            key={`${selected}:${spaceId}`}
            className="min-w-0 flex-1 overflow-auto p-5 md:p-7"
          >
            {selected === "new" || profile ? (
              <AgentEditor
                key={`${user?.id}:${selected}:${spaceId}`}
                profile={profile}
                onStatusChange={setEditorStatus}
                spaceId={spaceId}
                onSaved={async (id) => {
                  await load(user?.id ?? "");
                  setSelected(id);
                  setPendingSpaceId(undefined);
                }}
                onRemoved={async () => {
                  setSelected(undefined);
                  await load(user?.id ?? "");
                }}
              />
            ) : (
              <div className="max-w-lg py-8">
                <Sparkles className="mb-4 text-cream-muted" size={28} />
                <h2 className="text-xl font-medium">Give an agent a responsibility</h2>
                <p className="mt-3 text-sm leading-relaxed text-cream-muted">
                  Select an agent to choose its apps and instructions. You can also ask Misty:
                  “Create a communications agent for Social and Planner.”
                </p>
                <button
                  className={`${button} mt-5`}
                  onClick={() =>
                    void openMisty({ spaceId }).catch((reason) =>
                      useMistyStore.setState({ error: String(reason) }),
                    )
                  }
                >
                  Talk to Misty
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      <McpConnectionsSheet open={connections} onOpenChange={setConnections} />
    </main>
  );
}

function AgentEditor({
  profile,
  spaceId,
  onSaved,
  onRemoved,
  onStatusChange,
}: {
  profile?: AgentProfile;
  spaceId: string;
  onSaved(id: string): Promise<void>;
  onRemoved(): Promise<void>;
  onStatusChange(status: { dirty: boolean; busy: boolean }): void;
}) {
  const [draft, setDraft] = useState<AgentProfileInput>(profile ?? emptyProfile);
  const [baselineDraft, setBaselineDraft] = useState(draft);
  const [baselineAssigned, setBaselineAssigned] = useState<string[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const profileId = profile?.id;
  const [ready, setReady] = useState(!profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [models, setModels] = useState<FrontierModel[]>([]);
  const [editingMemory, setEditingMemory] = useState<string>();
  const [memoryDraft, setMemoryDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baselineDraft) ||
    JSON.stringify([...assigned].sort()) !== JSON.stringify([...baselineAssigned].sort()) ||
    Boolean(
      editingMemory &&
      memoryDraft !== memories.find((memory) => memory.id === editingMemory)?.content,
    );
  useEffect(() => {
    onStatusChange({ dirty, busy });
    return () => onStatusChange({ dirty: false, busy: false });
  }, [dirty, busy, onStatusChange]);
  const catalog = useAppsStore((s) => s.catalog);
  const installations = useAppsStore((s) => s.installations);
  const loadApps = useAppsStore((s) => s.load);
  const { user } = useAuth();
  useEffect(() => {
    if (user?.id) void loadApps(user.id);
  }, [user?.id, loadApps]);
  useEffect(() => {
    let canceled = false;
    void assistantApi
      .frontierModels()
      .then((result) => {
        if (!canceled) setModels(result.models);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, []);
  useEffect(() => {
    let canceled = false;
    if (!profileId) return;
    void personalAgentsApi
      .apps(profileId, spaceId)
      .then((result) => {
        if (!canceled) {
          setAssigned(result.app_ids);
          setBaselineAssigned(result.app_ids);
          setReady(true);
        }
      })
      .catch((reason) => {
        if (!canceled) setError(String(reason));
      });
    void personalAgentsApi
      .memories(profileId, spaceId)
      .then((result) => {
        if (!canceled) setMemories(result.memories);
      })
      .catch((reason) => {
        if (!canceled) setError(String(reason));
      });
    return () => {
      canceled = true;
    };
  }, [profileId, spaceId]);
  const update = <K extends keyof AgentProfileInput>(key: K, value: AgentProfileInput[K]) =>
    setDraft({ ...draft, [key]: value });
  async function save() {
    setBusy(true);
    setError("");
    try {
      const {
        name,
        role,
        description,
        instructions,
        icon,
        avatar,
        model_mode,
        model_id,
        reasoning_effort,
        enabled,
      } = draft;
      const saved = await personalAgentsApi.save(
        {
          name,
          role,
          description,
          instructions,
          icon,
          avatar,
          model_mode,
          model_id,
          reasoning_effort,
          enabled,
          version: profile?.version,
          assignment: { space_id: "", app_ids: assigned },
        },
        profile?.id,
      );
      await onSaved(saved.id);
      setBaselineDraft(draft);
      setBaselineAssigned(assigned);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function talk() {
    if (!profile) return;
    try {
      await openMisty({ spaceId, agentId: profile.id });
    } catch (reason) {
      setError(String(reason));
    }
  }
  return (
    <form
      className="max-w-2xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-medium">{profile ? profile.name : "Create an agent"}</h2>
          <p className="mt-1 text-sm text-cream-muted">
            Personal to you, including in shared Spaces.
          </p>
        </div>
        {profile && (
          <button type="button" className={button} onClick={() => void talk()}>
            <MessageSquare size={15} className="mr-2 inline" />
            Talk to agent
          </button>
        )}
      </div>
      <label className="block space-y-2 text-sm">
        <span>Name</span>
        <input
          className={field}
          required
          maxLength={80}
          value={draft.name}
          readOnly={profile?.system_managed}
          onChange={(e) => update("name", e.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>Avatar</span>
        <input
          className={`${field} max-w-28`}
          aria-label="Avatar emoji"
          maxLength={12}
          value={typeof draft.avatar?.emoji === "string" ? draft.avatar.emoji : ""}
          placeholder="✦"
          onChange={(e) => update("avatar", { ...draft.avatar, emoji: e.target.value })}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>Responsibility</span>
        <input
          className={field}
          maxLength={160}
          placeholder="Manage launch communications"
          value={draft.role}
          onChange={(e) => update("role", e.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>Instructions</span>
        <textarea
          className={`${field} min-h-32 resize-y`}
          maxLength={16000}
          placeholder="What should this agent know about how you work?"
          value={draft.instructions}
          onChange={(e) => update("instructions", e.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>Model</span>
        <select
          className={field}
          value={draft.model_mode === "automatic" ? "" : draft.model_id}
          onChange={(e) =>
            setDraft({
              ...draft,
              model_mode: e.target.value ? "pinned" : "automatic",
              model_id: e.target.value,
              reasoning_effort: "",
            })
          }
        >
          <option value="">Misty default</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="border-t border-charcoal-border pt-5">
        <legend className="pr-3 text-sm font-medium">Personal apps</legend>
        <p className="mb-3 text-sm text-cream-muted">
          An assigned app includes its configured integrations.
        </p>
        {!installations ? (
          <p role="status" className="text-sm">
            Loading installed apps…
          </p>
        ) : (
          installations
            .filter(
              (app) =>
                app.state === "installed" && !app.consent_required && app.app_id !== "agents",
            )
            .map((app) => (
              <label key={app.app_id} className="flex items-center gap-3 rounded-md py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-cream focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cream-muted"
                  disabled={!ready || busy}
                  checked={assigned.includes(app.app_id)}
                  onChange={(e) =>
                    setAssigned(
                      e.target.checked
                        ? [...assigned, app.app_id]
                        : assigned.filter((id) => id !== app.app_id),
                    )
                  }
                />
                {catalog.find((item) => item.id === app.app_id)?.name ?? app.app_id}
              </label>
            ))
        )}
        {installations?.filter(
          (app) => app.state === "installed" && !app.consent_required && app.app_id !== "agents",
        ).length === 0 && (
          <p className="text-sm text-cream-muted">
            Install and review personal apps in Discover to assign them.
          </p>
        )}
      </fieldset>
      {!!memories.length && (
        <section className="border-t border-charcoal-border pt-5">
          <h3 className="mb-2 text-sm font-medium">Remembered preferences</h3>
          {memories.map((memory) => (
            <div key={memory.id} className="flex items-start gap-3 py-2 text-sm">
              <div className="flex-1">
                {editingMemory === memory.id ? (
                  <label className="block">
                    <span className="sr-only">Preference</span>
                    <textarea
                      className={field}
                      maxLength={1000}
                      value={memoryDraft}
                      onChange={(e) => setMemoryDraft(e.target.value)}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className={button}
                        disabled={!memoryDraft.trim()}
                        onClick={() => {
                          void personalAgentsApi
                            .updateMemory(profile!.id, memory.id, spaceId, memoryDraft)
                            .then(() => {
                              setMemories((items) =>
                                items.map((item) =>
                                  item.id === memory.id ? { ...item, content: memoryDraft } : item,
                                ),
                              );
                              setEditingMemory(undefined);
                            })
                            .catch((reason) => setError(String(reason)));
                        }}
                      >
                        Save preference
                      </button>
                      <button
                        type="button"
                        className={button}
                        onClick={() => setEditingMemory(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  </label>
                ) : (
                  memory.content
                )}
                <span className="mt-1 block text-xs text-cream-muted">
                  {memory.space_id ? "This Space" : "All Spaces"}
                </span>
              </div>
              <button
                type="button"
                className={button}
                onClick={() => {
                  setEditingMemory(memory.id);
                  setMemoryDraft(memory.content);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className={button}
                onClick={() => {
                  void personalAgentsApi
                    .forget(profile!.id, memory.id)
                    .then(() =>
                      setMemories((items) => items.filter((item) => item.id !== memory.id)),
                    )
                    .catch((reason) => setError(String(reason)));
                }}
              >
                Forget
              </button>
            </div>
          ))}
          <button type="button" className="text-sm underline" onClick={() => void talk()}>
            Ask this agent to change a preference
          </button>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 border-t border-charcoal-border pt-4">
        <button
          className={`${button} bg-charcoal-active`}
          disabled={busy || !ready || !draft.name.trim()}
          type="submit"
        >
          {busy ? "Saving…" : profile ? "Save changes" : "Create agent"}
        </button>
        {profile && !profile.system_managed && (
          <button
            type="button"
            className={`${button} ml-auto`}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} className="mr-1 inline" />
            Delete agent
          </button>
        )}
      </div>
      {confirmDelete && (
        <div role="alert" className="space-y-3 text-sm">
          <p>
            Delete {profile?.name}? Active work will stop. Existing conversation history is
            retained.
          </p>
          <button type="button" className={button} onClick={() => setConfirmDelete(false)}>
            Keep agent
          </button>{" "}
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void personalAgentsApi
                .remove(profile!.id)
                .then(onRemoved)
                .catch((reason) => setError(String(reason)))
                .finally(() => setBusy(false));
            }}
          >
            Delete agent
          </button>
        </div>
      )}
    </form>
  );
}
