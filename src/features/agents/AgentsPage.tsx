import { ScheduledPage } from "@/features/scheduled/ScheduledPage";
import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button } from "@/shared/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./agentsWorkspace.css";
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
import { AgentConversationHeading } from "./page/AgentConversationHeading";
import { AgentDiscardDialog } from "./page/AgentDiscardDialog";
import { AgentNewChat } from "./page/AgentNewChat";
import { AgentProfileSection, AgentWelcome } from "./page/AgentProfileSection";
import { useAgentChangeGuard } from "./page/useAgentChangeGuard";

/*
 * THESIS: An ongoing conversation with an agent whose context and work remain visible.
 * OWN-WORLD: Misty monochrome shared controls, 6px buttons, 8px islands, existing cloud avatars.
 * STORY: Talk in the center; inspect identity, account access, activity and completed results at right.
 * FIRST VIEWPORT: Journal collection header, section and view islands, and shared item rows.
 * FORM: Desktop-only Journal entry; existing conversations and overview open from real rows.
 * SIGNATURE: The identity control reveals the overview without replacing the conversation or its draft.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 *   the verdict, DESIGN.md, and every shipping raster carrying its provenance
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
  const [chatRevision, setChatRevision] = useState(0);
  const working = useMistyStore((s) => s.working);
  const guard = useAgentChangeGuard(working);
  const { change, setEditorStatus } = guard;
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
    guard.cancel();
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
  const disabled = working || guard.busy;
  const navigation = (
    <AgentNavigationIsland
      id={islandId}
      activeSection={activeSection}
      onSectionChange={openSection}
      collisionBoundary={workspaceRef.current}
      profileDisabled={!profile}
      contentRef={dropdownRef}
      dismissalBlocked={guard.pending}
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
          <AgentProfileSection
            key={`${user?.id}:${profile.id}:${spaceId}`}
            profile={profile}
            conversation={conversation}
            working={working}
            onStatusChange={setEditorStatus}
            onTalk={() => openSection()}
            spaceId={spaceId}
            onSaved={saveProfile}
            onRemoved={removeProfile}
          />
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
            <AgentConversationHeading
              newChat={newChat}
              recipientSearch={recipientSearch}
              recipientInputRef={recipientInputRef}
              switcher={{
                agents,
                conversations,
                selectedAgent: profile,
                conversationId: activeConversationId,
                disabled,
                restoreTriggerFocus: !guard.pending && !settingsModalOpen,
                triggerRef: identityRef,
                onSelect: select,
                onCreate: create,
                onBrowse: browseAgents,
              }}
              disabled={disabled}
              panelDisabled={!profile}
              panelVisible={islandVisible}
              onBack={browseAgents}
              onRecipientSearch={setRecipientSearch}
              onCloseNewChat={() => setNewChat(false)}
              onNewChat={beginNewChat}
              onTogglePanel={toggleIsland}
            />
            {!profile && activeSection && navigation}
            {newChat ? (
              <AgentNewChat
                agents={agents}
                search={recipientSearch}
                onCreate={create}
                onSelect={(id) => select(id, true)}
              />
            ) : (
              <AgentWorkspaceConversation
                key={`${user?.id}:${profile?.id}:${conversationSpaceId}:${chatRevision}`}
                agent={profile}
                spaceId={conversationSpaceId}
                accountId={user?.id ?? ""}
                voiceControlRef={voiceRef}
                onVoiceStateChange={setVoiceState}
                onDraftStateChange={guard.setConversationStatus}
                emptyContent={
                  profile ? (
                    <AgentWelcome
                      profile={profile}
                      onCustomize={() => {
                        setIslandVisible(true);
                        setActiveSection("profile");
                      }}
                    />
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
      <AgentDiscardDialog
        open={guard.pending}
        onCancel={guard.cancel}
        onDiscard={guard.discard}
        restoreFocus={() => {
          if (dropdownRef.current?.isConnected) dropdownRef.current.focus();
          else if (recipientInputRef.current?.isConnected) recipientInputRef.current.focus();
          else identityRef.current?.focus();
        }}
      />
    </main>
  );
}
