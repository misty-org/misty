import { ScheduledPage } from "@/features/scheduled/ScheduledPage";
import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { MistyModelPicker } from "@/features/global-search/MistyModelPicker";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  IconButton,
  Input,
} from "@/shared/ui";
import { ArrowLeft, PanelRight, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./agentsWorkspace.css";
import { AgentAvatar } from "./components/AgentAvatar";
import { AgentSwitcher } from "./components/AgentSwitcher";
import { AgentEditor } from "./components/AgentEditor";
import { AgentNavigationIsland, type AgentSection } from "./components/AgentNavigationIsland";
import { AgentSettingsModal, type AgentSettingsTab } from "./components/AgentSettingsModal";
import { AgentCollection } from "./components/AgentCollection";
import { AgentHistory } from "./components/AgentWorkspaceRoster";
import { AgentOverviewPanel } from "./components/AgentOverviewPanel";
import { AgentSetup } from "./components/AgentSetup";
import { useAgentAccess } from "./components/AgentAccess";
import { McpConnectionsSheet } from "./mcp/McpConnectionsSheet";
import {
  AgentWorkspaceConversation,
  type AgentVoiceControl,
} from "./components/AgentWorkspaceConversation";
import { MistyDashboard } from "./components/MistyDashboard";
import { usePersonalAgentsStore } from "./personalAgentsStore";

/*
 * THESIS: An ongoing conversation with an agent whose context and work remain visible.
 * OWN-WORLD: Misty monochrome shared controls, 6px buttons, 8px islands, existing cloud avatars.
 * STORY: Talk in the center; inspect identity, account access, activity and completed results at right.
 * FIRST VIEWPORT: Journal collection header, section and view islands, and shared item rows.
 * FORM: Desktop-only Journal entry; existing conversations and overview open from real rows.
 * SIGNATURE: The identity control reveals the overview without replacing the conversation or its draft.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */
export default function NativeAgentsPage() {
  const { user } = useAuth();
  const spaceId = "";
  const navigate = useNavigate();
  const access = useAgentAccess(user?.id ?? "");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const voiceRef = useRef<AgentVoiceControl>(null);
  const [voiceState, setVoiceState] = useState({ recording: false, busy: false });
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [newChat, setNewChat] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [entryOpen, setEntryOpen] = useState(!params.has("agent"));
  const [islandVisible, setIslandVisible] = useState(true);
  const islandId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const identityRef = useRef<HTMLButtonElement>(null);
  const recipientInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<AgentSection | undefined>(() =>
    ["activity", "automations"].includes(params.get("view") ?? "") ? "activity" : undefined,
  );
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<AgentSettingsTab>("settings");
  const [settingsModalMode, setSettingsModalMode] = useState<"edit" | "create">("edit");
  const [editorStatus, setEditorStatus] = useState({ dirty: false, busy: false });
  const [chatRevision, setChatRevision] = useState(0);
  const [conversationStatus, setConversationStatus] = useState({ dirty: false, busy: false });
  const [pendingChange, setPendingChange] = useState<() => void>();
  const working = useMistyStore((s) => s.working);
  const workingAgentId = useMistyStore((s) => s.selectedAgentId);
  const conversations = useMistyStore((s) => s.conversations);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const conversationSpaceId =
    conversations.find((c) => c.id === activeConversationId)?.spaceId ?? "";
  useEffect(() => {
    setSelected(undefined);
    setEntryOpen(true);
    setSettingsModalOpen(false);
    setConnectionsOpen(false);
    if (!user?.id) {
      void load("");
      return;
    }
    return observeAccountChanges(user.id, ["agents"], () => load(user.id));
  }, [user?.id, load]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(user?.id ?? "");
    if (user?.id) void store.loadConversations();
  }, [user?.id]);
  const linkedAgentId = params.get("agent");
  const linkedConversationId = params.get("conversation");
  useEffect(() => {
    if (!linkedAgentId) return;
    setEntryOpen(false);
    setSelected(linkedAgentId);
    setNewChat(false);
    setActiveSection(undefined);
    setChatRevision((n) => n + 1);
    const needsLoad =
      linkedConversationId &&
      useMistyStore.getState().activeConversationId !== linkedConversationId;
    useMistyStore.setState({
      selectedAgentId: linkedAgentId,
      activeConversationId: linkedConversationId ?? "",
    });
    if (needsLoad) void useMistyStore.getState().selectConversation(linkedConversationId);
  }, [linkedAgentId, linkedConversationId]);
  const profile =
    agents.find((a) => a.id === selected) ?? agents.find((a) => a.system_managed) ?? agents[0];
  const agentConversations = conversations.filter(
    (c) => c.agentId === profile?.id || (!c.agentId && profile?.system_managed),
  );
  const conversation = agentConversations.find((c) => c.id === activeConversationId);
  const change = (action: () => void, replacesConversation = true) => {
    if (
      pendingChange ||
      editorStatus.busy ||
      (replacesConversation && (conversationStatus.busy || working))
    )
      return;
    if (editorStatus.dirty || (replacesConversation && conversationStatus.dirty)) {
      setPendingChange(() => action);
    } else action();
  };
  const openSettingsModal = (tab: AgentSettingsTab = "settings") =>
    change(() => {
      setSettingsModalMode("edit");
      setSettingsModalTab(tab);
      setSettingsModalOpen(true);
      setActiveSection(undefined);
    }, false);
  const select = (id: string, startNew = false, conversationId?: string) =>
    change(() => {
      setChatRevision((n) => n + 1);
      setEntryOpen(false);
      setSelected(id);
      setVoiceState({ recording: false, busy: false });
      setNewChat(false);
      setActiveSection(undefined);
      setSettingsModalOpen(false);
      const latest = [...conversations]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .find(
          (c) =>
            c.agentId === id || (!c.agentId && agents.find((a) => a.id === id)?.system_managed),
        );
      const nextConversationId = startNew ? "" : (conversationId ?? latest?.id ?? "");
      const next = new URLSearchParams(params);
      next.set("agent", id);
      if (nextConversationId) next.set("conversation", nextConversationId);
      else next.delete("conversation");
      setParams(next, { replace: true });
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: nextConversationId,
        context: [],
        handoff: undefined,
        browserRequest: undefined,
      });
      if (nextConversationId) void useMistyStore.getState().selectConversation(nextConversationId);
    });
  const create = () =>
    change(() => {
      setNewChat(false);
      setSettingsModalMode("create");
      setSettingsModalTab("settings");
      setSettingsModalOpen(true);
      setActiveSection(undefined);
    });
  const beginNewChat = () =>
    change(() => {
      setEntryOpen(false);
      setNewChat(true);
      setRecipientSearch("");
      setActiveSection(undefined);
      setSettingsModalOpen(false);
    });
  const closeSettings = () => change(() => setSettingsModalOpen(false), false);
  const openSection = (section?: AgentSection) =>
    change(() => {
      setActiveSection(section);
      setSettingsModalOpen(false);
    }, false);
  const toggleIsland = () =>
    change(() => {
      setActiveSection(undefined);
      setIslandVisible(!islandVisible);
    }, false);
  const saveProfile = async (id: string, companion = false) => {
    await load(user?.id ?? "");
    setSelected(id);
    setEntryOpen(false);
    if (settingsModalMode === "create") {
      setChatRevision((n) => n + 1);
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: "",
        context: [],
        handoff: undefined,
        browserRequest: undefined,
      });
    }
    setSettingsModalMode("edit");
    setSettingsModalTab(companion ? "companion" : "settings");
    setSettingsModalOpen(companion);
    setActiveSection(undefined);
    setPendingChange(undefined);
  };
  const removeProfile = async () => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    setActiveSection(undefined);
    await load(user?.id ?? "");
  };
  const browseAgents = () =>
    change(() => {
      setEntryOpen(true);
      setActiveSection(undefined);
      const next = new URLSearchParams(params);
      next.delete("agent");
      next.delete("conversation");
      setParams(next, { replace: true });
    });
  const disabled = working || editorStatus.busy || conversationStatus.busy;
  const navigation = (
    <AgentNavigationIsland
      id={islandId}
      activeSection={activeSection}
      onSectionChange={openSection}
      collisionBoundary={workspaceRef.current}
      profileDisabled={!profile}
      contentRef={dropdownRef}
      dismissalBlocked={Boolean(pendingChange)}
      restoreTriggerFocus={!settingsModalOpen}
      conversations={
        <AgentHistory
          conversations={agentConversations}
          activeId={activeConversationId}
          disabled={disabled}
          onSelect={(id) => profile && select(profile.id, false, id)}
          onNewChat={() => profile && select(profile.id, true)}
        />
      }
      activity={<MistyDashboard spaceId={spaceId} agentId={profile?.id} />}
      profile={
        profile && (
          <>
            <AgentEditor
              key={`${user?.id}:${profile.id}:${spaceId}`}
              profile={profile}
              onStatusChange={setEditorStatus}
              onTalk={() => openSection()}
              spaceId={spaceId}
              onSaved={saveProfile}
              onRemoved={removeProfile}
            />
            {conversation && (
              <div className="agent-profile-model">
                <MistyModelPicker
                  inline
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
              </div>
            )}
          </>
        )
      }
    />
  );
  const overview = profile && (
    <AgentOverviewPanel
      key={`${user?.id}:${profile.id}`}
      profile={profile}
      access={access}
      conversations={agentConversations}
      navigation={navigation}
      working={working && (workingAgentId === profile.id || Boolean(conversation))}
      recording={voiceState.recording}
      voiceBusy={voiceState.busy || !user?.id}
      onTalk={() => voiceRef.current?.toggle()}
      onCompanion={() => openSettingsModal("companion")}
      onConnections={() => setConnectionsOpen(true)}
      onOpenResult={(href) => change(() => navigate(href))}
    />
  );
  return (
    <main ref={workspaceRef} className="agents-workspace" data-settings-open={settingsModalOpen}>
      {params.get("view") === "scheduled" && params.has("task") ? (
        <ScheduledPage embedded />
      ) : entryOpen ? (
        <AgentCollection
          agents={agents}
          conversations={conversations}
          loading={loading}
          error={error}
          disabled={disabled}
          workingAgentId={working ? workingAgentId : undefined}
          onSelect={select}
          onCreate={create}
          onNewChat={beginNewChat}
          onRetry={() => void load(user?.id ?? "")}
          initialSection={params.get("view") === "activity" ? "activity" : "all"}
        />
      ) : (
        <>
          <div className="agents-main">
            {error && (
              <div role="alert" className="agents-notice">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load(user?.id ?? "")}>
                  Retry
                </Button>
              </div>
            )}
            <header
              className="agent-conversation-heading"
              data-window-toolbar
              data-tauri-drag-region
              data-misty-window-titlebar-region="true"
            >
              <div className="agent-heading-start">
                <IconButton label="Back to agents" onClick={browseAgents}>
                  <ArrowLeft size={16} />
                </IconButton>
              </div>
              {newChat ? (
                <>
                  <label className="agent-recipient-input">
                    <span>To:</span>
                    <Input
                      ref={recipientInputRef}
                      variant="bare"
                      autoFocus
                      aria-label="Search or create agents"
                      placeholder="Search or create agents"
                      value={recipientSearch}
                      onChange={(e) => setRecipientSearch(e.target.value)}
                    />
                  </label>
                  <IconButton label="Close new chat" onClick={() => setNewChat(false)}>
                    <X size={16} />
                  </IconButton>
                </>
              ) : (
                <>
                  <AgentSwitcher
                    agents={agents}
                    conversations={conversations}
                    selectedAgent={profile}
                    conversationId={activeConversationId}
                    disabled={disabled}
                    restoreTriggerFocus={!pendingChange && !settingsModalOpen}
                    triggerRef={identityRef}
                    onSelect={select}
                    onCreate={create}
                    onBrowse={browseAgents}
                  />
                  <div className="agent-heading-end">
                    <IconButton
                      label="New chat"
                      data-agent-navigation-control
                      disabled={disabled}
                      onClick={beginNewChat}
                    >
                      <Plus />
                    </IconButton>
                    <IconButton
                      label="Show agent panel"
                      disabled={!profile}
                      data-agent-navigation-control
                      aria-pressed={islandVisible}
                      onClick={toggleIsland}
                    >
                      <PanelRight size={16} />
                    </IconButton>
                  </div>
                </>
              )}
            </header>
            {!profile && activeSection && navigation}
            {newChat ? (
              <section className="agent-new-chat">
                <div className="agent-recipient-results" role="group" aria-label="Choose an agent">
                  <Button
                    variant="ghost"
                    justify="start"
                    className="agent-recipient-row"
                    onClick={create}
                  >
                    <Plus size={16} />
                    Create new agent
                  </Button>
                  {agents
                    .filter((a) =>
                      a.name
                        .toLocaleLowerCase()
                        .includes(recipientSearch.trim().toLocaleLowerCase()),
                    )
                    .map((a) => (
                      <Button
                        variant="ghost"
                        justify="start"
                        key={a.id}
                        className="agent-recipient-row"
                        onClick={() => select(a.id, true)}
                      >
                        <AgentAvatar agent={a} />
                        <span className="truncate">{a.name}</span>
                      </Button>
                    ))}
                </div>
                <div className="agent-compose-area">
                  <MistyComposer
                    layout="conversation"
                    value=""
                    onChange={() => {}}
                    mode="ask"
                    attachments={[]}
                    maxAttachments={4}
                    onAddFiles={() => {}}
                    onRemoveAttachment={() => {}}
                    onSubmit={() => {}}
                    placeholder="Message…"
                    disabled
                  />
                </div>
              </section>
            ) : (
              <AgentWorkspaceConversation
                key={`${user?.id}:${profile?.id}:${conversationSpaceId}:${chatRevision}`}
                agent={profile}
                spaceId={conversationSpaceId}
                accountId={user?.id ?? ""}
                voiceControlRef={voiceRef}
                onVoiceStateChange={setVoiceState}
                onDraftStateChange={setConversationStatus}
                emptyContent={
                  profile ? (
                    <div className="agent-welcome">
                      <AgentAvatar agent={profile} large />
                      <h1>Hi, I’m {profile.name}.</h1>
                      <p>{profile.description || "What would you like to work on?"}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIslandVisible(true);
                          setActiveSection("profile");
                        }}
                      >
                        Customize agent
                      </Button>
                    </div>
                  ) : undefined
                }
                onCreate={create}
              />
            )}
          </div>
          {!newChat && !settingsModalOpen && islandVisible && overview && (
            <aside
              id={`${islandId}-panel`}
              className="agent-overview-rail misty-transient-scrollbar"
              aria-label="Agent panel"
            >
              {overview}
            </aside>
          )}
        </>
      )}
      <McpConnectionsSheet open={connectionsOpen} onOpenChange={setConnectionsOpen} />
      <AgentSettingsModal
        open={settingsModalOpen}
        onOpenChange={(open) => (open ? setSettingsModalOpen(true) : closeSettings())}
        activeTab={settingsModalTab}
        mode={settingsModalMode}
      >
        {settingsModalMode === "create" && (
          <AgentSetup
            key={`${user?.id}:create`}
            access={access}
            onConnections={() => setConnectionsOpen(true)}
            onCompanion={() => openSettingsModal("companion")}
            onStatusChange={setEditorStatus}
            onSaved={saveProfile}
          />
        )}
      </AgentSettingsModal>
      <AlertDialog
        open={Boolean(pendingChange)}
        onOpenChange={(open) => !open && setPendingChange(undefined)}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (dropdownRef.current?.isConnected) dropdownRef.current.focus();
            else if (recipientInputRef.current?.isConnected) recipientInputRef.current.focus();
            else identityRef.current?.focus();
          }}
        >
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes or an unsent message.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pendingChange?.();
                setPendingChange(undefined);
                setEditorStatus({ dirty: false, busy: false });
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
