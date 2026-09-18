import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { AgentSearchDialog } from "./components/AgentSearchDialog";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { finishLocalExecution } from "./localExecution";
import { MistyModelPicker } from "@/features/global-search/MistyModelPicker";
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  MessageSquare,
  ChevronsRight,
  History,
  Monitor,
  MoreHorizontal,
  Settings,
  Plus,
  Search,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
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
import { AgentWorkspaceConversation } from "./components/AgentWorkspaceConversation";
import { AgentAvatar, AgentCloudImage } from "./components/AgentAvatar";
import { agentCloudAvatar, agentCloudVariants } from "./components/agentCloudAvatars";
import "./agentsWorkspace.css";

const field =
  "w-full rounded-md border border-charcoal-border bg-charcoal-bg px-3 py-2 text-sm text-cream";
const button =
  "rounded-md border border-charcoal-border px-3 py-2 text-sm enabled:hover:bg-charcoal-active disabled:text-cream-muted disabled:cursor-not-allowed disabled:opacity-100";
const emptyProfile: AgentProfileInput = {
  name: "",
  role: "",
  description: "",
  instructions: "",
  icon: "sparkles",
  avatar: { cloudVariant: "lavender" },
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [details, setDetails] = useState(false);
  const [history, setHistory] = useState(false);
  const [params] = useSearchParams();
  const [activity, setActivity] = useState(
    () => params.get("view") === "automations" || params.has("run"),
  );
  const [connections, setConnections] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mobileList, setMobileList] = useState(false);
  const [editorStatus, setEditorStatus] = useState({ dirty: false, busy: false });
  const [chatRevision, setChatRevision] = useState(0);
  const [conversationStatus, setConversationStatus] = useState({ dirty: false, busy: false });
  const [pendingChange, setPendingChange] = useState<() => void>();
  const working = useMistyStore((s) => s.working);
  const conversations = useMistyStore((s) => s.conversations);
  const conversationsLoading = useMistyStore((s) => s.conversationsLoading);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const executionMode = useMistyStore((s) => s.executionMode);
  const scopedConversations = conversations.filter((c) => (c.spaceId || "") === spaceId);

  useEffect(() => {
    void load(user?.id ?? "");
    setSelected(undefined);
    setSettings(false);
  }, [user?.id, load]);
  const profile =
    agents.find((a) => a.id === selected) ??
    (selected === "new" ? undefined : (agents.find((a) => a.system_managed) ?? agents[0]));
  const conversation = scopedConversations.find(
    (c) =>
      c.id === activeConversationId &&
      (c.agentId === profile?.id || (!c.agentId && profile?.system_managed)),
  );
  const panelOpen = settings || details || history;
  const closePanel = () =>
    change(() => {
      setSettings(false);
      setDetails(false);
      setHistory(false);
      if (selected === "new") setSelected(undefined);
    }, selected === "new");
  const showSettings = () =>
    change(() => {
      setSettings(true);
      setDetails(false);
      setHistory(false);
      setActivity(false);
      setNewChat(false);
    }, false);
  const showActivity = () =>
    change(() => {
      setActivity(true);
      setSettings(false);
      setDetails(false);
      setHistory(false);
      setMobileList(false);
    });
  const change = (action: () => void, replacesConversation = true) => {
    if (editorStatus.busy || (replacesConversation && conversationStatus.busy)) return;
    if (editorStatus.dirty || (replacesConversation && conversationStatus.dirty))
      setPendingChange(() => action);
    else action();
  };
  const select = (id: string, startNew = false) =>
    change(() => {
      setChatRevision((n) => n + 1);
      setSelected(id);
      setNewChat(false);
      setSettings(false);
      setActivity(false);
      setMobileList(false);
      useMistyStore.setState({
        activeConversationId: startNew
          ? ""
          : (scopedConversations.find(
              (c) =>
                c.agentId === id || (!c.agentId && agents.find((a) => a.id === id)?.system_managed),
            )?.id ?? ""),
        context: [],
        handoff: undefined,
        browserRequest: undefined,
      });
    });
  const create = () =>
    change(() => {
      setNewChat(false);
      setDetails(false);
      setHistory(false);
      setSelected("new");
      setSettings(true);
      setActivity(false);
      setMobileList(false);
    });
  return (
    <main
      className={`agents-workspace${mobileList ? " agents-workspace--list" : ""}${panelOpen ? " agents-workspace--settings" : ""}`}
    >
      <aside className="agents-roster" aria-label="Your agents">
        <header
          className="agents-roster-heading"
          data-tauri-drag-region
          data-misty-window-titlebar-region="true"
        >
          <h1 className="sr-only">Agents</h1>
          <button
            className="agent-icon-button"
            aria-label="New chat"
            title="New chat"
            disabled={working || editorStatus.busy}
            onClick={() =>
              change(() => {
                setNewChat(true);
                setRecipientSearch("");
                setActivity(false);
                setMobileList(false);
                setSettings(false);
                setDetails(false);
                setHistory(false);
              })
            }
          >
            <Plus size={20} />
          </button>
        </header>
        <button className="agents-search" onClick={() => setSearchOpen(true)} aria-label="Search">
          <Search size={17} />
          <span>Search</span>
        </button>
        <div className="agents-roster-list">
          {loading && !agents.length ? (
            <p className="agents-list-note" role="status">
              Loading agents…
            </p>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                className="agent-roster-row"
                aria-pressed={profile?.id === agent.id && selected !== "new" && !newChat}
                disabled={working || editorStatus.busy}
                onClick={() => select(agent.id)}
              >
                <AgentAvatar agent={agent} />
                <span className="agent-roster-copy">{agent.name}</span>
              </button>
            ))
          )}
          {!loading && !agents.length && !error && (
            <button className="agents-list-note" onClick={create}>
              Create your first agent
            </button>
          )}
        </div>
        <footer className="agents-roster-footer">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="agent-account" aria-label="Account and agent options">
                <span className="agent-account-avatar">
                  {(user?.name || "M")
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>{user?.name || "My account"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="agent-options-menu">
              <DropdownMenuItem onSelect={showActivity}>
                <Activity size={16} />
                Activity
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConnections(true)}>
                <Unplug size={16} />
                Connections
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={showSettings}>
                <Settings size={16} />
                Agent settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={working} onSelect={create}>
                <Plus size={16} />
                Create agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </footer>
      </aside>
      <div className="agents-main">
        {pendingChange && (
          <div className="agents-notice" role="alert">
            <p>
              You have unsaved changes or an unsent message. Keep editing, or discard them to
              switch.
            </p>
            <button className={button} onClick={() => setPendingChange(undefined)}>
              Keep editing
            </button>
            <button
              className={button}
              onClick={() => {
                pendingChange();
                setPendingChange(undefined);
                setEditorStatus({ dirty: false, busy: false });
              }}
            >
              Discard and switch
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="agents-notice">
            <p>{error}</p>
            <button className={button} onClick={() => void load(user?.id ?? "")}>
              Retry
            </button>
          </div>
        )}
        <header
          className="agent-conversation-heading"
          data-tauri-drag-region
          data-misty-window-titlebar-region="true"
        >
          <button
            className="agent-icon-button agents-mobile-back"
            aria-label="Show agents"
            onClick={() => setMobileList(true)}
          >
            <ArrowLeft size={20} />
          </button>
          {newChat ? (
            <>
              <label className="agent-recipient-input">
                <span>To:</span>
                <input
                  autoFocus
                  aria-label="Search or create agents"
                  placeholder="Search or create agents"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                />
              </label>
              <button
                className="agent-icon-button"
                aria-label="Close new chat"
                onClick={() => setNewChat(false)}
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <>
              <button
                className="agent-heading-identity"
                aria-label="View conversation details"
                onClick={() =>
                  change(() => {
                    setDetails(true);
                    setSettings(false);
                    setHistory(false);
                  }, false)
                }
              >
                <AgentAvatar agent={profile} />
                <h2>
                  {activity
                    ? "Activity"
                    : selected === "new"
                      ? "New agent"
                      : profile?.name || "Misty"}
                </h2>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="agent-icon-button" aria-label="Conversation actions">
                    <MoreHorizontal size={19} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="agent-options-menu">
                  <DropdownMenuItem
                    disabled={working}
                    onSelect={() => profile && select(profile.id, true)}
                  >
                    <Plus size={16} />
                    New conversation
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={working}
                    onSelect={() =>
                      change(() => {
                        setHistory(true);
                        setSettings(false);
                        setDetails(false);
                      }, false)
                    }
                  >
                    <History size={16} />
                    History
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={showSettings}>
                    <Settings size={16} />
                    Agent settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConnections(true)}>
                    <Unplug size={16} />
                    Connections
                  </DropdownMenuItem>
                  {activity && (
                    <DropdownMenuItem onSelect={() => setActivity(false)}>
                      <MessageSquare size={16} />
                      Conversation
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                className="agent-icon-button"
                aria-label={panelOpen ? "Close details" : "Agent details"}
                title="Agent details"
                aria-expanded={panelOpen}
                onClick={() => (panelOpen ? closePanel() : change(() => setDetails(true), false))}
              >
                <Monitor size={19} />
              </button>
            </>
          )}
        </header>
        {newChat ? (
          <div className="agent-new-chat">
            <div className="agent-recipient-results">
              <button onClick={create}>
                <Plus size={20} />
                Create new agent
              </button>
              {agents
                .filter((a) =>
                  a.name.toLocaleLowerCase().includes(recipientSearch.trim().toLocaleLowerCase()),
                )
                .map((a) => (
                  <button key={a.id} onClick={() => select(a.id, true)}>
                    <AgentAvatar agent={a} />
                    {a.name}
                  </button>
                ))}
            </div>
          </div>
        ) : activity ? (
          <MistyDashboard
            spaceId={spaceId}
            agentId={profile?.id}
            onManageConnections={() => setConnections(true)}
          />
        ) : (
          <AgentWorkspaceConversation
            key={`${user?.id}:${profile?.id}:${spaceId}:${chatRevision}`}
            agent={profile}
            spaceId={spaceId}
            accountId={user?.id ?? ""}
            userName={user?.name}
            onDraftStateChange={setConversationStatus}
            onCreate={create}
          />
        )}
      </div>
      {panelOpen && (
        <aside
          className="agent-settings-panel"
          aria-label={
            settings ? "Agent settings" : history ? "Conversation history" : "Conversation details"
          }
        >
          <header>
            {settings || history ? (
              <button
                className="agent-icon-button"
                aria-label="Back to details"
                onClick={() =>
                  change(() => {
                    setSettings(false);
                    setHistory(false);
                    setDetails(true);
                  }, false)
                }
              >
                <ArrowLeft size={18} />
              </button>
            ) : (
              <button
                className="agent-icon-button"
                aria-label="Agent settings"
                onClick={showSettings}
              >
                <Settings size={18} />
              </button>
            )}
            <h3>
              {settings
                ? selected === "new"
                  ? "New agent"
                  : "Settings"
                : history
                  ? "History"
                  : ""}
            </h3>
            <button
              className="agent-icon-button"
              aria-label="Close settings"
              disabled={editorStatus.busy}
              onClick={closePanel}
            >
              <ChevronsRight size={20} />
            </button>
          </header>
          {settings ? (
            <div className="agent-settings-content">
              {(selected === "new" || profile) && (
                <AgentEditor
                  key={`${user?.id}:${selected}:${profile?.id}:${spaceId}`}
                  profile={profile}
                  onStatusChange={setEditorStatus}
                  onTalk={closePanel}
                  spaceId={spaceId}
                  onSaved={async (id) => {
                    await load(user?.id ?? "");
                    setSelected(id);
                    setPendingChange(undefined);
                  }}
                  onRemoved={async () => {
                    setSelected(undefined);
                    setSettings(false);
                    await load(user?.id ?? "");
                  }}
                />
              )}
              <section className="agent-conversation-settings">
                <h4>Conversation</h4>
                <label className="agents-space-label">
                  <span>Work context</span>
                  <select
                    aria-label="Agent work Space"
                    value={spaceId}
                    disabled={working || editorStatus.busy}
                    onChange={(e) => {
                      const id = e.target.value;
                      change(() => {
                        setAssignedSpaceId(id);
                        useMistyStore.setState({
                          activeConversationId: "",
                          context: [],
                          handoff: undefined,
                          browserRequest: undefined,
                        });
                      });
                    }}
                  >
                    {!spaces.length && <option value="">Personal</option>}
                    {spaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {hasTauriInternals() && /Mac|Win/.test(navigator.platform) && (
                  <label className="agents-space-label">
                    <span>Work mode</span>
                    <select
                      aria-label="Agent execution mode"
                      disabled={working}
                      value={executionMode ?? "user"}
                      onChange={(e) => {
                        const mode = e.target.value as "user" | "agent" | "team";
                        void finishLocalExecution()
                          .then(() => useMistyStore.setState({ executionMode: mode }))
                          .catch((reason) => useMistyStore.setState({ error: String(reason) }));
                      }}
                    >
                      <option value="user">Discuss and draft</option>
                      <option value="agent">Work in this window</option>
                      <option value="team">Work in a separate window</option>
                    </select>
                  </label>
                )}
                {conversation && (
                  <MistyModelPicker
                    conversationId={conversation.id}
                    modelId={conversation.modelId}
                    reasoningEffort={conversation.reasoningEffort}
                    disabled={working}
                    onChange={(changes) =>
                      useMistyStore.setState((s) => ({
                        conversations: s.conversations.map((c) =>
                          c.id === conversation.id ? { ...c, ...changes } : c,
                        ),
                      }))
                    }
                  />
                )}
              </section>
            </div>
          ) : history ? (
            <div className="agent-history">
              {conversationsLoading ? (
                <p role="status">Loading conversations…</p>
              ) : !scopedConversations.some(
                  (c) => c.agentId === profile?.id || (!c.agentId && profile?.system_managed),
                ) ? (
                <p>No conversations yet.</p>
              ) : (
                scopedConversations
                  .filter(
                    (c) => c.agentId === profile?.id || (!c.agentId && profile?.system_managed),
                  )
                  .map((c) => (
                    <button
                      key={c.id}
                      aria-pressed={c.id === activeConversationId}
                      disabled={working}
                      onClick={() =>
                        change(() => {
                          setChatRevision((n) => n + 1);
                          useMistyStore.getState().selectConversation(c.id);
                          setHistory(false);
                        })
                      }
                    >
                      <span>{c.title}</span>
                      <time>
                        {new Date(c.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                    </button>
                  ))
              )}
            </div>
          ) : (
            <div className="agent-details-content">
              <button
                className="agent-workspace-preview"
                onClick={showActivity}
                aria-label="View agent activity"
              >
                <Monitor size={25} />
              </button>
              <p className="agent-preview-caption">{profile?.name || "Misty"}'s activity</p>
              <div className="agent-details-routines">
                <p>View ongoing work, scheduled tasks, and approvals.</p>
                <button onClick={showActivity}>
                  Open activity
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </aside>
      )}
      <AgentSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        agents={agents}
        conversations={scopedConversations}
        disabled={working || editorStatus.busy}
        onAgent={select}
        onConversation={(c) =>
          change(() => {
            setSelected(c.agentId || agents.find((a) => a.system_managed)?.id);
            setNewChat(false);
            setSettings(false);
            setDetails(false);
            setHistory(false);
            setActivity(false);
            setMobileList(false);
            setChatRevision((n) => n + 1);
            useMistyStore.getState().selectConversation(c.id);
          })
        }
        onCreate={create}
        onSettings={showSettings}
        onActivity={showActivity}
        onConnections={() => setConnections(true)}
      />
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
  onTalk,
}: {
  profile?: AgentProfile;
  spaceId: string;
  onSaved(id: string): Promise<void>;
  onRemoved(): Promise<void>;
  onStatusChange(status: { dirty: boolean; busy: boolean }): void;
  onTalk?: () => void;
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
  const [avatarEditing, setAvatarEditing] = useState(false);
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
    if (onTalk) {
      onTalk();
      return;
    }
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
      <div className="agent-settings-avatar">
        <button
          type="button"
          aria-label="Edit agent avatar"
          onClick={() => setAvatarEditing(!avatarEditing)}
        >
          <AgentAvatar
            agent={
              { ...profile, name: draft.name || "Agent", avatar: draft.avatar } as AgentProfile
            }
            large
          />
        </button>
      </div>
      {avatarEditing && (
        <div className="agent-avatar-picker">
          <fieldset>
            <legend>Cloud avatar</legend>
            <div className="agent-cloud-options">
              {agentCloudVariants.map((variant) => {
                const chosen =
                  !draft.avatar?.emoji &&
                  agentCloudAvatar({
                    id: profile?.id ?? "",
                    name: draft.name,
                    avatar: draft.avatar,
                    system_managed: profile?.system_managed ?? false,
                  }).id === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    aria-label={`${variant.name}, ${variant.expression}`}
                    aria-pressed={chosen}
                    disabled={busy}
                    onClick={() =>
                      update("avatar", { ...draft.avatar, emoji: "", cloudVariant: variant.id })
                    }
                  >
                    <AgentCloudImage variant={variant} />
                    <span>{variant.name}</span>
                    <small>{variant.expression}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="block space-y-2 text-sm">
            <span>Custom emoji</span>
            <input
              className={`${field} max-w-28`}
              aria-label="Avatar emoji"
              maxLength={12}
              value={typeof draft.avatar?.emoji === "string" ? draft.avatar.emoji : ""}
              placeholder="Optional"
              disabled={busy}
              onChange={(e) => update("avatar", { ...draft.avatar, emoji: e.target.value })}
            />
          </label>
        </div>
      )}
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
        <span>Label (optional)</span>
        <input
          className={field}
          maxLength={160}
          placeholder="Manage launch communications"
          value={draft.role}
          onChange={(e) => update("role", e.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>Description</span>
        <textarea
          className={`${field} min-h-20 resize-y`}
          maxLength={2000}
          placeholder="What this agent helps you with"
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </label>
      <details className="agent-advanced-settings">
        <summary>Instructions, model, and apps</summary>
        <div>
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
                  <label
                    key={app.app_id}
                    className="flex items-center gap-3 rounded-md py-2 text-sm"
                  >
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
              (app) =>
                app.state === "installed" && !app.consent_required && app.app_id !== "agents",
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
                                      item.id === memory.id
                                        ? { ...item, content: memoryDraft }
                                        : item,
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
        </div>
      </details>
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
