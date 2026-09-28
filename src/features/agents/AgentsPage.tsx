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
import { ArrowLeft, ChevronDown, MousePointer2, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./agentsWorkspace.css";
import { AgentAvatar } from "./components/AgentAvatar";
import { AgentEditor } from "./components/AgentEditor";
import { AgentNavigationIsland, type AgentSection } from "./components/AgentNavigationIsland";
import { AgentSettingsModal, type AgentSettingsTab } from "./components/AgentSettingsModal";
import { AgentWorkspaceRoster, AgentHistory } from "./components/AgentWorkspaceRoster";
import { AgentWorkspaceConversation } from "./components/AgentWorkspaceConversation";
import { MistyDashboard } from "./components/MistyDashboard";
import { usePersonalAgentsStore } from "./personalAgentsStore";

/*
 * WORLD: The approved Grok Bot layout, expressed in Misty's shared theme and controls.
 * STORY: Pick an agent and talk; settings, companion controls, and history open on demand.
 * FIRST VIEWPORT: A 244px roster with search, centered identity toggling a navigation island,
 * and a quiet transcript/composer. Each text-only island button opens its own dropdown.
 * FORM: Approved agents-persistent-island mockups, no chevrons, independent task activity.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 * the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */
export default function NativeAgentsPage() {
  const { user } = useAuth();
  const spaceId = "";
  const { agents, loading, error, load } = usePersonalAgentsStore();
  const [selected, setSelected] = useState<string>();
  const [newChat, setNewChat] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [rosterOpen, setRosterOpen] = useState(false);
  const rosterId = useId();
  const showAgentsRef = useRef<HTMLButtonElement>(null);
  const rosterWasOpen = useRef(false);
  useEffect(() => {
    if (!rosterOpen && rosterWasOpen.current) showAgentsRef.current?.focus();
    rosterWasOpen.current = rosterOpen;
  }, [rosterOpen]);
  const [params] = useSearchParams();
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
  const conversations = useMistyStore((s) => s.conversations);
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const conversationSpaceId =
    conversations.find((c) => c.id === activeConversationId)?.spaceId ?? "";
  useEffect(() => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    if (!user?.id) {
      void load("");
      return;
    }
    return observeAccountChanges(user.id, ["agents"], () => load(user.id));
  }, [user?.id, load]);
  const linkedAgentId = params.get("agent");
  useEffect(() => {
    if (!linkedAgentId) return;
    setSelected(linkedAgentId);
    setNewChat(false);
    setActiveSection(undefined);
    setChatRevision((n) => n + 1);
  }, [linkedAgentId, params]);
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
      setRosterOpen(false);
      setActiveSection(undefined);
    }, false);
  const select = (id: string, startNew = false, conversationId?: string) =>
    change(() => {
      setChatRevision((n) => n + 1);
      setSelected(id);
      setRosterOpen(false);
      setNewChat(false);
      setActiveSection(undefined);
      setSettingsModalOpen(false);
      const latest = conversations.find(
        (c) => c.agentId === id || (!c.agentId && agents.find((a) => a.id === id)?.system_managed),
      );
      useMistyStore.setState({
        selectedAgentId: id,
        activeConversationId: startNew ? "" : (conversationId ?? latest?.id ?? ""),
        context: [],
        handoff: undefined,
        browserRequest: undefined,
      });
      if (conversationId) void useMistyStore.getState().selectConversation(conversationId);
    });
  const create = () =>
    change(() => {
      setNewChat(false);
      setSettingsModalMode("create");
      setSettingsModalTab("settings");
      setSettingsModalOpen(true);
      setActiveSection(undefined);
      setRosterOpen(false);
    });
  const beginNewChat = () =>
    change(() => {
      setNewChat(true);
      setRecipientSearch("");
      setActiveSection(undefined);
      setSettingsModalOpen(false);
      setRosterOpen(false);
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
  const saveProfile = async (id: string) => {
    await load(user?.id ?? "");
    setSelected(id);
    setSettingsModalOpen(false);
    setActiveSection(undefined);
    setPendingChange(undefined);
  };
  const removeProfile = async () => {
    setSelected(undefined);
    setSettingsModalOpen(false);
    setActiveSection(undefined);
    await load(user?.id ?? "");
  };
  const disabled = working || editorStatus.busy || conversationStatus.busy;
  return (
    <main
      ref={workspaceRef}
      className="agents-workspace"
      data-roster-open={rosterOpen}
      data-settings-open={settingsModalOpen}
    >
      <AgentWorkspaceRoster
        id={rosterId}
        agents={agents}
        conversations={conversations}
        selectedId={newChat ? undefined : profile?.id}
        loading={loading}
        disabled={disabled}
        open={rosterOpen}
        onSelect={select}
        onNewChat={beginNewChat}
        onCreate={create}
        onClose={() => setRosterOpen(false)}
      />
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
          data-tauri-drag-region
          data-misty-window-titlebar-region="true"
        >
          <div className="agent-heading-start">
            <IconButton
              className="agents-roster-back"
              label="Show agents"
              ref={showAgentsRef}
              aria-controls={rosterId}
              aria-expanded={rosterOpen}
              data-agent-navigation-control
              onClick={() =>
                change(() => {
                  setActiveSection(undefined);
                  setRosterOpen(true);
                }, false)
              }
            >
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
              <Button
                ref={identityRef}
                variant="ghost"
                size="sm"
                className="agent-heading-identity px-1"
                aria-label="Agent details"
                aria-expanded={islandVisible}
                aria-controls={islandId}
                data-agent-navigation-control
                disabled={!profile}
                onClick={toggleIsland}
              >
                <AgentAvatar agent={profile} />
                <span className="truncate">{profile?.name || "Misty"}</span>
                <ChevronDown aria-hidden="true" className="agent-heading-chevron size-3.5" />
              </Button>
              <div className="agent-heading-end">
                <IconButton
                  label="Companion controls"
                  data-agent-navigation-control
                  aria-pressed={settingsModalOpen && settingsModalTab === "companion"}
                  onClick={() => openSettingsModal("companion")}
                >
                  <MousePointer2 size={16} />
                </IconButton>
              </div>
            </>
          )}
        </header>
        {!newChat && islandVisible && (
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
        )}
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
                  a.name.toLocaleLowerCase().includes(recipientSearch.trim().toLocaleLowerCase()),
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
            onDraftStateChange={setConversationStatus}
            onCreate={create}
          />
        )}
      </div>
      <AgentSettingsModal
        open={settingsModalOpen}
        onOpenChange={(open) => (open ? setSettingsModalOpen(true) : closeSettings())}
        activeTab={settingsModalTab}
        mode={settingsModalMode}
      >
        {settingsModalMode === "create" && (
          <AgentEditor
            key={`${user?.id}:create`}
            onStatusChange={setEditorStatus}
            spaceId={spaceId}
            onSaved={saveProfile}
            onRemoved={removeProfile}
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
