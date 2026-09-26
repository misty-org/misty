import { observeAccountChanges } from "@/api/accountEvents";
import { personalAgentsApi, type AgentMemory } from "@/api/agents/native";
import { useAuth } from "@/features/auth";
import { MistyModelPicker } from "@/features/global-search/MistyModelPicker";
import { openMisty } from "@/features/misty/handoff";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile, AgentProfileInput } from "@/shared/contracts";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  NavigationChevron,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui";
import {
  Activity,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./agentsWorkspace.css";
import { AgentAvatar, AgentCloudImage } from "./components/AgentAvatar";
import { agentCloudAvatar, agentCloudVariants } from "./components/agentCloudAvatars";
import { AgentSettingsModal, type AgentSettingsTab } from "./components/AgentSettingsModal";
import { AgentWorkspaceConversation } from "./components/AgentWorkspaceConversation";
import { MistyDashboard } from "./components/MistyDashboard";
import { usePersonalAgentsStore } from "./personalAgentsStore";
function relativeTime(value: string | number | undefined): string {
  if (!value) return "";
  const timestamp = typeof value === "string" ? Date.parse(value) : value;
  if (Number.isNaN(timestamp)) return "";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
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
  avatar: {
    cloudVariant: "lavender",
  },
  model_mode: "automatic",
  model_id: "",
  reasoning_effort: "",
  enabled: true,
};
export default function NativeAgentsPage() {
  const { user } = useAuth();
  // New work is personal. Historical conversations retain their saved scope when reopened.
  const spaceId = "";
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [newChat, setNewChat] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [params] = useSearchParams();
  const [activity, setActivity] = useState(() => params.get("view") === "activity");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<AgentSettingsTab>("settings");
  const [settingsModalMode, setSettingsModalMode] = useState<"edit" | "create">("edit");
  const [activeDropdownAgentId, setActiveDropdownAgentId] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});
  const isExpanded = (id: string) => expandedAgents[id] ?? true;
  const [editorStatus, setEditorStatus] = useState({
    dirty: false,
    busy: false,
  });
  const [chatRevision, setChatRevision] = useState(0);
  const [conversationStatus, setConversationStatus] = useState({
    dirty: false,
    busy: false,
  });
  const [pendingChange, setPendingChange] = useState<() => void>();
  const working = useMistyStore((s) => s.working);
  const conversations = useMistyStore((s) => s.conversations);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const conversationSpaceId =
    conversations.find((c) => c.id === activeConversationId)?.spaceId ?? "";
  const scopedConversations = conversations;
  useEffect(() => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    if (!user?.id) {
      void load("");
      return;
    }
    return observeAccountChanges(user.id, ["agents"], () => load(user.id));
  }, [user?.id, load]);
  // Global search links here with ?agent=; it sets the conversation in the store first.
  const linkedAgentId = params.get("agent");
  useEffect(() => {
    if (!linkedAgentId) return;
    setSelected(linkedAgentId);
    setNewChat(false);
    setActivity(false);
    setChatRevision((n) => n + 1);
  }, [linkedAgentId, params]);
  const profile =
    agents.find((a) => a.id === selected) ??
    (selected === "new" ? undefined : (agents.find((a) => a.system_managed) ?? agents[0]));
  const conversation = scopedConversations.find(
    (c) =>
      c.id === activeConversationId &&
      (c.agentId === profile?.id || (!c.agentId && profile?.system_managed)),
  );
  const openSettingsModal = (tab: AgentSettingsTab = "settings") =>
    change(() => {
      setSettingsModalMode("edit");
      setSettingsModalTab(tab);
      setSettingsModalOpen(true);
    }, false);
  const showSettings = () => openSettingsModal("settings");
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
      setActivity(false);
      if (startNew) {
        setExpandedAgents((prev) => ({
          ...prev,
          [id]: true,
        }));
      }
      useMistyStore.setState({
        selectedAgentId: id,
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
      setSettingsModalMode("create");
      setSettingsModalTab("settings");
      setSettingsModalOpen(true);
      setActivity(false);
    });
  return (
    <main className={`agents-workspace${""}`}>
      <aside className="agents-roster" aria-label="Your agents">
        <header
          className="agents-roster-heading"
          data-tauri-drag-region
          data-misty-window-titlebar-region="true"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-cream-muted px-1">
            Agents
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="agent-icon-button"
              onClick={showSettings}
              aria-label="Agent settings"
              title="Agent settings"
            >
              <SlidersHorizontal className="size-4 shrink-0" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="agent-icon-button"
              onClick={() =>
                change(() => {
                  setNewChat(true);
                  setRecipientSearch("");
                  setActivity(false);
                  setSettingsModalOpen(false);
                })
              }
              aria-label="New chat"
              title="New chat"
              disabled={working || editorStatus.busy}
            >
              <Plus className="size-4 shrink-0" />
            </Button>
          </div>
        </header>
        <div className="agents-roster-list">
          {loading && !agents.length ? (
            <p className="agents-list-note" role="status">
              Loading agents…
            </p>
          ) : (
            agents.map((agent) => {
              const expanded = isExpanded(agent.id);
              const isAgentSelected = profile?.id === agent.id && selected !== "new" && !newChat;
              const isDropdownOpen = activeDropdownAgentId === agent.id;
              const agentConversations = scopedConversations.filter(
                (c) => c.agentId === agent.id || (!c.agentId && agent.system_managed),
              );
              return (
                <div key={agent.id} className="mb-0.5 w-full">
                  <div
                    className={cn(
                      "group/agent-row relative flex items-center h-[38px] w-full px-2 rounded-lg transition-colors gap-2 box-border select-none",
                      isAgentSelected
                        ? "bg-charcoal-active/80 text-cream-bright shadow-xs"
                        : isDropdownOpen
                          ? "bg-charcoal-card text-cream-bright"
                          : "hover:bg-charcoal-card text-cream",
                    )}
                  >
                    <button
                      type="button"
                      className="flex items-center gap-2 flex-1 min-w-0 h-full py-0.5 text-left border-none bg-transparent outline-none cursor-pointer text-inherit"
                      aria-pressed={isAgentSelected}
                      disabled={working || editorStatus.busy}
                      onClick={() => {
                        setExpandedAgents((prev) => ({
                          ...prev,
                          [agent.id]: !expanded,
                        }));
                        select(agent.id);
                      }}
                    >
                      <div className="size-7 shrink-0 flex items-center justify-center">
                        <AgentAvatar agent={agent} />
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 flex-1">
                        <span className="agent-roster-copy font-medium text-[13px] truncate">
                          {agent.name}
                        </span>
                        <span
                          aria-hidden="true"
                          className="grid size-4 shrink-0 place-items-center text-cream-muted transition-opacity opacity-0 group-hover/agent-row:opacity-100"
                        >
                          <NavigationChevron open={expanded} />
                        </span>
                      </div>
                    </button>

                    <div
                      className={cn(
                        "flex items-center gap-0.5 shrink-0 w-[52px] justify-end transition-opacity",
                        isDropdownOpen
                          ? "opacity-100"
                          : "opacity-0 group-hover/agent-row:opacity-100 focus-within:opacity-100",
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 text-cream-muted hover:text-cream-bright p-0"
                        aria-label="New conversation"
                        title="New conversation"
                        disabled={working || editorStatus.busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          select(agent.id, true);
                        }}
                      >
                        <Plus className="size-3.5 shrink-0" />
                      </Button>
                      <DropdownMenu
                        open={isDropdownOpen}
                        onOpenChange={(open) => setActiveDropdownAgentId(open ? agent.id : null)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className={cn(
                              "size-6 text-cream-muted hover:text-cream-bright p-0",
                              isDropdownOpen && "text-cream-bright",
                            )}
                            aria-label="Agent options"
                          >
                            <MoreHorizontal className="size-3.5 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="agent-options-menu">
                          <DropdownMenuItem onSelect={() => select(agent.id, true)}>
                            <Plus className="size-3.5 shrink-0" />
                            New conversation
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setSelected(agent.id);
                              openSettingsModal("settings");
                            }}
                          >
                            <SlidersHorizontal className="size-3.5 shrink-0" />
                            Agent settings
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={create}>
                            <Plus className="size-3.5 shrink-0" />
                            Create new agent
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {expanded && (
                    <div
                      className="agent-conversations-branch max-h-60 overflow-y-auto pl-3 pr-1 py-0.5 space-y-0.5 misty-transient-scrollbar"
                      data-agent-branch={agent.id}
                    >
                      {agentConversations.length === 0 ? (
                        <div className="relative flex items-center h-6 pl-2 text-[11px] text-cream-muted/60 italic">
                          <span>No conversations yet</span>
                        </div>
                      ) : (
                        agentConversations.map((c) => {
                          const isActiveConvo =
                            activeConversationId === c.id && isAgentSelected && !activity;
                          return (
                            <div
                              key={c.id}
                              className="relative flex items-center h-7 pr-1 text-[12px] group/branch-row"
                            >
                              <button
                                type="button"
                                className={cn(
                                  "flex items-center gap-1.5 w-full h-full rounded-md px-2 text-left transition-colors truncate",
                                  isActiveConvo
                                    ? "bg-charcoal-active text-cream-bright font-medium"
                                    : "text-cream-muted hover:text-cream-bright hover:bg-charcoal-card",
                                )}
                                onClick={() => {
                                  change(() => {
                                    setChatRevision((n) => n + 1);
                                    setSelected(agent.id);
                                    setNewChat(false);
                                    setActivity(false);
                                    useMistyStore.getState().selectConversation(c.id);
                                  });
                                }}
                              >
                                {isActiveConvo ? (
                                  <span className="size-1.5 rounded-full bg-blue-400 shrink-0" />
                                ) : (
                                  <MessageSquare className="size-3 text-cream-muted/60 shrink-0" />
                                )}
                                <span className="truncate flex-1">
                                  {c.title || "Untitled Conversation"}
                                </span>
                                <span className="text-[10px] text-cream-muted/50 tabular-nums shrink-0 ml-1">
                                  {relativeTime(c.updatedAt)}
                                </span>
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {!loading && !agents.length && !error && (
            <Button variant="ghost" className="agents-list-note" onClick={create}>
              Create your first agent
            </Button>
          )}
        </div>
      </aside>
      <div className="agents-main">
        {pendingChange && !settingsModalOpen && (
          <div className="agents-notice" role="alert">
            <p>
              You have unsaved changes or an unsent message. Keep editing, or discard them to
              switch.
            </p>
            <Button variant="ghost" className={button} onClick={() => setPendingChange(undefined)}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              className={button}
              onClick={() => {
                pendingChange();
                setPendingChange(undefined);
                setEditorStatus({
                  dirty: false,
                  busy: false,
                });
              }}
            >
              Discard and switch
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="agents-notice">
            <p>{error}</p>
            <Button variant="ghost" className={button} onClick={() => void load(user?.id ?? "")}>
              Retry
            </Button>
          </div>
        )}
        <header
          className="agent-conversation-heading"
          data-tauri-drag-region
          data-misty-window-titlebar-region="true"
        >
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
              <Button
                variant="ghost"
                size="icon-sm"
                className="agent-icon-button"
                aria-label="Close new chat"
                onClick={() => setNewChat(false)}
              >
                <X size={18} />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="agent-heading-identity"
                aria-label="Agent details"
                onClick={() => openSettingsModal("settings")}
              >
                <AgentAvatar agent={profile} />
                <h2>
                  {activity
                    ? "Activity"
                    : selected === "new"
                      ? "New agent"
                      : profile?.name || "Misty"}
                </h2>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "agent-icon-button",
                  activity && "bg-charcoal-active text-cream-bright",
                )}
                aria-label={activity ? "Hide activity" : "View agent activity"}
                title={activity ? "Hide activity" : "Agent activity and details"}
                aria-pressed={activity}
                onClick={() => setActivity((prev) => !prev)}
              >
                <Activity size={18} />
              </Button>
            </>
          )}
        </header>
        {newChat ? (
          <div className="agent-new-chat">
            <div className="agent-recipient-results" role="group" aria-label="Choose an agent">
              <Button variant="ghost" onClick={create}>
                <Plus size={20} />
                Create new agent
              </Button>
              {agents
                .filter((a) =>
                  a.name.toLocaleLowerCase().includes(recipientSearch.trim().toLocaleLowerCase()),
                )
                .map((a) => (
                  <Button variant="ghost" key={a.id} onClick={() => select(a.id, true)}>
                    <AgentAvatar agent={a} />
                    {a.name}
                  </Button>
                ))}
            </div>
          </div>
        ) : (
          <AgentWorkspaceConversation
            key={`${user?.id}:${profile?.id}:${conversationSpaceId}:${chatRevision}`}
            agent={profile}
            spaceId={conversationSpaceId}
            accountId={user?.id ?? ""}
            userName={user?.name}
            onDraftStateChange={setConversationStatus}
            onCreate={create}
          />
        )}
      </div>

      <Sheet open={activity} onOpenChange={setActivity} modal={false}>
        <SheetContent
          side="right"
          portal={false}
          overlay={false}
          className="flex w-[min(560px,94vw)] flex-col overflow-hidden border-l border-charcoal-border bg-charcoal-bg p-0 text-cream shadow-2xl sm:max-w-[560px]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Agent activity</SheetTitle>
            <SheetDescription>Your private tasks, delegated work, and approvals.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MistyDashboard
              spaceId={spaceId}
              agentId={profile?.id}
              onManageConnections={() => openSettingsModal("connections")}
            />
          </div>
        </SheetContent>
      </Sheet>

      <AgentSettingsModal
        open={settingsModalOpen}
        onOpenChange={setSettingsModalOpen}
        activeTab={settingsModalTab}
        onTabChange={setSettingsModalTab}
        mode={settingsModalMode}
        disabled={working || editorStatus.busy}
        onCreateAgent={create}
        onNewConversation={() => {
          if (profile) select(profile.id, true);
          setSettingsModalOpen(false);
        }}
      >
        {pendingChange && (
          <div role="alert" className="agents-notice mb-4">
            <p>
              You have unsaved changes or an unsent message. Keep editing, or discard them to
              switch.
            </p>
            <Button variant="ghost" className={button} onClick={() => setPendingChange(undefined)}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              className={button}
              onClick={() => {
                pendingChange();
                setPendingChange(undefined);
              }}
            >
              Discard and switch
            </Button>
          </div>
        )}
        <div className="space-y-6">
          {(settingsModalMode === "create" || profile) && (
            <AgentEditor
              key={`${user?.id}:${settingsModalMode}:${profile?.id}:${spaceId}`}
              profile={settingsModalMode === "create" ? undefined : profile}
              onStatusChange={setEditorStatus}
              onTalk={() => setSettingsModalOpen(false)}
              spaceId={spaceId}
              onSaved={async (id) => {
                await load(user?.id ?? "");
                setSelected(id);
                setSettingsModalOpen(false);
                setPendingChange(undefined);
              }}
              onRemoved={async () => {
                setSelected(undefined);
                setSettingsModalOpen(false);
                await load(user?.id ?? "");
              }}
            />
          )}
          {settingsModalMode === "edit" && (
            <section className="agent-conversation-settings">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-cream-bright">Conversation</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(button, "h-7 text-xs gap-1.5")}
                  disabled={working}
                  onClick={() => {
                    if (profile) select(profile.id, true);
                    setSettingsModalOpen(false);
                  }}
                >
                  <Plus size={14} />
                  <span>New conversation</span>
                </Button>
              </div>
              {conversation && (
                <MistyModelPicker
                  conversationId={conversation.id}
                  modelId={conversation.modelId}
                  reasoningEffort={conversation.reasoningEffort}
                  disabled={working}
                  onChange={(changes) =>
                    useMistyStore.setState((s) => ({
                      conversations: s.conversations.map((c) =>
                        c.id === conversation.id
                          ? {
                              ...c,
                              ...changes,
                            }
                          : c,
                      ),
                    }))
                  }
                />
              )}
            </section>
          )}
        </div>
      </AgentSettingsModal>
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
  const profileId = profile?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [editingMemory, setEditingMemory] = useState<string>();
  const [memoryDraft, setMemoryDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [avatarEditing, setAvatarEditing] = useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baselineDraft) ||
    Boolean(
      editingMemory &&
      memoryDraft !== memories.find((memory) => memory.id === editingMemory)?.content,
    );
  useEffect(() => {
    onStatusChange({
      dirty,
      busy,
    });
    return () =>
      onStatusChange({
        dirty: false,
        busy: false,
      });
  }, [dirty, busy, onStatusChange]);
  useEffect(() => {
    let canceled = false;
    if (!profileId) return;
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
    setDraft({
      ...draft,
      [key]: value,
    });
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
        },
        profile?.id,
      );
      await onSaved(saved.id);
      setBaselineDraft(draft);
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
      await openMisty({
        spaceId,
        agentId: profile.id,
      });
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
      <div className="flex items-center gap-4 pb-1">
        <button
          type="button"
          aria-label="Edit agent avatar"
          onClick={() => setAvatarEditing(!avatarEditing)}
          className="group relative flex size-14 items-center justify-center rounded-xl border border-charcoal-border bg-charcoal-bg hover:border-cream-muted/60 transition-colors cursor-pointer overflow-hidden p-1 shrink-0"
        >
          <AgentAvatar
            agent={
              {
                ...profile,
                name: draft.name || "Agent",
                avatar: draft.avatar,
              } as AgentProfile
            }
            large
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
            <Pencil className="size-3.5 text-cream-bright" />
          </div>
        </button>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setAvatarEditing(!avatarEditing)}
            className="text-sm font-medium text-cream-bright hover:underline cursor-pointer flex items-center gap-1.5"
          >
            <span>{avatarEditing ? "Hide avatar options" : "Change avatar"}</span>
          </button>
          <p className="text-xs text-cream-muted mt-0.5">
            Pick a companion style or enter an emoji.
          </p>
        </div>
      </div>
      {avatarEditing && (
        <div className="rounded-xl border border-charcoal-border/70 bg-charcoal-bg/50 p-4 space-y-4">
          <div>
            <div className="text-xs font-medium text-cream-muted mb-2 uppercase tracking-wider">
              Misty mark
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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
                      update("avatar", {
                        ...draft.avatar,
                        emoji: "",
                        cloudVariant: variant.id,
                      })
                    }
                    className={cn(
                      "flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all text-center gap-1 cursor-pointer",
                      chosen
                        ? "border-cream-bright/80 bg-charcoal-active text-cream-bright shadow-xs ring-1 ring-cream-bright/30"
                        : "border-charcoal-border bg-charcoal-card/60 text-cream-muted hover:border-charcoal-border hover:bg-charcoal-active/40 hover:text-cream",
                    )}
                  >
                    <div className="size-10 shrink-0 flex items-center justify-center">
                      <AgentCloudImage variant={variant} />
                    </div>
                    <span className="text-xs font-medium text-cream leading-none">
                      {variant.name}
                    </span>
                    <span className="text-[10px] text-cream-muted leading-tight">
                      {variant.expression}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2 border-t border-charcoal-border/60">
            <label
              htmlFor="agent-custom-emoji"
              className="text-xs font-medium text-cream-muted shrink-0"
            >
              Custom emoji
            </label>
            <input
              id="agent-custom-emoji"
              className={cn(field, "w-24 text-center text-base py-1 px-2")}
              aria-label="Avatar emoji"
              maxLength={12}
              value={typeof draft.avatar?.emoji === "string" ? draft.avatar.emoji : ""}
              placeholder="Optional"
              disabled={busy}
              onChange={(e) =>
                update("avatar", {
                  ...draft.avatar,
                  emoji: e.target.value,
                })
              }
            />
            <span className="text-xs text-cream-muted/70">Replaces cloud avatar when set</span>
          </div>
        </div>
      )}
      <label className="block space-y-1.5 text-sm">
        <span className="text-cream-muted text-xs font-medium uppercase tracking-wider">Name</span>
        <input
          className={field}
          required
          maxLength={80}
          value={draft.name}
          readOnly={profile?.system_managed}
          onChange={(e) => update("name", e.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="text-cream-muted text-xs font-medium uppercase tracking-wider">
          Label (optional)
        </span>
        <input
          className={field}
          maxLength={160}
          placeholder="Manage launch communications"
          value={draft.role}
          onChange={(e) => update("role", e.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="text-cream-muted text-xs font-medium uppercase tracking-wider">
          Description
        </span>
        <textarea
          className={`${field} min-h-20 resize-y`}
          maxLength={2000}
          placeholder="What this agent helps you with"
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </label>
      <details className="agent-advanced-settings">
        <summary>Instructions and memory</summary>
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
                          <Button
                            variant="ghost"
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
                                        ? {
                                            ...item,
                                            content: memoryDraft,
                                          }
                                        : item,
                                    ),
                                  );
                                  setEditingMemory(undefined);
                                })
                                .catch((reason) => setError(String(reason)));
                            }}
                          >
                            Save preference
                          </Button>
                          <Button
                            variant="ghost"
                            type="button"
                            className={button}
                            onClick={() => setEditingMemory(undefined)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </label>
                    ) : (
                      memory.content
                    )}
                    <span className="mt-1 block text-xs text-cream-muted">
                      {memory.space_id ? "Saved conversation scope" : "Personal"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    type="button"
                    className={button}
                    onClick={() => {
                      setEditingMemory(memory.id);
                      setMemoryDraft(memory.content);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
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
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                type="button"
                className="text-sm underline"
                onClick={() => void talk()}
              >
                Ask this agent to change a preference
              </Button>
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
        <Button
          variant="ghost"
          className={`${button} bg-charcoal-active`}
          disabled={busy || !draft.name.trim()}
          type="submit"
        >
          {busy ? "Saving…" : profile ? "Save changes" : "Create agent"}
        </Button>
        {profile && !profile.system_managed && (
          <Button
            variant="ghost"
            type="button"
            className={`${button} ml-auto`}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} className="mr-1 inline" />
            Delete agent
          </Button>
        )}
      </div>
      {confirmDelete && (
        <div role="alert" className="space-y-3 text-sm">
          <p>
            Delete {profile?.name}? Active work will stop. Existing conversation history is
            retained.
          </p>
          <Button
            variant="ghost"
            type="button"
            className={button}
            onClick={() => setConfirmDelete(false)}
          >
            Keep agent
          </Button>{" "}
          <Button
            variant="ghost"
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
          </Button>
        </div>
      )}
    </form>
  );
}
